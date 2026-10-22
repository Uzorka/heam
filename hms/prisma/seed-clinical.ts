/**
 * Phase 2 demo content. FICTIONAL. Reference ranges and vital thresholds are created as DRAFT
 * placeholders: they must be validated and approved by the hospital's laboratory director /
 * medical director before they flag anything.
 */
import type { PrismaClient } from "@prisma/client";
import { nextYearlyRef } from "../src/server/sequence";
import { noteSignatureHash } from "../src/server/domains/clinical/notes";
import { todayLocal } from "../src/lib/time";

const PLACEHOLDER =
  "PLACEHOLDER - typical adult value for demonstration; requires local laboratory validation before approval";

type Comp = {
  code: string;
  name: string;
  unit?: string;
  resultType: "NUMERIC" | "TEXT" | "CODED";
  decimals?: number;
  allowed?: string[];
  ranges?: {
    sex?: "ANY" | "FEMALE" | "MALE";
    ageMinDays?: number;
    low?: number;
    high?: number;
    criticalLow?: number;
    criticalHigh?: number;
    normalText?: string;
  }[];
};
const TESTS: { code: string; name: string; specimen: string; tat: number; components: Comp[] }[] = [
  {
    code: "FBC",
    name: "Full blood count",
    specimen: "EDTA blood",
    tat: 4,
    components: [
      {
        code: "HB",
        name: "Haemoglobin",
        unit: "g/dL",
        resultType: "NUMERIC",
        decimals: 1,
        ranges: [
          { sex: "FEMALE", ageMinDays: 6570, low: 12, high: 15.5, criticalLow: 7, criticalHigh: 20 },
          { sex: "MALE", ageMinDays: 6570, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
        ],
      },
      {
        code: "PCV",
        name: "Packed cell volume",
        unit: "%",
        resultType: "NUMERIC",
        decimals: 0,
        ranges: [
          { sex: "FEMALE", ageMinDays: 6570, low: 36, high: 46 },
          { sex: "MALE", ageMinDays: 6570, low: 40, high: 52 },
        ],
      },
      {
        code: "WBC",
        name: "White cell count",
        unit: "×10⁹/L",
        resultType: "NUMERIC",
        decimals: 1,
        ranges: [{ ageMinDays: 6570, low: 4, high: 11, criticalLow: 2, criticalHigh: 30 }],
      },
      {
        code: "PLT",
        name: "Platelets",
        unit: "×10⁹/L",
        resultType: "NUMERIC",
        decimals: 0,
        ranges: [{ ageMinDays: 6570, low: 150, high: 400, criticalLow: 50, criticalHigh: 1000 }],
      },
    ],
  },
  {
    code: "MP",
    name: "Malaria parasite (thick/thin film)",
    specimen: "EDTA blood",
    tat: 2,
    components: [
      {
        code: "MP",
        name: "Malaria parasites",
        resultType: "CODED",
        allowed: ["Not seen", "Seen (+)", "Seen (++)", "Seen (+++)"],
        ranges: [{ normalText: "Not seen" }],
      },
    ],
  },
  {
    code: "RBS",
    name: "Random blood glucose",
    specimen: "Fluoride oxalate / capillary",
    tat: 1,
    components: [
      {
        code: "GLU",
        name: "Glucose (random)",
        unit: "mmol/L",
        resultType: "NUMERIC",
        decimals: 1,
        ranges: [{ ageMinDays: 6570, low: 3.9, high: 7.8, criticalLow: 2.8, criticalHigh: 25 }],
      },
    ],
  },
  {
    code: "URINE",
    name: "Urinalysis (dipstick)",
    specimen: "Mid-stream urine",
    tat: 1,
    components: [
      {
        code: "PRO",
        name: "Protein",
        resultType: "CODED",
        allowed: ["Negative", "Trace", "+", "++", "+++"],
        ranges: [{ normalText: "Negative" }],
      },
      {
        code: "GLU",
        name: "Glucose",
        resultType: "CODED",
        allowed: ["Negative", "Trace", "+", "++", "+++"],
        ranges: [{ normalText: "Negative" }],
      },
      {
        code: "LEU",
        name: "Leucocytes",
        resultType: "CODED",
        allowed: ["Negative", "Trace", "+", "++", "+++"],
        ranges: [{ normalText: "Negative" }],
      },
    ],
  },
  {
    code: "UPT",
    name: "Urine pregnancy test",
    specimen: "Urine",
    tat: 1,
    components: [
      {
        code: "HCG",
        name: "hCG (qualitative)",
        resultType: "CODED",
        allowed: ["Negative", "Positive", "Invalid"],
      },
    ],
  },
  {
    code: "HBSAG",
    name: "Hepatitis B surface antigen (rapid)",
    specimen: "Serum",
    tat: 2,
    components: [
      {
        code: "HBSAG",
        name: "HBsAg",
        resultType: "CODED",
        allowed: ["Non-reactive", "Reactive", "Invalid"],
        ranges: [{ normalText: "Non-reactive" }],
      },
    ],
  },
  {
    code: "GROUP",
    name: "Blood group & Rhesus",
    specimen: "EDTA blood",
    tat: 2,
    components: [
      { code: "ABO", name: "ABO group", resultType: "CODED", allowed: ["A", "B", "AB", "O"] },
      { code: "RH", name: "Rhesus (D)", resultType: "CODED", allowed: ["Positive", "Negative"] },
    ],
  },
  {
    code: "GENO",
    name: "Haemoglobin genotype",
    specimen: "EDTA blood",
    tat: 24,
    components: [
      { code: "GENO", name: "Genotype", resultType: "CODED", allowed: ["AA", "AS", "AC", "SS", "SC", "CC"] },
    ],
  },
];

const STUDIES = [
  { code: "CXR-PA", name: "Chest X-ray (PA)", modality: "XRAY" as const, bodyPart: "Chest" },
  { code: "XR-LIMB", name: "X-ray, limb (specify)", modality: "XRAY" as const, bodyPart: "Limb" },
  {
    code: "US-OBS",
    name: "Obstetric ultrasound",
    modality: "ULTRASOUND" as const,
    bodyPart: "Pelvis / uterus",
  },
  { code: "US-PELV", name: "Pelvic ultrasound", modality: "ULTRASOUND" as const, bodyPart: "Pelvis" },
  { code: "US-ABD", name: "Abdominal ultrasound", modality: "ULTRASOUND" as const, bodyPart: "Abdomen" },
  { code: "ECG-12", name: "12-lead ECG", modality: "ECG" as const, bodyPart: "Heart" },
];

const THRESHOLDS = [
  { parameter: "TEMPERATURE_C" as const, low: 36, high: 37.5, criticalLow: 35, criticalHigh: 40 },
  { parameter: "PULSE_BPM" as const, low: 60, high: 100, criticalLow: 40, criticalHigh: 140 },
  { parameter: "RESP_RATE" as const, low: 12, high: 20, criticalLow: 8, criticalHigh: 30 },
  { parameter: "SYSTOLIC" as const, low: 90, high: 140, criticalLow: 80, criticalHigh: 180 },
  { parameter: "DIASTOLIC" as const, low: 60, high: 90, criticalLow: 40, criticalHigh: 110 },
  { parameter: "SPO2" as const, low: 94, criticalLow: 90 },
];

export async function seedClinicalCatalogue(prisma: PrismaClient, labUserId: string) {
  for (const t of TESTS) {
    const test = await prisma.labTestDefinition.upsert({
      where: { code: t.code },
      update: {},
      create: {
        code: t.code,
        name: t.name,
        specimenType: t.specimen,
        turnaroundHours: t.tat,
        components: {
          create: t.components.map((c, i) => ({
            code: c.code,
            name: c.name,
            unit: c.unit,
            resultType: c.resultType,
            decimals: c.decimals ?? null,
            allowedValues: c.allowed ?? [],
            sortOrder: i,
          })),
        },
      },
      include: { components: { include: { ranges: true } } },
    });
    for (const c of t.components) {
      const comp = test.components.find((x) => x.code === c.code);
      if (!comp || comp.ranges.length || !c.ranges) continue;
      for (const r of c.ranges) {
        await prisma.labReferenceRange.create({
          data: {
            componentId: comp.id,
            sex: r.sex ?? "ANY",
            ageMinDays: r.ageMinDays ?? 0,
            low: r.low,
            high: r.high,
            criticalLow: r.criticalLow,
            criticalHigh: r.criticalHigh,
            normalText: r.normalText,
            source: PLACEHOLDER,
            createdById: labUserId,
          },
        });
      }
    }
  }
  for (const s of STUDIES)
    await prisma.imagingStudyDefinition.upsert({ where: { code: s.code }, update: {}, create: s });
  if ((await prisma.vitalThreshold.count()) === 0) {
    for (const t of THRESHOLDS) {
      await prisma.vitalThreshold.create({
        data: {
          ...t,
          source: "PLACEHOLDER - common adult early-warning bands; requires medical director approval",
          createdById: labUserId,
        },
      });
    }
  }
}

/** Fictional activity so the clinical worklists are not empty. Skipped if any orders exist. */
export async function seedClinicalActivity(prisma: PrismaClient, users: Record<string, string>) {
  if ((await prisma.serviceOrder.count()) > 0) return false;
  const tunde = await prisma.patient.findFirst({
    where: { isDemo: true, givenName: "Tunde", familyName: "Bakare" },
  });
  const ngozi = await prisma.patient.findFirst({
    where: { isDemo: true, givenName: "Ngozi", familyName: "Okafor" },
  });
  if (!tunde || !ngozi) return false;
  const tEnc = await prisma.encounter.findFirst({ where: { patientId: tunde.id, status: "OPEN" } });
  const nEnc = await prisma.encounter.findFirst({
    where: { patientId: ngozi.id, status: "COMPLETED" },
    orderBy: { arrivedAt: "desc" },
  });
  const fbc = await prisma.labTestDefinition.findUniqueOrThrow({
    where: { code: "FBC" },
    include: { components: true },
  });
  const mp = await prisma.labTestDefinition.findUniqueOrThrow({
    where: { code: "MP" },
    include: { components: true },
  });
  const year = Number(todayLocal().slice(0, 4));
  const doctor = users.doctor!;
  const nurse = users.nurse!;
  const lab = users.lab!;

  await prisma.$transaction(async (tx) => {
    if (tEnc) {
      const measuredAt = new Date(tEnc.arrivedAt.getTime() + 10 * 60_000);
      await tx.vitalSign.create({
        data: {
          encounterId: tEnc.id,
          patientId: tunde.id,
          measuredAt,
          recordedById: nurse,
          temperatureC: 38.7,
          pulseBpm: 104,
          respRatePerMin: 20,
          systolicMmHg: 122,
          diastolicMmHg: 78,
          spo2Pct: 97,
          weightKg: 78.5,
          heightCm: 176,
        },
      });
      await tx.triageRecord.create({
        data: {
          encounterId: tEnc.id,
          patientId: tunde.id,
          chiefComplaint: "Fever and headache for 3 days",
          acuity: "STANDARD",
          recordedById: nurse,
          recordedAt: measuredAt,
        },
      });
      await tx.careTeamAssignment.create({
        data: {
          encounterId: tEnc.id,
          patientId: tunde.id,
          userId: nurse,
          role: "NURSE",
          assignedById: nurse,
        },
      });
      await tx.diagnosis.create({
        data: {
          encounterId: tEnc.id,
          patientId: tunde.id,
          description: "Suspected malaria",
          code: "B54",
          codeSystem: "ICD-10",
          certainty: "PROVISIONAL",
          isPrimary: true,
          recordedById: doctor,
        },
      });
      const group = crypto.randomUUID();
      for (const [i, test] of [mp, fbc].entries()) {
        const status = i === 0 ? "IN_PROGRESS" : "ORDERED";
        const o = await tx.serviceOrder.create({
          data: {
            ref: await nextYearlyRef(tx, "ORD", year),
            requestGroupId: group,
            itemIndex: i,
            kind: "LAB",
            encounterId: tEnc.id,
            patientId: tunde.id,
            branchId: tEnc.branchId,
            labTestId: test.id,
            description: test.name,
            priority: "URGENT",
            clinicalIndication: "Fever 3 days, ?malaria",
            orderedById: doctor,
            status,
          },
        });
        await tx.orderStatusEvent.create({
          data: { orderId: o.id, toStatus: "ORDERED", changedById: doctor },
        });
        if (status === "IN_PROGRESS") {
          await tx.orderStatusEvent.createMany({
            data: [
              { orderId: o.id, fromStatus: "ORDERED", toStatus: "SPECIMEN_COLLECTED", changedById: lab },
              { orderId: o.id, fromStatus: "SPECIMEN_COLLECTED", toStatus: "IN_PROGRESS", changedById: lab },
            ],
          });
          await tx.labSpecimen.create({
            data: {
              orderId: o.id,
              accession: await nextYearlyRef(tx, "ACC", year),
              specimenType: test.specimenType,
              status: "RECEIVED",
              collectedAt: new Date(),
              collectedById: lab,
              receivedAt: new Date(),
              receivedById: lab,
            },
          });
        }
      }
    }
    if (nEnc) {
      const content = {
        chiefComplaint: "Review of tiredness",
        history: "Feels tired for 2 weeks. No bleeding reported.",
        examination: "Mild conjunctival pallor. Otherwise unremarkable.",
        assessment: "Fatigue; anaemia to exclude.",
        plan: "FBC. Review with result.",
        returnPrecautions: "Return if breathless, dizzy or any bleeding.",
      };
      const note = await tx.clinicalNote.create({
        data: { encounterId: nEnc.id, patientId: ngozi.id, type: "CONSULTATION", content, authorId: doctor },
      });
      const signedAt = new Date(nEnc.arrivedAt.getTime() + 40 * 60_000);
      await tx.clinicalNoteVersion.create({
        data: { noteId: note.id, version: 1, content, savedById: doctor },
      });
      await tx.clinicalNote.update({
        where: { id: note.id },
        data: {
          status: "SIGNED",
          signedAt,
          signedById: doctor,
          contentHash: noteSignatureHash(note, signedAt),
        },
      });
      const o = await tx.serviceOrder.create({
        data: {
          ref: await nextYearlyRef(tx, "ORD", year),
          requestGroupId: crypto.randomUUID(),
          itemIndex: 0,
          kind: "LAB",
          encounterId: nEnc.id,
          patientId: ngozi.id,
          branchId: nEnc.branchId,
          labTestId: fbc.id,
          description: fbc.name,
          priority: "ROUTINE",
          clinicalIndication: "Fatigue, pallor",
          orderedById: doctor,
          orderedAt: signedAt,
          status: "VERIFIED",
          resultedAt: signedAt,
          verifiedAt: new Date(signedAt.getTime() + 3 * 3_600_000),
        },
      });
      await tx.labSpecimen.create({
        data: {
          orderId: o.id,
          accession: await nextYearlyRef(tx, "ACC", year),
          specimenType: fbc.specimenType,
          status: "RECEIVED",
          collectedAt: signedAt,
          collectedById: lab,
          receivedAt: signedAt,
          receivedById: lab,
        },
      });
      const values: Record<string, string> = { HB: "11.4", PCV: "35", WBC: "6.2", PLT: "254" };
      for (const c of fbc.components) {
        await tx.labResult.create({
          data: {
            orderId: o.id,
            componentId: c.id,
            valueText: values[c.code]!,
            valueNumeric: Number(values[c.code]),
            unit: c.unit,
            flag: "NONE",
            status: "FINAL",
            enteredById: lab,
            verifiedById: users.meddir!,
            verifiedAt: new Date(signedAt.getTime() + 3 * 3_600_000),
          },
        });
      }
      await tx.orderStatusEvent.createMany({
        data: (["ORDERED", "SPECIMEN_COLLECTED", "IN_PROGRESS", "RESULTED", "VERIFIED"] as const).map(
          (s, i, arr) => ({
            orderId: o.id,
            fromStatus: i ? arr[i - 1] : null,
            toStatus: s,
            changedById: i < 4 ? lab : users.meddir!,
          }),
        ),
      });
    }
  });
  return true;
}
