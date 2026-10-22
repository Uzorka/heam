import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";
import { blindIndex, decryptField, encryptField } from "@/server/crypto";
import { redact } from "@/server/logger";
import { computeAuditHash, GENESIS_HASH } from "@/server/audit";
import { passwordProblems } from "@/server/auth/password";

const key = () => Buffer.alloc(32, 1).toString("base64");
const key2 = () => Buffer.alloc(32, 2).toString("base64");

describe("startup configuration", () => {
  const good = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:strong@db:5432/hms",
    APP_URL: "https://hms.example.org",
    DATA_ENCRYPTION_KEY: key(),
    BLIND_INDEX_KEY: key2(),
    STORAGE_DRIVER: "s3",
  };
  it("fails safely when encryption secrets are missing in production", () => {
    expect(() => parseEnv({ ...good, DATA_ENCRYPTION_KEY: undefined })).toThrow(/refusing to start/i);
    expect(() => parseEnv({ ...good, BLIND_INDEX_KEY: "short" })).toThrow(/refusing to start/i);
  });
  it("refuses insecure production settings", () => {
    expect(() => parseEnv({ ...good, APP_URL: "http://hms.example.org" })).toThrow(/https/);
    expect(() => parseEnv({ ...good, STORAGE_DRIVER: "local" })).toThrow(/local/);
    expect(() => parseEnv({ ...good, BLIND_INDEX_KEY: key() })).toThrow(/differ/);
  });
  it("forces MFA enforcement on in production", () => {
    expect(parseEnv({ ...good, MFA_ENFORCE: "false" }).MFA_ENFORCE).toBe("true");
  });
});

describe("field encryption", () => {
  it("round-trips and uses a random IV", () => {
    const a = encryptField("12345678901");
    const b = encryptField("12345678901");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("12345678901");
  });
  it("detects tampering", () => {
    const parts = encryptField("secret").split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });
  it("blind index is deterministic, normalised and purpose-separated", () => {
    expect(blindIndex("123 456", "nin")).toBe(blindIndex("123456", "nin"));
    expect(blindIndex("123456", "nin")).not.toBe(blindIndex("123456", "passport"));
  });
});

describe("log redaction", () => {
  it("strips secrets and personal fields", () => {
    const out = redact({
      password: "x",
      user: { phoneE164: "+234", id: "1" },
      sessionToken: "t",
      count: 2,
    }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.sessionToken).toBe("[redacted]");
    expect((out.user as Record<string, unknown>).phoneE164).toBe("[redacted]");
    expect((out.user as Record<string, unknown>).id).toBe("1");
    expect(out.count).toBe(2);
  });
});

describe("audit hash", () => {
  const fields = {
    id: "1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    actorType: "USER",
    actorUserId: "u",
    action: "a",
    resourceType: "r",
    resourceId: null,
    patientId: null,
    branchId: null,
    outcome: "SUCCESS",
    details: { b: 1, a: 2 },
  };
  it("is independent of key order but sensitive to content and chain", () => {
    const h1 = computeAuditHash(GENESIS_HASH, fields);
    expect(computeAuditHash(GENESIS_HASH, { ...fields, details: { a: 2, b: 1 } })).toBe(h1);
    expect(computeAuditHash(GENESIS_HASH, { ...fields, action: "b" })).not.toBe(h1);
    expect(computeAuditHash("f".repeat(64), fields)).not.toBe(h1);
  });
});

describe("password policy", () => {
  it("requires length and variety", () => {
    expect(passwordProblems("short")).not.toHaveLength(0);
    expect(passwordProblems("alllowercaseletters")).not.toHaveLength(0);
    expect(passwordProblems("Good-Passphrase-2026")).toHaveLength(0);
    expect(passwordProblems("Kemi.Balogun-2026", { email: "kemi.balogun@x.test" })).not.toHaveLength(0);
  });
});

describe("local production test mode", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://hms:hms_dev_password@localhost:5432/hms",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    HMS_LOCAL_PRODUCTION_TEST: "true",
  };
  it("is accepted only for localhost", () => {
    expect(() => parseEnv({ ...base, APP_URL: "http://localhost:3100" })).not.toThrow();
    expect(() => parseEnv({ ...base, APP_URL: "https://hms.example.org" })).toThrow(/only allowed/);
  });
  it("still requires encryption keys", () => {
    expect(() => parseEnv({ ...base, APP_URL: "http://localhost:3100", DATA_ENCRYPTION_KEY: "" })).toThrow(
      /refusing to start/i,
    );
  });
});
