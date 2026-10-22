import type { DbClient } from "../db";
import { recordAudit } from "../audit";
import type { RequestMeta } from "../request-meta";
import { dummyVerify, verifyPassword } from "./password";

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;
export const IP_WINDOW_MINUTES = 15;
export const IP_MAX_FAILURES = 30;

export type LoginResult =
  | {
      status: "OK";
      userId: string;
      mfaRequired: boolean;
      mustChangePassword: boolean;
      defaultBranchId: string | null;
    }
  | { status: "INVALID" }
  | { status: "LOCKED"; until: Date }
  | { status: "RATE_LIMITED" };

/** Generic message so responses do not reveal whether an account exists. */
export const LOGIN_FAILURE_MESSAGE = "Email or password is incorrect, or the account is not active.";

export async function authenticate(
  db: DbClient,
  input: { email: string; password: string },
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<LoginResult> {
  const identifier = input.email.trim().toLowerCase();

  if (meta.ip) {
    const recentIpFailures = await db.loginAttempt.count({
      where: {
        ip: meta.ip,
        success: false,
        createdAt: { gt: new Date(now.getTime() - IP_WINDOW_MINUTES * 60_000) },
      },
    });
    if (recentIpFailures >= IP_MAX_FAILURES) {
      await db.loginAttempt.create({
        data: { identifier, ip: meta.ip, success: false, reason: "IP_RATE_LIMIT" },
      });
      return { status: "RATE_LIMITED" };
    }
  }

  const user = await db.user.findUnique({ where: { email: identifier } });
  if (!user) {
    await dummyVerify(input.password);
    await db.loginAttempt.create({
      data: { identifier, ip: meta.ip, success: false, reason: "UNKNOWN_USER" },
    });
    return { status: "INVALID" };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await db.loginAttempt.create({ data: { identifier, ip: meta.ip, success: false, reason: "LOCKED" } });
    return { status: "LOCKED", until: user.lockedUntil };
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok || user.status !== "ACTIVE") {
    const failed = ok ? user.failedLoginCount : user.failedLoginCount + 1;
    const lock = failed >= LOCKOUT_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    await db.loginAttempt.create({
      data: {
        identifier,
        ip: meta.ip,
        success: false,
        reason: ok ? `STATUS_${user.status}` : "BAD_PASSWORD",
      },
    });
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: user.id,
      action: lock ? "auth.account_locked" : "auth.login_failed",
      resourceType: "User",
      resourceId: user.id,
      outcome: "DENIED",
      details: { reason: ok ? `STATUS_${user.status}` : "BAD_PASSWORD" },
      meta,
    });
    return { status: "INVALID" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  await db.loginAttempt.create({ data: { identifier, ip: meta.ip, success: true } });
  return {
    status: "OK",
    userId: user.id,
    mfaRequired: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword,
    defaultBranchId: user.defaultBranchId,
  };
}
