import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { patientScopeWhere } from "./scope";

/**
 * Duplicate resolution. Nothing is merged automatically:
 *   OPEN --(request, patient.merge.request)--> MERGE_REQUESTED --(approve, patient.merge.approve, different person)--> MERGED
 *   OPEN | MERGE_REQUESTED --(dismiss)--> NOT_DUPLICATE
 * The losing record is kept (status MERGED, mergedIntoId set) so its history and audit trail survive.
 */

export async function listDuplicateReviews(
  ctx: AuthContext,
  status: "OPEN" | "MERGE_REQUESTED" | "NOT_DUPLICATE" | "MERGED" = "OPEN",
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.merge.request");
  const scope = patientScopeWhere(ctx, "patient.merge.request");
  if (!scope) throw new ForbiddenError();
  const patientSelect = {
    id: true,
    mrn: true,
    givenName: true,
    middleName: true,
    familyName: true,
    dateOfBirth: true,
    sexAtBirth: true,
    phoneE164: true,
    status: true,
    createdAt: true,
    _count: { select: { encounters: true, appointments: true } },
  } as const;
  return db.duplicatePatientReview.findMany({
    where: { status, patientA: scope, patientB: scope },
    orderBy: [{ score: "desc" }, { raisedAt: "asc" }],
    take: 100,
    include: { patientA: { select: patientSelect }, patientB: { select: patientSelect } },
  });
}

async function loadReview(db: DbClient, ctx: AuthContext, reviewId: string) {
  const scope = patientScopeWhere(ctx, "patient.merge.request");
  if (!scope) throw new ForbiddenError();
  const review = await db.duplicatePatientReview.findFirst({
    where: { id: reviewId, patientA: scope, patientB: scope },
    include: { patientA: true, patientB: true },
  });
  if (!review) throw new NotFoundError("Duplicate review not found.");
  return review;
}

export async function dismissDuplicate(
  ctx: AuthContext,
  reviewId: string,
  notes: string,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.merge.request");
  const review = await loadReview(db, ctx, reviewId);
  if (review.status !== "OPEN" && review.status !== "MERGE_REQUESTED") {
    throw new ConflictError("This review is already closed.");
  }
  await withTx(db, async (tx) => {
    await tx.duplicatePatientReview.update({
      where: { id: review.id },
      data: { status: "NOT_DUPLICATE", decidedById: ctx.userId, decidedAt: new Date(), decisionNotes: notes },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.duplicate.dismissed",
      resourceType: "DuplicatePatientReview",
      resourceId: review.id,
      details: { patientAId: review.patientAId, patientBId: review.patientBId },
      meta: ctx.meta,
    });
  });
}

export async function requestMerge(
  ctx: AuthContext,
  input: { reviewId: string; survivorId: string; notes: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.merge.request");
  const review = await loadReview(db, ctx, input.reviewId);
  if (review.status !== "OPEN") throw new ConflictError("Only open reviews can be submitted for merge.");
  if (input.survivorId !== review.patientAId && input.survivorId !== review.patientBId) {
    throw new ValidationError("The surviving record must be one of the pair.");
  }
  if (review.patientA.status === "MERGED" || review.patientB.status === "MERGED") {
    throw new ConflictError("One of these records has already been merged.");
  }
  await withTx(db, async (tx) => {
    await tx.duplicatePatientReview.update({
      where: { id: review.id },
      data: {
        status: "MERGE_REQUESTED",
        survivorId: input.survivorId,
        mergeRequestedById: ctx.userId,
        mergeRequestedAt: new Date(),
        decisionNotes: input.notes,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.merge.requested",
      resourceType: "DuplicatePatientReview",
      resourceId: review.id,
      details: { survivorId: input.survivorId },
      meta: ctx.meta,
    });
  });
}

export async function approveMerge(ctx: AuthContext, reviewId: string, db: DbClient = prisma) {
  requirePermission(ctx, "patient.merge.approve");
  const review = await loadReview(db, ctx, reviewId);
  if (review.status !== "MERGE_REQUESTED" || !review.survivorId) {
    throw new ConflictError("This merge has not been requested or is already decided.");
  }
  if (review.mergeRequestedById === ctx.userId) {
    throw new ForbiddenError("A merge must be approved by a different person from the one who requested it.");
  }
  const survivorId = review.survivorId;
  const loserId = survivorId === review.patientAId ? review.patientBId : review.patientAId;

  return withTx(db, async (tx) => {
    // Lock both patient rows to prevent concurrent merges/edits.
    await tx.$queryRaw`SELECT id FROM "Patient" WHERE id IN (${survivorId}::uuid, ${loserId}::uuid) FOR UPDATE`;
    const [survivor, loser] = await Promise.all([
      tx.patient.findUniqueOrThrow({ where: { id: survivorId } }),
      tx.patient.findUniqueOrThrow({ where: { id: loserId } }),
    ]);
    if (survivor.status === "MERGED" || loser.status === "MERGED") {
      throw new ConflictError("One of these records has already been merged.");
    }
    const loserOpen = await tx.encounter.findMany({
      where: { patientId: loserId, status: "OPEN" },
      select: { branchId: true },
    });
    const openOnBoth = loserOpen.length
      ? await tx.encounter.count({
          where: {
            patientId: survivorId,
            status: "OPEN",
            branchId: { in: loserOpen.map((e) => e.branchId) },
          },
        })
      : 0;
    if (openOnBoth)
      throw new ConflictError("Both records have an open visit in the same branch. Close one visit first.");

    const moved = {
      appointments: (
        await tx.appointment.updateMany({ where: { patientId: loserId }, data: { patientId: survivorId } })
      ).count,
      encounters: (
        await tx.encounter.updateMany({ where: { patientId: loserId }, data: { patientId: survivorId } })
      ).count,
      careTeam: (
        await tx.careTeamAssignment.updateMany({
          where: { patientId: loserId },
          data: { patientId: survivorId },
        })
      ).count,
      identifiers: (
        await tx.patientIdentifier.updateMany({
          where: { patientId: loserId },
          data: { patientId: survivorId },
        })
      ).count,
      contacts: (
        await tx.patientContact.updateMany({ where: { patientId: loserId }, data: { patientId: survivorId } })
      ).count,
      allergies: (
        await tx.patientAllergy.updateMany({ where: { patientId: loserId }, data: { patientId: survivorId } })
      ).count,
      consents: (
        await tx.consentRecord.updateMany({ where: { patientId: loserId }, data: { patientId: survivorId } })
      ).count,
      guardianLinks: (
        await tx.guardianRelationship.updateMany({
          where: { dependentPatientId: loserId },
          data: { dependentPatientId: survivorId },
        })
      ).count,
      dependentLinks: (
        await tx.guardianRelationship.updateMany({
          where: { guardianPatientId: loserId },
          data: { guardianPatientId: survivorId },
        })
      ).count,
    };
    if (survivor.allergyReviewStatus !== "HAS_ALLERGIES" && moved.allergies > 0) {
      await tx.patient.update({ where: { id: survivorId }, data: { allergyReviewStatus: "HAS_ALLERGIES" } });
    }
    await tx.patient.update({
      where: { id: loserId },
      data: {
        status: "MERGED",
        mergedIntoId: survivorId,
        statusReason: `Merged into ${survivor.mrn}`,
        version: { increment: 1 },
      },
    });
    await tx.patient.update({ where: { id: survivorId }, data: { version: { increment: 1 } } });
    await tx.duplicatePatientReview.update({
      where: { id: review.id },
      data: {
        status: "MERGED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        mergeSummary: { loserMrn: loser.mrn, moved },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.merge.approved",
      resourceType: "Patient",
      resourceId: survivorId,
      patientId: survivorId,
      details: { reviewId: review.id, loserId, requestedById: review.mergeRequestedById, moved },
      meta: ctx.meta,
    });
    return { survivorId, loserId, moved };
  });
}
