/**
 * FHIR R4 mapping foundation (export only). Pure functions from database rows to resources, so the
 * mapping can be unit-tested and reviewed. Identifiers use the hospital's own namespace; national
 * identifier systems are added only once the hospital has confirmed them.
 */
export const SYSTEMS = {
  mrn: "urn:aduraking:hms:mrn",
  encounter: "urn:aduraking:hms:encounter",
  loinc: "http://loinc.org",
  ucum: "http://unitsofmeasure.org",
  icd10: "http://hl7.org/fhir/sid/icd-10",
  obsCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
};

const GENDER: Record<string, string> = {
  FEMALE: "female",
  MALE: "male",
  INTERSEX: "other",
  UNKNOWN: "unknown",
};

export function toFhirPatient(p: {
  id: string;
  mrn: string;
  givenName: string;
  middleName: string | null;
  familyName: string;
  sexAtBirth: string;
  dateOfBirth: Date | null;
  phoneE164: string | null;
  status: string;
}) {
  return {
    resourceType: "Patient",
    id: p.id,
    identifier: [{ system: SYSTEMS.mrn, value: p.mrn }],
    active: p.status === "ACTIVE",
    name: [
      {
        use: "official",
        family: p.familyName,
        given: [p.givenName, ...(p.middleName ? [p.middleName] : [])],
      },
    ],
    gender: GENDER[p.sexAtBirth] ?? "unknown",
    ...(p.dateOfBirth ? { birthDate: p.dateOfBirth.toISOString().slice(0, 10) } : {}),
    ...(p.phoneE164 ? { telecom: [{ system: "phone", value: p.phoneE164, use: "mobile" }] } : {}),
    ...(p.status === "DECEASED" ? { deceasedBoolean: true } : {}),
  };
}

const ENCOUNTER_STATUS: Record<string, string> = {
  OPEN: "in-progress",
  COMPLETED: "finished",
  CANCELLED: "cancelled",
};

export function toFhirEncounter(e: {
  id: string;
  ref: string;
  patientId: string;
  status: string;
  arrivedAt: Date;
  completedAt: Date | null;
  visitTypeName: string;
  inpatient: boolean;
}) {
  return {
    resourceType: "Encounter",
    id: e.id,
    identifier: [{ system: SYSTEMS.encounter, value: e.ref }],
    status: ENCOUNTER_STATUS[e.status] ?? "unknown",
    class: {
      system: SYSTEMS.actCode,
      code: e.inpatient ? "IMP" : "AMB",
      display: e.inpatient ? "inpatient encounter" : "ambulatory",
    },
    type: [{ text: e.visitTypeName }],
    subject: { reference: `Patient/${e.patientId}` },
    period: {
      start: e.arrivedAt.toISOString(),
      ...(e.completedAt ? { end: e.completedAt.toISOString() } : {}),
    },
  };
}

/** LOINC codes for the vital signs the system records (standard FHIR vital-signs profile codes). */
export const VITAL_LOINC: Record<string, { code: string; display: string; unit: string; ucum: string }> = {
  temperatureC: { code: "8310-5", display: "Body temperature", unit: "°C", ucum: "Cel" },
  pulseBpm: { code: "8867-4", display: "Heart rate", unit: "beats/min", ucum: "/min" },
  respRatePerMin: { code: "9279-1", display: "Respiratory rate", unit: "breaths/min", ucum: "/min" },
  spo2Pct: {
    code: "59408-5",
    display: "Oxygen saturation in Arterial blood by Pulse oximetry",
    unit: "%",
    ucum: "%",
  },
  weightKg: { code: "29463-7", display: "Body weight", unit: "kg", ucum: "kg" },
  heightCm: { code: "8302-2", display: "Body height", unit: "cm", ucum: "cm" },
};

export function toFhirVitalObservations(v: {
  id: string;
  patientId: string;
  encounterId: string;
  measuredAt: Date;
  values: Record<string, number | null>;
  systolicMmHg: number | null;
  diastolicMmHg: number | null;
}) {
  const base = {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: SYSTEMS.obsCategory, code: "vital-signs", display: "Vital Signs" }] }],
    subject: { reference: `Patient/${v.patientId}` },
    encounter: { reference: `Encounter/${v.encounterId}` },
    effectiveDateTime: v.measuredAt.toISOString(),
  };
  const out: Record<string, unknown>[] = [];
  for (const [field, loinc] of Object.entries(VITAL_LOINC)) {
    const value = v.values[field];
    if (value === null || value === undefined) continue;
    out.push({
      ...base,
      id: `${v.id}-${field}`,
      code: {
        coding: [{ system: SYSTEMS.loinc, code: loinc.code, display: loinc.display }],
        text: loinc.display,
      },
      valueQuantity: { value, unit: loinc.unit, system: SYSTEMS.ucum, code: loinc.ucum },
    });
  }
  if (v.systolicMmHg !== null && v.diastolicMmHg !== null) {
    out.push({
      ...base,
      id: `${v.id}-bp`,
      code: {
        coding: [{ system: SYSTEMS.loinc, code: "85354-9", display: "Blood pressure panel" }],
        text: "Blood pressure",
      },
      component: [
        {
          code: { coding: [{ system: SYSTEMS.loinc, code: "8480-6", display: "Systolic blood pressure" }] },
          valueQuantity: { value: v.systolicMmHg, unit: "mmHg", system: SYSTEMS.ucum, code: "mm[Hg]" },
        },
        {
          code: { coding: [{ system: SYSTEMS.loinc, code: "8462-4", display: "Diastolic blood pressure" }] },
          valueQuantity: { value: v.diastolicMmHg, unit: "mmHg", system: SYSTEMS.ucum, code: "mm[Hg]" },
        },
      ],
    });
  }
  return out;
}

const RX_STATUS: Record<string, string> = {
  DRAFT: "draft",
  SIGNED: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export function toFhirMedicationRequest(i: {
  id: string;
  prescriptionStatus: string;
  itemStatus: string;
  patientId: string;
  encounterId: string;
  prescriberId: string;
  signedAt: Date | null;
  medication: string;
  dose: string;
  route: string;
  frequency: string;
  timesPerDay: number | null;
  durationDays: number | null;
  prn: boolean;
  quantity: number;
  unit: string;
  instructions: string | null;
}) {
  const status =
    i.itemStatus === "CANCELLED"
      ? "cancelled"
      : i.itemStatus === "DISPENSED"
        ? "completed"
        : (RX_STATUS[i.prescriptionStatus] ?? "unknown");
  return {
    resourceType: "MedicationRequest",
    id: i.id,
    status,
    intent: "order",
    medicationCodeableConcept: { text: i.medication },
    subject: { reference: `Patient/${i.patientId}` },
    encounter: { reference: `Encounter/${i.encounterId}` },
    requester: { reference: `Practitioner/${i.prescriberId}` },
    ...(i.signedAt ? { authoredOn: i.signedAt.toISOString() } : {}),
    dosageInstruction: [
      {
        text: `${i.dose} ${i.route} ${i.frequency}${i.durationDays ? ` for ${i.durationDays} days` : ""}${i.prn ? " as needed" : ""}${i.instructions ? `. ${i.instructions}` : ""}`,
        route: { text: i.route },
        asNeededBoolean: i.prn,
        ...(i.timesPerDay
          ? {
              timing: {
                repeat: {
                  frequency: i.timesPerDay,
                  period: 1,
                  periodUnit: "d",
                  ...(i.durationDays
                    ? {
                        boundsDuration: { value: i.durationDays, unit: "d", system: SYSTEMS.ucum, code: "d" },
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
    ],
    dispenseRequest: { quantity: { value: i.quantity, unit: i.unit } },
  };
}

export function bundle(entries: Record<string, unknown>[]) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: entries.length,
    entry: entries.map((resource) => ({ resource })),
  };
}
