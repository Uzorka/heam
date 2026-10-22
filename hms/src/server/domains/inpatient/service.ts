import type { Admission } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { isUniqueViolation } from "../../db-errors";
import { confirmSignature, confirmWitness } from "../../auth/reauth";
import { todayLocal, toLocalDateString } from "@/lib/time";
import { nightsBetween } from "@/lib/obstetrics";
import { formatNaira } from "@/lib/money";
import type {
  admitSchema,
  authoriseDischargeSchema,
  bedMoveSchema,
  clearanceSchema,
  marSchema,
} from "@/lib/schemas/inpatient";
import { getEncounterAccess } from "../clinical/access";
import { createCharge, invoiceTotals } from "../billing/charges";

const year = () => Number(todayLocal().slice(0, 4));
const CURRENT = ["ADMITTED", "DISCHARGE_AUTHORISED"] as const;

async function loadAdmission(
  ctx: AuthContext,
  id: string,
  permission: Parameters<typeof requirePermission>[1],
  db: DbClient,
) {
  const a = await db.admission.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Admission not found.");
  if (!can(ctx, "admission.read", { branchId: a.branchId })) throw new NotFoundError("Admission not found.");
  requirePermission(ctx, permission, { branchId: a.branchId });
  return a;
}

/**
 * Put a patient into a bed. The bed row is locked and must be free; the exclusion constraint on
 * bed assignments is the final guard, so two staff assigning the same bed at once get one winner.
 */
async function occupyBed(
  tx: Tx,
  admission: Pick<Admission, "id" | "branchId">,
  bedId: string,
  userId: string,
  reason?: string | null,
) {
  const [bed] = await tx.$queryRaw<{ id: string; status: string; active: boolean; wardId: string }[]>`
    SELECT "id", "status", "active", "wardId" FROM "Bed" WHERE "id" = ${bedId}::uuid FOR UPDATE`;
  if (!bed || !bed.active) throw new NotFoundError("Bed not found.");
  const ward = await tx.ward.findUniqueOrThrow({ where: { id: bed.wardId } });
  if (ward.branchId !== admission.branchId) throw new ValidationError("That bed is in another branch.");
  if (bed.status !== "FREE")
    throw new ConflictError(`That bed is ${bed.status.toLowerCase()}.`, "BED_UNAVAILABLE");
  const now = new Date();
  const open = await tx.bedAssignment.findFirst({ where: { admissionId: admission.id, endAt: null } });
  if (open) {
    await tx.bedAssignment.update({ where: { id: open.id }, data: { endAt: now, endedById: userId } });
    await tx.bed.update({
      where: { id: open.bedId },
      data: { status: "CLEANING", version: { increment: 1 } },
    });
  }
  try {
    const a = await tx.bedAssignment.create({
      data: { admissionId: admission.id, bedId, startAt: now, assignedById: userId, reason: reason ?? null },
    });
    await tx.bed.update({ where: { id: bedId }, data: { status: "OCCUPIED", version: { increment: 1 } } });
    return a;
  } catch (e) {
    if (String(e).includes("BedAssignment_no_overlap"))
      throw new ConflictError("That bed was just taken by someone else.", "BED_UNAVAILABLE");
    throw e;
  }
}

export async function admit(ctx: AuthContext, input: z.output<typeof admitSchema>, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "admission.manage", { branchId: enc.branchId });
  if (enc.status !== "OPEN") throw new ConflictError("Only an open visit can become an admission.");
  if (!(await getEncounterAccess(ctx, enc, db)))
    throw new ForbiddenError("You have no care relationship with this patient.", "clinical.read");
  const ward = await db.ward.findUnique({ where: { id: input.wardId } });
  if (!ward?.active || ward.branchId !== enc.branchId)
    throw new ValidationError("Choose an active ward in this branch.");
  try {
    return await withTx(db, async (tx) => {
      const adm = await tx.admission.create({
        data: {
          ref: await nextYearlyRef(tx, "ADM", year()),
          patientId: enc.patientId,
          encounterId: enc.id,
          branchId: enc.branchId,
          reason: input.reason,
          admittedById: ctx.userId,
          attendingClinicianId: input.attendingClinicianId ?? enc.attendingClinicianId ?? null,
        },
      });
      if (input.bedId) {
        const bed = await tx.bed.findUnique({ where: { id: input.bedId } });
        if (!bed || bed.wardId !== ward.id) throw new ValidationError("That bed is not in the chosen ward.");
        await occupyBed(tx, adm, input.bedId, ctx.userId, "Admission");
      }
      const r = await tx.encounter.updateMany({
        where: { id: enc.id, version: enc.version, status: "OPEN" },
        data: { queueStage: "ADMITTED", version: { increment: 1 } },
      });
      if (r.count !== 1) throw new ConflictError("The visit changed. Refresh and try again.", "STALE");
      await tx.visitQueueEvent.create({
        data: {
          encounterId: enc.id,
          fromStage: enc.queueStage,
          toStage: "ADMITTED",
          changedById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "admission.admit",
        resourceType: "Admission",
        resourceId: adm.id,
        patientId: enc.patientId,
        details: { ref: adm.ref, ward: ward.code, bedId: input.bedId ?? null },
        meta: ctx.meta,
      });
      return adm;
    });
  } catch (e) {
    if (isUniqueViolation(e) || String(e).includes("Admission_one_current"))
      throw new ConflictError("This patient is already admitted.");
    throw e;
  }
}

/** Assign a first bed, or move to another bed/ward. The old bed goes to cleaning. */
export async function moveBed(
  ctx: AuthContext,
  input: z.output<typeof bedMoveSchema>,
  db: DbClient = prisma,
) {
  const adm = await loadAdmission(ctx, input.admissionId, "admission.manage", db);
  if (!CURRENT.includes(adm.status as (typeof CURRENT)[number]))
    throw new ConflictError("This patient is no longer admitted.");
  return withTx(db, async (tx) => {
    const a = await occupyBed(tx, adm, input.bedId, ctx.userId, input.reason);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "admission.bed",
      resourceType: "Admission",
      resourceId: adm.id,
      patientId: adm.patientId,
      details: { bedId: input.bedId, reason: input.reason ?? null },
      meta: ctx.meta,
    });
    return a;
  });
}

export async function markBedReady(ctx: AuthContext, bedId: string, db: DbClient = prisma) {
  const bed = await db.bed.findUnique({ where: { id: bedId }, include: { ward: true } });
  if (!bed) throw new NotFoundError("Bed not found.");
  requirePermission(ctx, "admission.manage", { branchId: bed.ward.branchId });
  if (bed.status !== "CLEANING") throw new ConflictError("Only beds being cleaned can be made ready.");
  await withTx(db, async (tx) => {
    await tx.bed.update({ where: { id: bed.id }, data: { status: "FREE", version: { increment: 1 } } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "admission.bed.ready",
      resourceType: "Bed",
      resourceId: bed.id,
      meta: ctx.meta,
    });
  });
}

/** Clinical decision to discharge, signed with the clinician's password. */
export async function authoriseDischarge(
  ctx: AuthContext,
  input: z.output<typeof authoriseDischargeSchema>,
  db: DbClient = prisma,
) {
  const adm = await loadAdmission(ctx, input.admissionId, "discharge.authorize", db);
  if (adm.status !== "ADMITTED")
    throw new ConflictError("Discharge has already been authorised or completed.");
  const enc = await db.encounter.findUniqueOrThrow({ where: { id: adm.encounterId } });
  if (!(await getEncounterAccess(ctx, enc, db)))
    throw new ForbiddenError("You have no care relationship with this patient.", "clinical.read");
  await confirmSignature(db, ctx, input.password);
  await withTx(db, async (tx) => {
    const r = await tx.admission.updateMany({
      where: { id: adm.id, version: adm.version, status: "ADMITTED" },
      data: {
        status: "DISCHARGE_AUTHORISED",
        dischargeAuthorisedAt: new Date(),
        dischargeAuthorisedById: ctx.userId,
        dischargeSummary: input.summary,
        dischargeDestination: input.destination,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("The admission changed. Refresh and try again.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "admission.discharge.authorise",
      resourceType: "Admission",
      resourceId: adm.id,
      patientId: adm.patientId,
      details: { destination: input.destination },
      meta: ctx.meta,
    });
  });
}

/** Bed-day charges per bed assignment (ward mapped to a service), idempotent per assignment. */
export async function postBedCharges(tx: Tx, adm: Pick<Admission, "id" | "encounterId">, userId: string) {
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: adm.encounterId } });
  const assignments = await tx.bedAssignment.findMany({
    where: { admissionId: adm.id },
    include: { bed: true },
  });
  const today = todayLocal();
  for (const a of assignments) {
    const item = await tx.serviceItem.findUnique({ where: { wardId: a.bed.wardId } });
    if (!item?.active) continue;
    const nights = nightsBetween(toLocalDateString(a.startAt), a.endAt ? toLocalDateString(a.endAt) : today);
    await createCharge(tx, {
      enc,
      serviceItemId: item.id,
      description: `${item.name} (${nights} night${nights === 1 ? "" : "s"})`,
      quantity: nights,
      sourceType: "BED",
      sourceId: a.id,
      userId,
    });
  }
}

/**
 * Finance clears the discharge: bed charges are posted, then the visit's bills must be settled -
 * or an explicit, recorded override (e.g. HMO share pending, approved credit).
 */
export async function financialClearance(
  ctx: AuthContext,
  input: z.output<typeof clearanceSchema>,
  db: DbClient = prisma,
) {
  const adm = await loadAdmission(ctx, input.admissionId, "discharge.clear_finance", db);
  if (adm.status !== "DISCHARGE_AUTHORISED")
    throw new ConflictError("A clinician must authorise discharge first.");
  if (adm.financialClearanceAt) throw new ConflictError("Already cleared.");
  if (input.override && !input.note)
    throw new ValidationError("Record why discharge is cleared with a balance.");
  // Bed-days are owed whatever happens next, so they are committed before the balance check.
  await withTx(db, (tx) => postBedCharges(tx, adm, ctx.userId));
  return withTx(db, async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { encounterId: adm.encounterId, status: { not: "VOID" } },
    });
    let outstanding = 0n;
    let unresolved = 0;
    for (const inv of invoices) {
      const t = await invoiceTotals(tx, inv.id);
      outstanding += t.outstanding;
      unresolved += t.unresolved;
    }
    if ((outstanding > 0n || unresolved > 0) && !input.override)
      throw new ConflictError(
        `Not cleared: ${formatNaira(outstanding)} outstanding${unresolved ? `, ${unresolved} charge(s) unresolved` : ""}. Settle the bill or record an override.`,
        "BALANCE_OUTSTANDING",
      );
    await tx.admission.update({
      where: { id: adm.id },
      data: {
        financialClearanceAt: new Date(),
        financialClearanceById: ctx.userId,
        financialClearanceNote: input.override
          ? `Override with ${formatNaira(outstanding)} outstanding: ${input.note}`
          : (input.note ?? "Settled"),
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.override ? "admission.clearance.override" : "admission.clearance",
      resourceType: "Admission",
      resourceId: adm.id,
      patientId: adm.patientId,
      details: { outstanding: outstanding.toString(), unresolved },
      meta: ctx.meta,
    });
    return { outstanding, unresolved };
  });
}

/** Patient leaves: bed released to cleaning, admission closed, visit completed. */
export async function completeDischarge(ctx: AuthContext, admissionId: string, db: DbClient = prisma) {
  const adm = await loadAdmission(ctx, admissionId, "admission.manage", db);
  if (adm.status !== "DISCHARGE_AUTHORISED") throw new ConflictError("Discharge has not been authorised.");
  if (!adm.financialClearanceAt)
    throw new ConflictError("Finance has not cleared this discharge.", "NOT_CLEARED");
  await withTx(db, async (tx) => {
    const now = new Date();
    const open = await tx.bedAssignment.findFirst({ where: { admissionId: adm.id, endAt: null } });
    if (open) {
      await tx.bedAssignment.update({ where: { id: open.id }, data: { endAt: now, endedById: ctx.userId } });
      await tx.bed.update({
        where: { id: open.bedId },
        data: { status: "CLEANING", version: { increment: 1 } },
      });
    }
    const r = await tx.admission.updateMany({
      where: { id: adm.id, status: "DISCHARGE_AUTHORISED" },
      data: {
        status: "DISCHARGED",
        dischargedAt: now,
        dischargedById: ctx.userId,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("Already discharged.", "STALE");
    const enc = await tx.encounter.findUniqueOrThrow({ where: { id: adm.encounterId } });
    await tx.encounter.update({
      where: { id: enc.id },
      data: { status: "COMPLETED", queueStage: "COMPLETED", completedAt: now, version: { increment: 1 } },
    });
    await tx.visitQueueEvent.create({
      data: { encounterId: enc.id, fromStage: enc.queueStage, toStage: "COMPLETED", changedById: ctx.userId },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "admission.discharge.complete",
      resourceType: "Admission",
      resourceId: adm.id,
      patientId: adm.patientId,
      meta: ctx.meta,
    });
  });
}

// ───────────── Medication administration (MAR) ─────────────

export async function recordAdministration(
  ctx: AuthContext,
  input: z.output<typeof marSchema>,
  db: DbClient = prisma,
) {
  const enc = await db.encounter.findUnique({
    where: { id: input.encounterId },
    include: { admission: true },
  });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "nursing.mar.record", { branchId: enc.branchId });
  if (!(await getEncounterAccess(ctx, enc, db)))
    throw new ForbiddenError("You have no care relationship with this patient.", "clinical.read");
  const item = await db.prescriptionItem.findUnique({
    where: { id: input.prescriptionItemId },
    include: { prescription: true, medication: true },
  });
  if (!item || item.prescription.patientId !== enc.patientId)
    throw new ValidationError("That medicine is not prescribed for this patient.");
  if (item.prescription.status === "DRAFT" || item.status === "CANCELLED")
    throw new ConflictError("That prescription item is not active.");
  if (input.status !== "GIVEN" && !input.reason)
    throw new ValidationError("Record why the dose was not given.");
  let witnessId: string | null = null;
  if (item.medication.controlled && input.status === "GIVEN") {
    if (!input.witnessEmail || !input.witnessPassword)
      throw new ValidationError("A second nurse must witness controlled-drug administration.", {
        witnessEmail: "Required",
      });
    witnessId = await confirmWitness(
      db,
      ctx,
      input.witnessEmail,
      input.witnessPassword,
      "nursing.mar.record",
      enc.branchId,
    );
  }
  return withTx(db, async (tx) => {
    const m = await tx.medicationAdministration.create({
      data: {
        admissionId: enc.admission?.id ?? null,
        encounterId: enc.id,
        prescriptionItemId: item.id,
        patientId: enc.patientId,
        administeredAt: new Date(),
        status: input.status,
        doseGiven: input.doseGiven ?? (input.status === "GIVEN" ? item.dose : null),
        route: input.route ?? (input.status === "GIVEN" ? item.route : null),
        reason: input.reason ?? null,
        recordedById: ctx.userId,
        witnessedById: witnessId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: item.medication.controlled ? "nursing.mar.controlled" : "nursing.mar.record",
      resourceType: "MedicationAdministration",
      resourceId: m.id,
      patientId: enc.patientId,
      details: { status: input.status, witnessed: !!witnessId },
      meta: ctx.meta,
    });
    return m;
  });
}

export async function markAdministrationError(
  ctx: AuthContext,
  input: { id: string; reason: string },
  db: DbClient = prisma,
) {
  const m = await db.medicationAdministration.findUnique({
    where: { id: input.id },
    include: { item: { include: { prescription: true } } },
  });
  if (!m) throw new NotFoundError("Record not found.");
  requirePermission(ctx, "nursing.mar.record", { branchId: m.item.prescription.branchId });
  if (
    m.recordedById !== ctx.userId &&
    !can(ctx, "clinical.read.branch_wide", { branchId: m.item.prescription.branchId })
  )
    throw new ForbiddenError(
      "Only the person who recorded it or a supervisor can mark it in error.",
      "nursing.mar.record",
    );
  if (m.enteredInErrorAt) throw new ConflictError("Already marked.");
  await withTx(db, async (tx) => {
    await tx.medicationAdministration.update({
      where: { id: m.id },
      data: { enteredInErrorAt: new Date(), errorReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "nursing.mar.entered_in_error",
      resourceType: "MedicationAdministration",
      resourceId: m.id,
      patientId: m.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

// ───────────── Queries ─────────────

/** Ward board: beds with occupants in the acting branch (identity and stay only, no clinical detail). */
export async function wardBoard(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "admission.read");
  const [wards, unassigned] = await Promise.all([
    db.ward.findMany({
      where: { branchId, active: true },
      orderBy: { code: "asc" },
      include: {
        beds: {
          where: { active: true },
          orderBy: { code: "asc" },
          include: {
            assignments: {
              where: { endAt: null },
              include: {
                admission: {
                  select: {
                    id: true,
                    ref: true,
                    status: true,
                    admittedAt: true,
                    encounterId: true,
                    patient: {
                      select: { id: true, mrn: true, givenName: true, familyName: true, preferredName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.admission.findMany({
      where: { branchId, status: { in: [...CURRENT] }, assignments: { none: { endAt: null } } },
      orderBy: { admittedAt: "asc" },
      select: {
        id: true,
        ref: true,
        status: true,
        admittedAt: true,
        encounterId: true,
        reason: true,
        patient: { select: { id: true, mrn: true, givenName: true, familyName: true, preferredName: true } },
      },
    }),
  ]);
  return { wards, unassigned };
}

export async function getAdmission(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const adm = await db.admission.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          id: true,
          mrn: true,
          givenName: true,
          familyName: true,
          preferredName: true,
          sexAtBirth: true,
          dateOfBirth: true,
        },
      },
      encounter: { select: { id: true, ref: true, status: true, payerClass: true } },
      assignments: {
        orderBy: { startAt: "asc" },
        include: { bed: { include: { ward: { select: { name: true, code: true } } } } },
      },
    },
  });
  if (!adm || !can(ctx, "admission.read", { branchId: adm.branchId }))
    throw new NotFoundError("Admission not found.");
  const users = await db.user.findMany({
    where: {
      id: {
        in: [
          adm.admittedById,
          adm.dischargeAuthorisedById,
          adm.financialClearanceById,
          adm.dischargedById,
          adm.attendingClinicianId,
        ].filter((x): x is string => !!x),
      },
    },
    select: { id: true, displayName: true },
  });
  return { adm, who: (id: string | null) => users.find((u) => u.id === id)?.displayName ?? null };
}

/** MAR view for a visit: active prescription items and their administration history. */
export async function marForEncounter(encounterId: string, db: DbClient = prisma) {
  const items = await db.prescriptionItem.findMany({
    where: {
      prescription: { encounterId, status: { in: ["SIGNED", "COMPLETED"] } },
      status: { not: "CANCELLED" },
    },
    include: {
      medication: true,
      frequency: { select: { code: true, label: true } },
      prescription: { select: { ref: true } },
      administrations: { orderBy: { administeredAt: "desc" }, take: 20 },
    },
  });
  const users = await db.user.findMany({
    where: {
      id: {
        in: items.flatMap((i) =>
          i.administrations.flatMap((a) => [a.recordedById, a.witnessedById ?? a.recordedById]),
        ),
      },
    },
    select: { id: true, displayName: true },
  });
  return { items, who: (id: string | null) => users.find((u) => u.id === id)?.displayName ?? "" };
}

export async function availableBeds(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "admission.read");
  return db.bed.findMany({
    where: { active: true, status: "FREE", ward: { branchId, active: true } },
    orderBy: [{ ward: { code: "asc" } }, { code: "asc" }],
    include: { ward: { select: { id: true, name: true, code: true } } },
  });
}
