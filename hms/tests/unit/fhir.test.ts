import { describe, expect, it } from "vitest";
import {
  bundle,
  toFhirEncounter,
  toFhirMedicationRequest,
  toFhirPatient,
  toFhirVitalObservations,
} from "@/server/domains/fhir/mappers";

describe("FHIR R4 mapping", () => {
  it("maps a patient with hospital identifier, name, gender and birth date", () => {
    const r = toFhirPatient({
      id: "p1",
      mrn: "ADK0000018",
      givenName: "Ngozi",
      middleName: "Ifeoma",
      familyName: "Okafor",
      sexAtBirth: "FEMALE",
      dateOfBirth: new Date("1979-11-02T00:00:00Z"),
      phoneE164: "+2348090000103",
      status: "ACTIVE",
    });
    expect(r).toMatchObject({
      resourceType: "Patient",
      identifier: [{ system: "urn:aduraking:hms:mrn", value: "ADK0000018" }],
      name: [{ family: "Okafor", given: ["Ngozi", "Ifeoma"] }],
      gender: "female",
      birthDate: "1979-11-02",
      active: true,
    });
  });

  it("maps encounters to ambulatory or inpatient class", () => {
    const e = toFhirEncounter({
      id: "e1",
      ref: "ENC-2026-000001",
      patientId: "p1",
      status: "COMPLETED",
      arrivedAt: new Date("2026-10-01T08:00:00Z"),
      completedAt: new Date("2026-10-03T10:00:00Z"),
      visitTypeName: "General consultation",
      inpatient: true,
    });
    expect(e.status).toBe("finished");
    expect(e.class.code).toBe("IMP");
    expect(e.period.end).toBe("2026-10-03T10:00:00.000Z");
  });

  it("emits one LOINC-coded observation per recorded vital and a BP panel", () => {
    const obs = toFhirVitalObservations({
      id: "v1",
      patientId: "p1",
      encounterId: "e1",
      measuredAt: new Date("2026-10-01T08:10:00Z"),
      values: {
        temperatureC: 38.4,
        pulseBpm: 96,
        respRatePerMin: null,
        spo2Pct: null,
        weightKg: null,
        heightCm: null,
      },
      systolicMmHg: 130,
      diastolicMmHg: 85,
    });
    expect(obs).toHaveLength(3);
    expect(obs[0]).toMatchObject({
      code: { coding: [{ code: "8310-5" }] },
      valueQuantity: { value: 38.4, code: "Cel" },
    });
    expect(obs[2]).toMatchObject({ code: { coding: [{ code: "85354-9" }] } });
  });

  it("maps prescription items to MedicationRequest with dosage text and timing", () => {
    const m = toFhirMedicationRequest({
      id: "i1",
      prescriptionStatus: "SIGNED",
      itemStatus: "VERIFIED",
      patientId: "p1",
      encounterId: "e1",
      prescriberId: "u1",
      signedAt: new Date("2026-10-01T09:00:00Z"),
      medication: "Paracetamol 500 mg tablet",
      dose: "2",
      route: "Oral",
      frequency: "TDS",
      timesPerDay: 3,
      durationDays: 3,
      prn: false,
      quantity: 18,
      unit: "tablet",
      instructions: null,
    });
    expect(m.status).toBe("active");
    expect(m.dosageInstruction[0]).toMatchObject({
      text: "2 Oral TDS for 3 days",
      timing: { repeat: { frequency: 3, periodUnit: "d" } },
    });
    expect(bundle([m]).total).toBe(1);
  });
});
