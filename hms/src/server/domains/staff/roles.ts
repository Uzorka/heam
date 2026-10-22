import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { PERMISSIONS, isPermissionCode, type Sensitivity } from "../../authz/permissions";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import type { roleChangeDecisionSchema, roleChangeRequestSchema } from "@/lib/schemas/staff";

export async function listRoles(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "roles.read");
  return db.role.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { permissions: true, userRoles: { where: { revokedAt: null } } } },
      changeRequests: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
}

export async function getRole(ctx: AuthContext, roleId: string, db: DbClient = prisma) {
  requirePermission(ctx, "roles.read");
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: {
      permissions: { select: { permissionCode: true } },
      changeRequests: {
        orderBy: { requestedAt: "desc" },
        take: 20,
        include: { requestedBy: { select: { displayName: true } }, decidedBy: { select: { displayName: true } } },
      },
    },
  });
  if (!role) throw new NotFoundError("Role not found.");
  return role;
}

/** Highlights risky changes for the approver, e.g. clinical access added to a non-clinical role. */
export function assessRoleChange(currentCodes: string[], add: string[]): string[] {
  const sens = (c: string): Sensitivity | undefined => PERMISSIONS.find((p) => p.code === c)?.sensitivity;
  const current = new Set(currentCodes.map(sens));
  const warnings: string[] = [];
  for (const code of add) {
    const s = sens(code);
    if ((s === "CLINICAL" || s === "PHI") && !current.has("CLINICAL") && !current.has("PHI")) {
      warnings.push(`${code} gives patient information access to a role that currently has none.`);
    }
    if (s === "HR" && (current.has("CLINICAL") || current.has("PHI"))) {
      warnings.push(`${code} mixes HR/payroll access into a role with patient access.`);
    }
    if (s === "CLINICAL" && current.has("HR")) warnings.push(`${code} mixes clinical access into an HR role.`);
  }
  return warnings;
}

export async function requestRoleChange(ctx: AuthContext, input: z.output<typeof roleChangeRequestSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "roles.request_change");
  const role = await db.role.findUnique({ where: { id: input.roleId }, include: { permissions: true } });
  if (!role) throw new NotFoundError("Role not found.");
  const invalid = [...input.add, ...input.remove].filter((c) => !isPermissionCode(c));
  if (invalid.length) throw new ValidationError(`Unknown permissions: ${invalid.join(", ")}`);
  const current = new Set(role.permissions.map((p) => p.permissionCode));
  const add = [...new Set(input.add)].filter((c) => !current.has(c));
  const remove = [...new Set(input.remove)].filter((c) => current.has(c));
  if (!add.length && !remove.length) throw new ValidationError("The proposed change does not alter the role.");
  const pending = await db.roleChangeRequest.count({ where: { roleId: role.id, status: "PENDING" } });
  if (pending) throw new ConflictError("This role already has a pending change. Decide or cancel it first.");
  return withTx(db, async (tx) => {
    const req = await tx.roleChangeRequest.create({
      data: {
        roleId: role.id,
        addPermissions: add,
        removePermissions: remove,
        reason: input.reason,
        requestedById: ctx.userId,
        roleVersion: role.version,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "roles.change_requested",
      resourceType: "RoleChangeRequest",
      resourceId: req.id,
      details: { role: role.code, add, remove },
      meta: ctx.meta,
    });
    return req;
  });
}

export async function decideRoleChange(ctx: AuthContext, input: z.output<typeof roleChangeDecisionSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "roles.approve_change");
  const req = await db.roleChangeRequest.findUnique({ where: { id: input.requestId }, include: { role: true } });
  if (!req) throw new NotFoundError();
  if (req.status !== "PENDING") throw new ConflictError("This request has already been decided.");
  if (req.requestedById === ctx.userId) throw new ForbiddenError("A role change must be approved by someone other than the requester.");
  await withTx(db, async (tx) => {
    if (input.approve) {
      const bumped = await tx.role.updateMany({
        where: { id: req.roleId, version: req.roleVersion },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) throw new ConflictError("The role changed after this request was made. Ask for a fresh request.");
      if (req.removePermissions.length) {
        await tx.rolePermission.deleteMany({ where: { roleId: req.roleId, permissionCode: { in: req.removePermissions } } });
      }
      if (req.addPermissions.length) {
        await tx.rolePermission.createMany({
          data: req.addPermissions.map((permissionCode) => ({ roleId: req.roleId, permissionCode })),
          skipDuplicates: true,
        });
      }
    }
    await tx.roleChangeRequest.update({
      where: { id: req.id },
      data: {
        status: input.approve ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNotes: input.notes ?? null,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.approve ? "roles.change_approved" : "roles.change_rejected",
      resourceType: "Role",
      resourceId: req.roleId,
      details: { requestId: req.id, role: req.role.code, add: req.addPermissions, remove: req.removePermissions },
      meta: ctx.meta,
    });
  });
}

export async function cancelRoleChange(ctx: AuthContext, requestId: string, db: DbClient = prisma) {
  const req = await db.roleChangeRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "PENDING") throw new NotFoundError();
  if (req.requestedById !== ctx.userId) throw new ForbiddenError("Only the requester can cancel this request.");
  await withTx(db, async (tx) => {
    await tx.roleChangeRequest.update({ where: { id: req.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "roles.change_cancelled",
      resourceType: "RoleChangeRequest",
      resourceId: req.id,
      meta: ctx.meta,
    });
  });
}

export async function listPendingRoleChanges(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "roles.read");
  return db.roleChangeRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: {
      role: { include: { permissions: { select: { permissionCode: true } } } },
      requestedBy: { select: { displayName: true } },
    },
  });
}
