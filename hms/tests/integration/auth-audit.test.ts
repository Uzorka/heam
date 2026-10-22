import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { authenticate, LOCKOUT_THRESHOLD } from "@/server/auth/login";
import { createSession, validateSessionToken } from "@/server/auth/session-store";
import { consumeResetToken, issueResetToken } from "@/server/auth/reset";
import { recordAudit, verifyAuditChain } from "@/server/audit";
import { invokeBreakGlass, reviewBreakGlass } from "@/server/domains/security/breakglass";
import { getClinicalAccess } from "@/server/authz/clinical-access";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { SYSTEM_META } from "@/server/request-meta";
import { TEST_PASSWORD, createUser, newPatient, userCtx } from "./helpers";

const meta = { ...SYSTEM_META, ip: "10.0.0.9" };
const cfg = { idleMinutes: 30, absoluteHours: 12 };

describe("authentication", () => {
  it("logs in with a correct password and gives a generic failure otherwise", async () => {
    const u = await createUser(["NURSE"]);
    expect((await authenticate(prisma, { email: u.email, password: TEST_PASSWORD }, meta)).status).toBe("OK");
    expect((await authenticate(prisma, { email: u.email, password: "wrong-password-1A" }, meta)).status).toBe(
      "INVALID",
    );
    expect((await authenticate(prisma, { email: "nobody@test.local", password: "x" }, meta)).status).toBe(
      "INVALID",
    );
  });

  it("locks the account after repeated failures", async () => {
    const u = await createUser(["NURSE"]);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++)
      await authenticate(prisma, { email: u.email, password: "nope-nope-Nope1" }, { ...meta, ip: null });
    const r = await authenticate(prisma, { email: u.email, password: TEST_PASSWORD }, { ...meta, ip: null });
    expect(r.status).toBe("LOCKED");
  });

  it("sessions expire when idle and when revoked", async () => {
    const u = await createUser(["NURSE"]);
    const s = await createSession(prisma, u.id, cfg, meta, { mfaVerified: false, activeBranchId: null });
    expect(await validateSessionToken(prisma, s.token, cfg)).not.toBeNull();
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await validateSessionToken(prisma, s.token, cfg, later)).toBeNull();
    // idle expiry revoked it permanently
    expect(await validateSessionToken(prisma, s.token, cfg)).toBeNull();
    expect(await validateSessionToken(prisma, "garbage", cfg)).toBeNull();
  });

  it("suspending a user invalidates their sessions", async () => {
    const u = await createUser(["NURSE"]);
    const s = await createSession(prisma, u.id, cfg, meta, { mfaVerified: false, activeBranchId: null });
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect(await validateSessionToken(prisma, s.token, cfg)).toBeNull();
  });

  it("password reset tokens are single use and revoke sessions", async () => {
    const u = await createUser(["NURSE"]);
    const s = await createSession(prisma, u.id, cfg, meta, { mfaVerified: false, activeBranchId: null });
    const { token } = await issueResetToken(prisma, u.id, null, meta);
    await expect(consumeResetToken(prisma, token, "weak", meta)).rejects.toBeInstanceOf(ValidationError);
    await consumeResetToken(prisma, token, "A-New-Strong-Passphrase-7", meta);
    await expect(consumeResetToken(prisma, token, "Another-Strong-Pass-8", meta)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await validateSessionToken(prisma, s.token, cfg)).toBeNull();
    expect(
      (await authenticate(prisma, { email: u.email, password: "A-New-Strong-Passphrase-7" }, meta)).status,
    ).toBe("OK");
  });
});

describe("audit trail", () => {
  it("is hash-chained and verifies", async () => {
    await recordAudit(prisma, {
      actorType: "SYSTEM",
      action: "test.event",
      resourceType: "Test",
      details: { n: 1 },
    });
    const r = await verifyAuditChain();
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThan(0);
  });

  it("cannot be updated or deleted", async () => {
    const ev = await prisma.auditEvent.findFirstOrThrow();
    await expect(
      prisma.auditEvent.update({ where: { seq: ev.seq }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { seq: ev.seq } })).rejects.toThrow(/append-only/);
  });

  it("concurrent writes keep a valid chain", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordAudit(prisma, {
          actorType: "SYSTEM",
          action: "test.concurrent",
          resourceType: "Test",
          details: { i },
        }),
      ),
    );
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});

describe("break-glass emergency access", () => {
  it("grants time-limited access, notifies reviewers and cannot be self-reviewed", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const { ctx: auditor } = await userCtx(["AUDITOR"], { allBranches: true });
    const p = await newPatient(reception);
    expect((await getClinicalAccess(doctor, p.patientId)).allowed).toBe(false);
    await expect(
      invokeBreakGlass(reception, {
        patientId: p.patientId,
        reason: "EMERGENCY_TREATMENT",
        justification: "Patient collapsed in the waiting area",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const grant = await invokeBreakGlass(doctor, {
      patientId: p.patientId,
      reason: "EMERGENCY_TREATMENT",
      justification: "Patient collapsed in the waiting area",
    });
    const access = await getClinicalAccess(doctor, p.patientId);
    expect(access.basis).toBe("BREAK_GLASS");
    expect(
      await prisma.notification.count({
        where: { template: "breakglass.review_needed", userId: auditor.userId },
      }),
    ).toBeGreaterThan(0);
    await prisma.breakGlassGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getClinicalAccess(doctor, p.patientId)).allowed).toBe(false);
    await reviewBreakGlass(auditor, {
      grantId: grant.id,
      status: "APPROPRIATE",
      notes: "Verified with ward sister",
    });
    expect((await prisma.breakGlassGrant.findUniqueOrThrow({ where: { id: grant.id } })).reviewStatus).toBe(
      "APPROPRIATE",
    );
  });
});
