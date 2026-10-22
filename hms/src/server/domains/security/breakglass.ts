import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import type { breakGlassReviewSchema, breakGlassSchema } from "@/lib/schemas/staff";
import { loadScopedPatient } from "../patients/service";
import { getSetting } from "../settings/system-settings";

/**
 * Emergency access to one patient's clinical record for a short, fixed time. Requires a clinical
 * role holding `clinical.breakglass`, a structured reason and a written justification; every grant
 * is queued for compliance review and notifies reviewers. It never widens non-clinical privileges.
 */
export async function invokeBreakGlass(
  ctx: AuthContext,
  input: z.output<typeof breakGlassSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "clinical.breakglass");
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.search", db);
  const minutes = await getSetting(db, "breakglass.durationMinutes");
  const active = await activeBreakGlass(db, ctx.userId, patient.id);
  if (active) throw new ConflictError("You already have active emergency access to this patient.");
  return withTx(db, async (tx) => {
    const grant = await tx.breakGlassGrant.create({
      data: {
        userId: ctx.userId,
        patientId: patient.id,
        reason: input.reason,
        justification: input.justification,
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
    });
    const reviewers = await tx.user.findMany({
      where: {
        status: "ACTIVE",
        roles: {
          some: {
            revokedAt: null,
            role: { permissions: { some: { permissionCode: "audit.breakglass.review" } } },
          },
        },
      },
      select: { id: true },
    });
    if (reviewers.length) {
      await tx.notification.createMany({
        data: reviewers.map((r) => ({
          channel: "IN_APP" as const,
          template: "breakglass.review_needed",
          recipient: r.id,
          userId: r.id,
          payload: { grantId: grant.id },
          status: "SENT" as const,
          sentAt: new Date(),
        })),
      });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.breakglass.invoke",
      resourceType: "BreakGlassGrant",
      resourceId: grant.id,
      patientId: patient.id,
      branchId: ctx.activeBranchId,
      details: { reason: input.reason, minutes },
      meta: ctx.meta,
    });
    return grant;
  });
}

export async function activeBreakGlass(db: DbClient, userId: string, patientId: string, now = new Date()) {
  return db.breakGlassGrant.findFirst({
    where: { userId, patientId, endedAt: null, expiresAt: { gt: now } },
  });
}

export async function endBreakGlass(ctx: AuthContext, grantId: string, db: DbClient = prisma) {
  const g = await db.breakGlassGrant.findUnique({ where: { id: grantId } });
  if (!g || g.userId !== ctx.userId) throw new NotFoundError();
  await withTx(db, async (tx) => {
    await tx.breakGlassGrant.update({ where: { id: g.id }, data: { endedAt: new Date() } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.breakglass.end",
      resourceType: "BreakGlassGrant",
      resourceId: g.id,
      patientId: g.patientId,
      meta: ctx.meta,
    });
  });
}

export async function listBreakGlassForReview(
  ctx: AuthContext,
  status: "PENDING" | "APPROPRIATE" | "CONCERN" = "PENDING",
  db: DbClient = prisma,
) {
  requirePermission(ctx, "audit.breakglass.review");
  return db.breakGlassGrant.findMany({
    where: { reviewStatus: status },
    orderBy: { startedAt: "desc" },
    take: 200,
    include: {
      user: { select: { displayName: true, jobTitle: true } },
      reviewedBy: { select: { displayName: true } },
      patient: { select: { mrn: true } },
    },
  });
}

export async function reviewBreakGlass(
  ctx: AuthContext,
  input: z.output<typeof breakGlassReviewSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "audit.breakglass.review");
  const g = await db.breakGlassGrant.findUnique({ where: { id: input.grantId } });
  if (!g) throw new NotFoundError();
  if (g.userId === ctx.userId) throw new ForbiddenError("You cannot review your own emergency access.");
  if (g.reviewStatus !== "PENDING") throw new ConflictError("Already reviewed.");
  await withTx(db, async (tx) => {
    await tx.breakGlassGrant.update({
      where: { id: g.id },
      data: {
        reviewStatus: input.status,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        reviewNotes: input.notes,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.breakglass.review",
      resourceType: "BreakGlassGrant",
      resourceId: g.id,
      patientId: g.patientId,
      details: { outcome: input.status },
      meta: ctx.meta,
    });
  });
}
