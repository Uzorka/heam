import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import type { allergySchema, consentSchema, contactSchema, guardianSchema } from "@/lib/schemas/patient";
import { loadScopedPatient } from "./service";

// ───────────── Allergies ─────────────

export async function recordAllergy(
  ctx: AuthContext,
  input: z.output<typeof allergySchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.allergy.record");
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.read", db);
  if (input.source === "CLINICIAN_VERIFIED" && !can(ctx, "patient.allergy.verify")) {
    throw new ForbiddenError("Only clinicians can record a verified allergy. Record it as patient-reported.");
  }
  return withTx(db, async (tx) => {
    const a = await tx.patientAllergy.create({
      data: {
        patientId: patient.id,
        substance: input.substance,
        category: input.category,
        reaction: input.reaction,
        severity: input.severity,
        source: input.source,
        recordedById: ctx.userId,
        ...(input.source === "CLINICIAN_VERIFIED"
          ? { verifiedById: ctx.userId, verifiedAt: new Date() }
          : {}),
      },
    });
    await tx.patient.update({ where: { id: patient.id }, data: { allergyReviewStatus: "HAS_ALLERGIES" } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.allergy.record",
      resourceType: "PatientAllergy",
      resourceId: a.id,
      patientId: patient.id,
      details: { category: input.category, severity: input.severity, source: input.source },
      meta: ctx.meta,
    });
    return a;
  });
}

export async function setNoKnownAllergies(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  requirePermission(ctx, "patient.allergy.record");
  const patient = await loadScopedPatient(ctx, patientId, "patient.read", db);
  const active = await db.patientAllergy.count({ where: { patientId, status: "ACTIVE" } });
  if (active)
    throw new ConflictError(
      "This patient has active allergy entries. Resolve them before recording 'no known allergies'.",
    );
  await withTx(db, async (tx) => {
    await tx.patient.update({
      where: { id: patient.id },
      data: { allergyReviewStatus: "NO_KNOWN_ALLERGIES" },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.allergy.nka",
      resourceType: "Patient",
      resourceId: patient.id,
      patientId: patient.id,
      meta: ctx.meta,
    });
  });
}

export async function changeAllergyStatus(
  ctx: AuthContext,
  input: { allergyId: string; action: "VERIFY" | "INACTIVATE" | "ENTERED_IN_ERROR"; reason?: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.allergy.verify");
  const allergy = await db.patientAllergy.findUnique({ where: { id: input.allergyId } });
  if (!allergy) throw new NotFoundError();
  await loadScopedPatient(ctx, allergy.patientId, "patient.read", db);
  if (allergy.status !== "ACTIVE") throw new ConflictError("Only active entries can be changed.");
  if (input.action !== "VERIFY" && !input.reason) throw new ConflictError("A reason is required.");
  await withTx(db, async (tx) => {
    await tx.patientAllergy.update({
      where: { id: allergy.id },
      data:
        input.action === "VERIFY"
          ? { source: "CLINICIAN_VERIFIED", verifiedById: ctx.userId, verifiedAt: new Date() }
          : {
              status: input.action === "INACTIVATE" ? "INACTIVE" : "ENTERED_IN_ERROR",
              statusReason: input.reason,
            },
    });
    const remaining = await tx.patientAllergy.count({
      where: { patientId: allergy.patientId, status: "ACTIVE" },
    });
    if (!remaining)
      await tx.patient.update({
        where: { id: allergy.patientId },
        data: { allergyReviewStatus: "NOT_ASKED" },
      });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `patient.allergy.${input.action.toLowerCase()}`,
      resourceType: "PatientAllergy",
      resourceId: allergy.id,
      patientId: allergy.patientId,
      meta: ctx.meta,
    });
  });
}

// ───────────── Consents ─────────────

export async function recordConsent(
  ctx: AuthContext,
  input: z.output<typeof consentSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.consent.manage");
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.read", db);
  return withTx(db, async (tx) => {
    await tx.consentRecord.updateMany({
      where: { patientId: patient.id, type: input.type, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const c = await tx.consentRecord.create({
      data: {
        patientId: patient.id,
        type: input.type,
        status: input.status,
        legalBasis:
          input.type === "DATA_PROCESSING_NOTICE" || input.type === "GENERAL_TREATMENT"
            ? "CONTRACT"
            : "CONSENT",
        signatoryName: input.signatoryName,
        signatoryRelationship: input.signatoryRelationship,
        notes: input.notes,
        capturedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.consent.record",
      resourceType: "ConsentRecord",
      resourceId: c.id,
      patientId: patient.id,
      details: { type: input.type, status: input.status },
      meta: ctx.meta,
    });
    return c;
  });
}

/** Has the patient a current GRANTED consent of this type? Used by the notification layer. */
export async function hasActiveConsent(
  db: DbClient,
  patientId: string,
  type: z.output<typeof consentSchema>["type"],
) {
  const c = await db.consentRecord.findFirst({
    where: { patientId, type, supersededAt: null },
    orderBy: { capturedAt: "desc" },
  });
  return c?.status === "GRANTED";
}

// ───────────── Contacts ─────────────

export async function addContact(
  ctx: AuthContext,
  input: z.output<typeof contactSchema>,
  db: DbClient = prisma,
) {
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.update", db);
  return withTx(db, async (tx) => {
    if (input.isPrimary) {
      await tx.patientContact.updateMany({ where: { patientId: patient.id }, data: { isPrimary: false } });
    }
    const c = await tx.patientContact.create({
      data: {
        patientId: patient.id,
        kind: input.kind,
        name: input.name,
        relationship: input.relationship,
        phoneE164: input.phone,
        addressLine: input.addressLine,
        isPrimary: input.isPrimary,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.contact.add",
      resourceType: "PatientContact",
      resourceId: c.id,
      patientId: patient.id,
      meta: ctx.meta,
    });
    return c;
  });
}

export async function deactivateContact(ctx: AuthContext, contactId: string, db: DbClient = prisma) {
  const contact = await db.patientContact.findUnique({ where: { id: contactId } });
  if (!contact) throw new NotFoundError();
  await loadScopedPatient(ctx, contact.patientId, "patient.update", db);
  await withTx(db, async (tx) => {
    await tx.patientContact.update({ where: { id: contactId }, data: { active: false, isPrimary: false } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.contact.deactivate",
      resourceType: "PatientContact",
      resourceId: contactId,
      patientId: contact.patientId,
      meta: ctx.meta,
    });
  });
}

// ───────────── Guardians ─────────────

export async function addGuardian(
  ctx: AuthContext,
  input: z.output<typeof guardianSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.guardian.manage");
  const dependent = await loadScopedPatient(ctx, input.dependentPatientId, "patient.read", db);
  if (input.guardianPatientId) {
    if (input.guardianPatientId === dependent.id)
      throw new ConflictError("A patient cannot be their own guardian.");
    await loadScopedPatient(ctx, input.guardianPatientId, "patient.read", db);
  }
  return withTx(db, async (tx) => {
    const g = await tx.guardianRelationship.create({
      data: {
        dependentPatientId: dependent.id,
        guardianPatientId: input.guardianPatientId,
        guardianName: input.guardianName,
        guardianPhoneE164: input.guardianPhone,
        relationship: input.relationship,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.guardian.add",
      resourceType: "GuardianRelationship",
      resourceId: g.id,
      patientId: dependent.id,
      meta: ctx.meta,
    });
    return g;
  });
}

export async function verifyGuardian(
  ctx: AuthContext,
  input: { relationshipId: string; evidence: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.guardian.verify");
  const g = await db.guardianRelationship.findUnique({ where: { id: input.relationshipId } });
  if (!g || g.revokedAt) throw new NotFoundError();
  await loadScopedPatient(ctx, g.dependentPatientId, "patient.read", db);
  if (g.createdById === ctx.userId) {
    throw new ForbiddenError(
      "Verification must be done by someone other than the person who recorded the link.",
    );
  }
  await withTx(db, async (tx) => {
    await tx.guardianRelationship.update({
      where: { id: g.id },
      data: {
        verified: true,
        verifiedById: ctx.userId,
        verifiedAt: new Date(),
        verificationEvidence: input.evidence,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.guardian.verify",
      resourceType: "GuardianRelationship",
      resourceId: g.id,
      patientId: g.dependentPatientId,
      meta: ctx.meta,
    });
  });
}

export async function revokeGuardian(
  ctx: AuthContext,
  input: { relationshipId: string; reason: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "patient.guardian.manage");
  const g = await db.guardianRelationship.findUnique({ where: { id: input.relationshipId } });
  if (!g || g.revokedAt) throw new NotFoundError();
  await loadScopedPatient(ctx, g.dependentPatientId, "patient.read", db);
  await withTx(db, async (tx) => {
    await tx.guardianRelationship.update({
      where: { id: g.id },
      data: { revokedAt: new Date(), revokedReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "patient.guardian.revoke",
      resourceType: "GuardianRelationship",
      resourceId: g.id,
      patientId: g.dependentPatientId,
      meta: ctx.meta,
    });
  });
}
