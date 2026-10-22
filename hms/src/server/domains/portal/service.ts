import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requirePermission, type AuthContext } from "../../authz/context";
import { getClinicalAccess } from "../../authz/clinical-access";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { hashPassword } from "../../auth/password";
import { issueResetToken } from "../../auth/reset";
import { randomToken } from "../../crypto";
import { getEncounterAccess } from "../clinical/access";

// ───────────── Staff side: accounts and release ─────────────

/**
 * Create a portal login for a patient. Returns a one-time setup token (shown once to staff, who
 * give the link to the patient); no password is ever chosen by staff.
 */
export async function createPortalAccount(
  ctx: AuthContext,
  input: { patientId: string; email: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "portal.accounts.manage");
  const patient = await db.patient.findUnique({ where: { id: input.patientId } });
  if (!patient || patient.status !== "ACTIVE") throw new NotFoundError("Patient not found.");
  if (patient.registrationStatus !== "COMPLETE")
    throw new ValidationError("Complete the patient's registration first.");
  const role = await db.role.findUnique({ where: { code: "PATIENT" } });
  if (!role) throw new ConflictError("The patient portal role is not configured.");
  const email = input.email.trim().toLowerCase();
  try {
    return await withTx(db, async (tx) => {
      const existing = await tx.portalAccount.findUnique({ where: { patientId: patient.id } });
      if (existing && !existing.revokedAt)
        throw new ConflictError("This patient already has a portal account.");
      const user = await tx.user.create({
        data: {
          kind: "PORTAL",
          email,
          givenName: patient.givenName,
          familyName: patient.familyName,
          displayName: `${patient.givenName} ${patient.familyName}`,
          passwordHash: await hashPassword(randomToken(32)),
          mustChangePassword: false,
        },
      });
      await tx.userRole.create({
        data: { userId: user.id, roleId: role.id, allBranches: true, branchId: null },
      });
      if (existing)
        await tx.portalAccount.update({
          where: { id: existing.id },
          data: { userId: user.id, revokedAt: null, revokedById: null },
        });
      else
        await tx.portalAccount.create({
          data: { userId: user.id, patientId: patient.id, createdById: ctx.userId },
        });
      const { token, expiresAt } = await issueResetToken(tx, user.id, ctx.userId, ctx.meta);
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "portal.account.create",
        resourceType: "Patient",
        resourceId: patient.id,
        patientId: patient.id,
        meta: ctx.meta,
      });
      return { userId: user.id, setupToken: token, expiresAt };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That email is already used by another account.");
    throw e;
  }
}

export async function revokePortalAccount(
  ctx: AuthContext,
  input: { patientId: string; reason: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "portal.accounts.manage");
  const acct = await db.portalAccount.findUnique({ where: { patientId: input.patientId } });
  if (!acct || acct.revokedAt) throw new NotFoundError("No active portal account.");
  await withTx(db, async (tx) => {
    await tx.portalAccount.update({
      where: { id: acct.id },
      data: { revokedAt: new Date(), revokedById: ctx.userId },
    });
    await tx.user.update({
      where: { id: acct.userId },
      data: { status: "SUSPENDED", statusReason: input.reason },
    });
    await tx.session.updateMany({
      where: { userId: acct.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "portal.account.revoke",
      resourceType: "Patient",
      resourceId: input.patientId,
      patientId: input.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

/** A clinician releases a verified result to the patient (and verified guardians) on the portal. */
export async function setResultRelease(
  ctx: AuthContext,
  input: { orderId: string; release: boolean },
  db: DbClient = prisma,
) {
  const order = await db.serviceOrder.findUnique({
    where: { id: input.orderId },
    include: { encounter: true },
  });
  if (!order) throw new NotFoundError("Order not found.");
  requirePermission(ctx, "clinical.results.review", { branchId: order.branchId });
  if (!(await getEncounterAccess(ctx, order.encounter, db)))
    throw new ForbiddenError("No care relationship with this patient.", "clinical.read");
  if (!["VERIFIED", "COMPLETED"].includes(order.status))
    throw new ConflictError("Only verified results can be released.");
  await withTx(db, async (tx) => {
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: input.release
        ? { releasedToPortalAt: new Date(), releasedToPortalById: ctx.userId }
        : { releasedToPortalAt: null, releasedToPortalById: null },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.release ? "portal.result.release" : "portal.result.withdraw",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      meta: ctx.meta,
    });
  });
}

export async function setDocumentRelease(
  ctx: AuthContext,
  input: { documentId: string; release: boolean },
  db: DbClient = prisma,
) {
  const doc = await db.document.findUnique({ where: { id: input.documentId } });
  if (!doc || !doc.patientId) throw new NotFoundError("Document not found.");
  requirePermission(ctx, "clinical.note.write");
  const access = await getClinicalAccess(ctx, doc.patientId, db);
  if (!access.allowed) throw new ForbiddenError("No care relationship with this patient.", "clinical.read");
  if (doc.voidedAt) throw new ConflictError("Voided documents cannot be released.");
  await withTx(db, async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: input.release
        ? { releasedToPortalAt: new Date(), releasedToPortalById: ctx.userId }
        : { releasedToPortalAt: null, releasedToPortalById: null },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.release ? "portal.document.release" : "portal.document.withdraw",
      resourceType: "Document",
      resourceId: doc.id,
      patientId: doc.patientId!,
      meta: ctx.meta,
    });
  });
}

// ───────────── Portal side ─────────────

/** The portal user's own patient record and their verified, current dependants. */
export async function portalScope(ctx: AuthContext, db: DbClient = prisma) {
  if (ctx.kind !== "PORTAL" || !can(ctx, "portal.self.read"))
    throw new ForbiddenError(undefined, "portal.self.read");
  const acct = await db.portalAccount.findUnique({ where: { userId: ctx.userId } });
  if (!acct || acct.revokedAt) throw new ForbiddenError("This portal account is not active.");
  const now = new Date();
  const dependants = can(ctx, "portal.dependent.read")
    ? await db.guardianRelationship.findMany({
        where: {
          guardianPatientId: acct.patientId,
          verified: true,
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        select: { dependentPatientId: true, relationship: true },
      })
    : [];
  return {
    selfId: acct.patientId,
    dependantIds: dependants.map((d) => d.dependentPatientId),
    relationships: dependants,
  };
}

async function assertPortalPatient(ctx: AuthContext, patientId: string, db: DbClient) {
  const scope = await portalScope(ctx, db);
  if (patientId !== scope.selfId && !scope.dependantIds.includes(patientId)) {
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "denied.portal.patient",
      resourceType: "Patient",
      resourceId: patientId,
      outcome: "DENIED",
      meta: ctx.meta,
    });
    throw new NotFoundError("Record not found.");
  }
  return scope;
}

/** Released content only: verified results and documents a clinician released, plus appointments. */
export async function portalRecord(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  await assertPortalPatient(ctx, patientId, db);
  const [patient, appointments, results, documents] = await Promise.all([
    db.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        id: true,
        mrn: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        dateOfBirth: true,
      },
    }),
    db.appointment.findMany({
      where: { patientId, startAt: { gte: new Date(Date.now() - 86_400_000) }, status: "BOOKED" },
      orderBy: { startAt: "asc" },
      take: 10,
      select: { id: true, ref: true, startAt: true, visitType: { select: { name: true } } },
    }),
    db.serviceOrder.findMany({
      where: { patientId, releasedToPortalAt: { not: null }, status: { in: ["VERIFIED", "COMPLETED"] } },
      orderBy: { verifiedAt: "desc" },
      take: 50,
      include: {
        results: {
          where: { status: "FINAL", supersededById: null },
          include: { component: { select: { name: true, unit: true } } },
        },
        imagingReports: {
          where: { status: "SIGNED" },
          orderBy: { signedAt: "desc" },
          take: 1,
          select: { impression: true, signedAt: true },
        },
      },
    }),
    db.document.findMany({
      where: { patientId, releasedToPortalAt: { not: null }, voidedAt: null },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, title: true, kind: true, uploadedAt: true, releasedToPortalAt: true },
    }),
  ]);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "portal.record.view",
    resourceType: "Patient",
    resourceId: patientId,
    patientId,
    meta: ctx.meta,
  });
  return { patient, appointments, results, documents };
}

export async function portalHome(ctx: AuthContext, db: DbClient = prisma) {
  const scope = await portalScope(ctx, db);
  const people = await db.patient.findMany({
    where: { id: { in: [scope.selfId, ...scope.dependantIds] } },
    select: { id: true, mrn: true, givenName: true, familyName: true, preferredName: true },
  });
  return { selfId: scope.selfId, people, relationships: scope.relationships };
}

/** Portal download: only released, non-voided documents of the user or a verified dependant. */
export async function authorizePortalDownload(ctx: AuthContext, documentId: string, db: DbClient = prisma) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc || !doc.patientId || !doc.releasedToPortalAt || doc.voidedAt) {
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "denied.portal.document",
      resourceType: "Document",
      resourceId: documentId,
      outcome: "DENIED",
      meta: ctx.meta,
    });
    throw new NotFoundError("Document not found.");
  }
  await assertPortalPatient(ctx, doc.patientId, db);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "portal.document.download",
    resourceType: "Document",
    resourceId: doc.id,
    patientId: doc.patientId,
    meta: ctx.meta,
  });
  return doc;
}
