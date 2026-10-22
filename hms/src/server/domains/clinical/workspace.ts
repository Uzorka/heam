import { prisma, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, type AuthContext } from "../../authz/context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { formatAge } from "@/lib/time";
import { getEncounterAccess } from "./access";
import { listEncounterNotes } from "./notes";
import { approvedThresholds, vitalsView } from "./observations";
import { requireChartAccess } from "./access";

const orderInclude = {
  labTest: { include: { components: { orderBy: { sortOrder: "asc" as const } } } },
  imagingStudy: true,
  orderedBy: { select: { displayName: true } },
  reviewedBy: { select: { displayName: true } },
  results: {
    where: { status: "FINAL" as const },
    orderBy: { verifiedAt: "asc" as const },
    include: { verifiedBy: { select: { displayName: true } }, component: { select: { name: true, sortOrder: true } } },
  },
  imagingReports: { where: { status: "SIGNED" as const }, orderBy: { signedAt: "asc" as const }, include: { signedBy: { select: { displayName: true } } } },
  criticalAlerts: true,
  documents: { where: { voidedAt: null }, select: { id: true, title: true, filename: true, source: true, sourceDescription: true, scanStatus: true, uploadedAt: true } },
};

/** Everything needed to document one visit. Viewing is audited with the access basis. */
export async function getEncounterWorkspace(ctx: AuthContext, encounterId: string, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: true,
      visitType: { select: { name: true } },
      attending: { select: { id: true, displayName: true } },
      careTeam: { where: { endedAt: null }, include: { user: { select: { displayName: true, jobTitle: true } } } },
    },
  });
  if (!enc) throw new NotFoundError("Visit not found.");
  if (!can(ctx, "encounter.read", { branchId: enc.branchId })) throw new ForbiddenError(undefined, "encounter.read");
  const access = await getEncounterAccess(ctx, enc, db);
  if (!access) {
    await recordAudit(db, { actorType: "USER", actorUserId: ctx.userId, action: "denied.clinical.encounter", resourceType: "Encounter", resourceId: enc.id, patientId: enc.patientId, outcome: "DENIED", meta: ctx.meta });
    throw new ForbiddenError("Clinical record restricted: no care relationship.", "clinical.read");
  }
  const [allergies, vitals, triage, notes, diagnoses, orders, thresholds, problemList] = await Promise.all([
    db.patientAllergy.findMany({ where: { patientId: enc.patientId, status: "ACTIVE" }, orderBy: { recordedAt: "desc" } }),
    db.vitalSign.findMany({ where: { encounterId: enc.id }, orderBy: { measuredAt: "desc" }, include: { recordedBy: { select: { displayName: true } } } }),
    db.triageRecord.findMany({ where: { encounterId: enc.id }, orderBy: { recordedAt: "desc" }, include: { recordedBy: { select: { displayName: true } } } }),
    listEncounterNotes(ctx, enc.id, db),
    db.diagnosis.findMany({ where: { encounterId: enc.id }, orderBy: [{ isPrimary: "desc" }, { recordedAt: "asc" }], include: { recordedBy: { select: { displayName: true } } } }),
    db.serviceOrder.findMany({ where: { encounterId: enc.id }, orderBy: { orderedAt: "asc" }, include: orderInclude }),
    approvedThresholds(db),
    access.level === "FULL"
      ? db.diagnosis.findMany({ where: { patientId: enc.patientId, onProblemList: true, status: "ACTIVE", NOT: { encounterId: enc.id } }, orderBy: { recordedAt: "desc" }, take: 20 })
      : Promise.resolve(null),
  ]);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "clinical.encounter.view",
    resourceType: "Encounter",
    resourceId: enc.id,
    patientId: enc.patientId,
    branchId: enc.branchId,
    details: { level: access.level, basis: access.basis },
    meta: ctx.meta,
  });
  return {
    enc,
    access,
    age: enc.patient.dateOfBirth ? formatAge(enc.patient.dateOfBirth) : null,
    allergies,
    vitals: vitals.map((v) => ({ ...v, ...vitalsView(v, thresholds) })),
    thresholdsConfigured: thresholds.length > 0,
    triage,
    notes,
    diagnoses,
    orders,
    problemList,
  };
}

/** Longitudinal clinical history - requires record-level access (not just an open visit). */
export async function getClinicalHistory(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  const access = await requireChartAccess(ctx, patientId, "chart", db);
  const [encounters, problemList, vitals, results, thresholds] = await Promise.all([
    db.encounter.findMany({
      where: { patientId },
      orderBy: { arrivedAt: "desc" },
      take: 50,
      include: {
        visitType: { select: { name: true } },
        attending: { select: { displayName: true } },
        diagnoses: { where: { status: { not: "ENTERED_IN_ERROR" } }, orderBy: { isPrimary: "desc" } },
        notes: { where: { status: "SIGNED" }, orderBy: { signedAt: "asc" }, include: { author: { select: { displayName: true } } } },
      },
    }),
    db.diagnosis.findMany({ where: { patientId, onProblemList: true, status: "ACTIVE" }, orderBy: { recordedAt: "desc" } }),
    db.vitalSign.findMany({ where: { patientId, enteredInErrorAt: null }, orderBy: { measuredAt: "desc" }, take: 30 }),
    db.serviceOrder.findMany({ where: { patientId, status: { in: ["VERIFIED", "COMPLETED"] } }, orderBy: { verifiedAt: "desc" }, take: 50, include: orderInclude }),
    approvedThresholds(db),
  ]);
  return { access, encounters, problemList, vitals: vitals.map((v) => ({ ...v, ...vitalsView(v, thresholds) })), results };
}

/** Verified results awaiting the clinician's review, for patients they ordered or care for. */
export async function resultsInbox(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "clinical.results.review");
  return db.serviceOrder.findMany({
    where: {
      branchId,
      status: { in: ["VERIFIED"] },
      reviewedAt: null,
      OR: [{ orderedById: ctx.userId }, { encounter: { careTeam: { some: { userId: ctx.userId, endedAt: null } } } }],
    },
    orderBy: { verifiedAt: "asc" },
    take: 100,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      criticalAlerts: { select: { id: true, acknowledgedAt: true } },
      results: { where: { status: "FINAL", supersededAt: null }, select: { flag: true } },
    },
  });
}
