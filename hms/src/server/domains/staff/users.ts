import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { randomToken } from "../../crypto";
import { hashPassword } from "../../auth/password";
import { issueResetToken } from "../../auth/reset";
import { revokeAllSessions } from "../../auth/session-store";
import { localDayRange } from "@/lib/time";
import type { assignRoleSchema, createUserSchema, revokeRoleSchema, userStatusSchema } from "@/lib/schemas/staff";

const MAX_DELEGATION_DAYS = 31;

export async function listUsers(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "users.read");
  return db.user.findMany({
    where: { kind: "STAFF" },
    orderBy: [{ status: "asc" }, { familyName: "asc" }],
    select: {
      id: true,
      email: true,
      displayName: true,
      jobTitle: true,
      staffNumber: true,
      status: true,
      mfaEnabled: true,
      lastLoginAt: true,
      lockedUntil: true,
      isDemo: true,
      roles: {
        where: { revokedAt: null, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
        select: { id: true, allBranches: true, isDelegation: true, role: { select: { name: true, code: true } }, branch: { select: { name: true } } },
      },
    },
  });
}

export async function getUserDetail(ctx: AuthContext, userId: string, db: DbClient = prisma) {
  requirePermission(ctx, "users.read");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      kind: true,
      email: true,
      displayName: true,
      givenName: true,
      familyName: true,
      phoneE164: true,
      jobTitle: true,
      staffNumber: true,
      status: true,
      statusReason: true,
      mfaEnabled: true,
      mustChangePassword: true,
      lastLoginAt: true,
      lockedUntil: true,
      defaultBranchId: true,
      createdAt: true,
      isDemo: true,
      roles: {
        orderBy: { grantedAt: "desc" },
        include: {
          role: { select: { id: true, name: true, code: true, requiresMfa: true } },
          branch: { select: { name: true } },
          department: { select: { name: true } },
          grantedBy: { select: { displayName: true } },
          revokedBy: { select: { displayName: true } },
          delegatedFrom: { select: { displayName: true } },
        },
      },
    },
  });
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

function resolveEffective(from?: string, to?: string) {
  const effectiveFrom = from ? localDayRange(from).start : new Date();
  const effectiveTo = to ? localDayRange(to).end : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new ValidationError("End date must be after the start date.", { effectiveTo: "Invalid" });
  return { effectiveFrom, effectiveTo };
}

export async function createUser(ctx: AuthContext, input: z.output<typeof createUserSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "users.manage");
  const roles = await db.role.findMany({ where: { id: { in: input.roles.map((r) => r.roleId) }, active: true } });
  if (roles.length !== new Set(input.roles.map((r) => r.roleId)).size) throw new ValidationError("One of the roles is invalid.");
  if (roles.some((r) => r.kind !== "STAFF")) throw new ValidationError("Portal roles cannot be given to staff accounts.");
  try {
    return await withTx(db, async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          givenName: input.givenName,
          familyName: input.familyName,
          displayName: input.displayName ?? `${input.givenName} ${input.familyName}`,
          phoneE164: input.phone,
          jobTitle: input.jobTitle,
          staffNumber: input.staffNumber,
          defaultBranchId: input.defaultBranchId,
          // Unusable random password: the user sets their own via the one-time setup link.
          passwordHash: await hashPassword(randomToken(32)),
          mustChangePassword: true,
        },
      });
      for (const g of input.roles) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: g.roleId,
            branchId: g.allBranches ? null : g.branchId,
            allBranches: g.allBranches,
            departmentId: g.departmentId,
            grantedById: ctx.userId,
            reason: "Initial account setup",
          },
        });
      }
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "users.create",
        resourceType: "User",
        resourceId: user.id,
        details: { roles: roles.map((r) => r.code) },
        meta: ctx.meta,
      });
      const { token, expiresAt } = await issueResetToken(tx, user.id, ctx.userId, ctx.meta);
      return { userId: user.id, setupToken: token, expiresAt };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A user with that email or staff number already exists.");
    throw e;
  }
}

export async function assignRole(ctx: AuthContext, input: z.output<typeof assignRoleSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "users.manage");
  if (input.userId === ctx.userId) throw new ForbiddenError("You cannot change your own roles. Ask another administrator.");
  const [user, role] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId } }),
    db.role.findUnique({ where: { id: input.roleId } }),
  ]);
  if (!user) throw new NotFoundError("User not found.");
  if (!role || !role.active) throw new ValidationError("Choose an active role.");
  if (role.kind !== user.kind) throw new ValidationError("This role does not apply to this type of account.");
  const { effectiveFrom, effectiveTo } = resolveEffective(input.effectiveFrom, input.effectiveTo);

  if (input.isDelegation) {
    if (!effectiveTo || effectiveTo.getTime() - effectiveFrom.getTime() > MAX_DELEGATION_DAYS * 86_400_000) {
      throw new ValidationError(`Temporary cover can last at most ${MAX_DELEGATION_DAYS} days.`, { effectiveTo: "Too long" });
    }
    const coverFor = await db.userRole.findFirst({
      where: {
        userId: input.delegatedFromUserId,
        roleId: input.roleId,
        revokedAt: null,
        isDelegation: false,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
    });
    if (!coverFor) throw new ValidationError("The person being covered does not currently hold this role.");
    if (!coverFor.allBranches && coverFor.branchId !== (input.allBranches ? null : input.branchId)) {
      throw new ValidationError("Temporary cover cannot be broader than the covered person's own branch scope.");
    }
  }

  return withTx(db, async (tx) => {
    const ur = await tx.userRole.create({
      data: {
        userId: input.userId,
        roleId: input.roleId,
        branchId: input.allBranches ? null : input.branchId,
        allBranches: input.allBranches,
        departmentId: input.departmentId,
        effectiveFrom,
        effectiveTo,
        isDelegation: input.isDelegation,
        delegatedFromUserId: input.isDelegation ? input.delegatedFromUserId : null,
        reason: input.reason,
        grantedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.isDelegation ? "users.role.delegate" : "users.role.assign",
      resourceType: "UserRole",
      resourceId: ur.id,
      details: {
        userId: input.userId,
        role: role.code,
        branchId: ur.branchId,
        allBranches: ur.allBranches,
        effectiveTo: effectiveTo?.toISOString() ?? null,
      },
      meta: ctx.meta,
    });
    return ur;
  });
}

export async function revokeRole(ctx: AuthContext, input: z.output<typeof revokeRoleSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "users.manage");
  const ur = await db.userRole.findUnique({ where: { id: input.userRoleId }, include: { role: true } });
  if (!ur || ur.revokedAt) throw new NotFoundError("Role assignment not found.");
  if (ur.userId === ctx.userId) throw new ForbiddenError("You cannot change your own roles. Ask another administrator.");
  await withTx(db, async (tx) => {
    await tx.userRole.update({
      where: { id: ur.id },
      data: { revokedAt: new Date(), revokedById: ctx.userId, revokedReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "users.role.revoke",
      resourceType: "UserRole",
      resourceId: ur.id,
      details: { userId: ur.userId, role: ur.role.code },
      meta: ctx.meta,
    });
  });
}

export async function setUserStatus(ctx: AuthContext, input: z.output<typeof userStatusSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "users.manage");
  if (input.userId === ctx.userId) throw new ForbiddenError("You cannot change the status of your own account.");
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new NotFoundError("User not found.");
  await withTx(db, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { status: input.status, statusReason: input.reason, version: { increment: 1 } },
    });
    const revoked = input.status === "ACTIVE" ? 0 : await revokeAllSessions(tx, user.id, `STATUS_${input.status}`);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "users.status_change",
      resourceType: "User",
      resourceId: user.id,
      details: { from: user.status, to: input.status, sessionsRevoked: revoked },
      meta: ctx.meta,
    });
  });
}

export async function adminIssuePasswordReset(ctx: AuthContext, userId: string, db: DbClient = prisma) {
  requirePermission(ctx, "users.credentials.reset");
  if (userId === ctx.userId) throw new ForbiddenError("Use your own security page to change your password.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");
  return withTx(db, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { lockedUntil: null, failedLoginCount: 0 } });
    return issueResetToken(tx, userId, ctx.userId, ctx.meta);
  });
}

export async function adminResetMfa(ctx: AuthContext, userId: string, reason: string, db: DbClient = prisma) {
  requirePermission(ctx, "users.credentials.reset");
  if (userId === ctx.userId) throw new ForbiddenError("You cannot reset your own MFA. Ask another administrator.");
  await withTx(db, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null } });
    const revoked = await revokeAllSessions(tx, userId, "MFA_RESET");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "users.mfa_reset",
      resourceType: "User",
      resourceId: userId,
      details: { reason, sessionsRevoked: revoked },
      meta: ctx.meta,
    });
  });
}


export async function listUserSessions(ctx: AuthContext, userId: string, db: DbClient = prisma) {
  requirePermission(ctx, "sessions.manage");
  return db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
  });
}

export async function adminRevokeSessions(ctx: AuthContext, userId: string, db: DbClient = prisma) {
  requirePermission(ctx, "sessions.manage");
  await withTx(db, async (tx) => {
    const n = await revokeAllSessions(tx, userId, "ADMIN_REVOKED");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "users.sessions_revoked",
      resourceType: "User",
      resourceId: userId,
      details: { count: n },
      meta: ctx.meta,
    });
  });
}
