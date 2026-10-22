import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Field-level encryption with AES-256-GCM (Node's built-in implementation).
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". The version prefix allows key rotation:
 * add a new key version, re-encrypt in a background job, then retire the old key.
 */
const KEY_VERSION = "v1";

function key(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, "base64").subarray(0, 32);
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [KEY_VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptField(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== KEY_VERSION || !ivB64 || !tagB64 || !ctB64) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Deterministic keyed hash for exact-match lookup of encrypted values (blind index). */
export function blindIndex(value: string, purpose: string): string {
  const normalised = value.replace(/\s+/g, "").toUpperCase();
  return createHmac("sha256", Buffer.from(env().BLIND_INDEX_KEY, "base64"))
    .update(`${purpose}:${normalised}`)
    .digest("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
