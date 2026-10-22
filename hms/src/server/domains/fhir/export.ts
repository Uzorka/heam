import { prisma, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, type AuthContext } from "../../authz/context";
import { getClinicalAccess } from "../../authz/clinical-access";
import { ForbiddenError, NotFoundError } from "../../errors";
import {
  bundle,
  toFhirEncounter,
  toFhirMedicationRequest,
  toFhirPatient,
  toFhirVitalObservations,
} from "./mappers";

const num = (v: { toNumber(): number } | number | null) =>
  v === null ? null : typeof v === "number" ? v : v.toNumber();

/**
 * FHIR R4 export of one patient's core record (Patient, Encounters, vital-sign Observations,
 * MedicationRequests). Needs export.data AND a clinical relationship with the patient; every
 * attempt is audited. Entered-in-error vitals and draft prescriptions are excluded.
 */
export async function exportPatientFhir(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  const deny = async (reason: string) => {
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "denied.export.fhir",
      resourceType: "Patient",
      resourceId: patientId,
      outcome: "DENIED",
      details: { reason },
      meta: ctx.meta,
    });
  };
  if (!can(ctx, "export.data")) {
    await deny("permission");
    throw new ForbiddenError(undefined, "export.data");
  }
  const patient = await db.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");
  const access = await getClinicalAccess(ctx, patientId, db);
  if (!access.allowed) {
    await deny("no_care_relationship");
    throw new ForbiddenError("No care relationship with this patient.", "clinical.read");
  }
  const [encounters, vitals, items] = await Promise.all([
    db.encounter.findMany({
      where: { patientId },
      orderBy: { arrivedAt: "asc" },
      include: { visitType: { select: { name: true } }, admission: { select: { id: true } } },
    }),
    db.vitalSign.findMany({ where: { patientId, enteredInErrorAt: null, encounterId: { not: null } } }),
    db.prescriptionItem.findMany({
      where: { prescription: { patientId, status: { not: "DRAFT" } } },
      include: {
        prescription: true,
        medication: { select: { genericName: true, strength: true, dispensingUnit: true } },
        frequency: { select: { label: true, timesPerDay: true } },
      },
    }),
  ]);
  const entries: Record<string, unknown>[] = [
    toFhirPatient(patient),
    ...encounters.map((e) =>
      toFhirEncounter({
        id: e.id,
        ref: e.ref,
        patientId,
        status: e.status,
        arrivedAt: e.arrivedAt,
        completedAt: e.completedAt,
        visitTypeName: e.visitType.name,
        inpatient: !!e.admission,
      }),
    ),
    ...vitals.flatMap((v) =>
      toFhirVitalObservations({
        id: v.id,
        patientId,
        encounterId: v.encounterId!,
        measuredAt: v.measuredAt,
        values: {
          temperatureC: num(v.temperatureC),
          pulseBpm: v.pulseBpm,
          respRatePerMin: v.respRatePerMin,
          spo2Pct: v.spo2Pct,
          weightKg: num(v.weightKg),
          heightCm: num(v.heightCm),
        },
        systolicMmHg: v.systolicMmHg,
        diastolicMmHg: v.diastolicMmHg,
      }),
    ),
    ...items.map((i) =>
      toFhirMedicationRequest({
        id: i.id,
        prescriptionStatus: i.prescription.status,
        itemStatus: i.status,
        patientId,
        encounterId: i.prescription.encounterId,
        prescriberId: i.prescription.prescriberId,
        signedAt: i.prescription.signedAt,
        medication: `${i.medication.genericName} ${i.medication.strength}`,
        dose: i.dose,
        route: i.route,
        frequency: i.frequency.label,
        timesPerDay: num(i.frequency.timesPerDay),
        durationDays: i.durationDays,
        prn: i.prn,
        quantity: i.quantity,
        unit: i.medication.dispensingUnit,
        instructions: i.instructions,
      }),
    ),
  ];
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "export.fhir",
    resourceType: "Patient",
    resourceId: patientId,
    patientId,
    details: { resources: entries.length, basis: access.basis },
    meta: ctx.meta,
  });
  return bundle(entries);
}
