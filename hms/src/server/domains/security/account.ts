import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import type { AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { hashPassword, passwordProblems, verifyPassword } from "../../auth/password";
import { encryptTotpSecret, generateTotpSecret, totpQrDataUrl, verifyTotp } from "../../auth/mfa";
import { revokeAllSessions, revokeSession } from "../../auth/session-store";
import type { RequestMeta } from "../../request-meta";

export async function changePassword(
  ctx: AuthContext,
  input: { currentPassword: string; newPassword: string },
  db: DbClient = prisma,
) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ValidationError("Current password is incorrect.", { currentPassword: "Incorrect" });
  }
  const problems = passwordProblems(input.newPassword, { email: user.email });
  if (problems.length) throw new ValidationError(problems.join(" "), { newPassword: problems.join(" ") });
  if (await verifyPassword(user.passwordHash, input.newPassword)) {
    throw new ValidationError("Choose a password you have not just used.", { newPassword: "Same as current" });
  }
  await withTx(db, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        version: { increment: 1 },
      },
    });
    const revoked = await revokeAllSessions(tx, user.id, "PASSWORD_CHANGED", ctx.sessionId ?? undefined);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: user.id,
      action: "auth.password_changed",
      resourceType: "User",
      resourceId: user.id,
      details: { otherSessionsRevoked: revoked },
      meta: ctx.meta,
    });
  });
}

export async function beginMfaEnrollment(ctx: AuthContext, db: DbClient = prisma) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (user.mfaEnabled) throw new ConflictError("Two-step verification is already enabled.");
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaPendingSecretEnc: encryptTotpSecret(secret) } });
  return { secret, qrDataUrl: await totpQrDataUrl(secret, user.email) };
}

export async function confirmMfaEnrollment(ctx: AuthContext, code: string, db: DbClient = prisma) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.mfaPendingSecretEnc) throw new ConflictError("Start enrolment first.");
  if (!verifyTotp(user.mfaPendingSecretEnc, code)) throw new ValidationError("That code is not valid. Check your device clock and try again.", { code: "Invalid code" });
  await withTx(db, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null },
    });
    if (ctx.sessionId) await tx.session.update({ where: { id: ctx.sessionId }, data: { mfaVerified: true } });
    await revokeAllSessions(tx, user.id, "MFA_ENABLED", ctx.sessionId ?? undefined);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: user.id,
      action: "auth.mfa_enabled",
      resourceType: "User",
      resourceId: user.id,
      meta: ctx.meta,
    });
  });
}

export async function disableMfa(ctx: AuthContext, input: { password: string; code: string }, enforced: boolean, db: DbClient = prisma) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, include: { roles: { where: { revokedAt: null }, include: { role: true } } } });
  if (!user.mfaEnabled || !user.mfaSecretEnc) throw new ConflictError("Two-step verification is not enabled.");
  if (enforced && user.roles.some((r) => r.role.requiresMfa)) {
    throw new ForbiddenError("Your role requires two-step verification. Ask an administrator if you need it reset.");
  }
  if (!(await verifyPassword(user.passwordHash, input.password)) || !verifyTotp(user.mfaSecretEnc, input.code)) {
    throw new ValidationError("Password or code is incorrect.");
  }
  await withTx(db, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: user.id,
      action: "auth.mfa_disabled",
      resourceType: "User",
      resourceId: user.id,
      meta: ctx.meta,
    });
  });
}

export const MFA_MAX_FAILURES = 5;

/** Second login step. Rate limited per user; too many failures revoke the pending session. */
export async function verifyLoginMfa(sessionId: string, userId: string, code: string, meta: RequestMeta, db: DbClient = prisma) {
  const identifier = `mfa:${userId}`;
  const since = new Date(Date.now() - 15 * 60_000);
  const failures = await db.loginAttempt.count({ where: { identifier, success: false, createdAt: { gt: since } } });
  if (failures >= MFA_MAX_FAILURES) {
    await revokeSession(db, sessionId, "MFA_TOO_MANY_FAILURES");
    return { ok: false as const, locked: true };
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.mfaSecretEnc) throw new NotFoundError();
  if (!verifyTotp(user.mfaSecretEnc, code)) {
    await db.loginAttempt.create({ data: { identifier, ip: meta.ip, success: false, reason: "BAD_TOTP" } });
    return { ok: false as const, locked: false };
  }
  await db.loginAttempt.create({ data: { identifier, ip: meta.ip, success: true } });
  await db.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: userId,
    action: "auth.login",
    resourceType: "Session",
    resourceId: sessionId,
    details: { mfa: true },
    meta,
  });
  return { ok: true as const };
}

export async function listMySessions(ctx: AuthContext, db: DbClient = prisma) {
  return db.session.findMany({
    where: { userId: ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, expiresAt: true },
  });
}

export async function revokeMySession(ctx: AuthContext, sessionId: string, db: DbClient = prisma) {
  const s = await db.session.findUnique({ where: { id: sessionId } });
  if (!s || s.userId !== ctx.userId) throw new NotFoundError();
  await revokeSession(db, sessionId, "USER_REVOKED");
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "auth.session_revoked",
    resourceType: "Session",
    resourceId: sessionId,
    meta: ctx.meta,
  });
}

export async function switchBranch(ctx: AuthContext, branchId: string, db: DbClient = prisma) {
  if (!ctx.sessionId) throw new ForbiddenError();
  const allowed = ctx.grants.some((g) => g.branchId === null || g.branchId === branchId);
  if (!allowed) throw new ForbiddenError("You have no role in that branch.");
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.status === "INACTIVE") throw new NotFoundError("Branch not available.");
  await db.session.update({ where: { id: ctx.sessionId }, data: { activeBranchId: branchId } });
}
