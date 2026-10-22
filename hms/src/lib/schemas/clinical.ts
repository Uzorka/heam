import { z } from "zod";
import { optionalText, requiredText, uuid } from "./common";

const optNum = (min: number, max: number, label: string, integer = false) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    (integer ? z.number().int(`${label} must be a whole number`) : z.number())
      .min(min, `${label} must be at least ${min}`)
      .max(max, `${label} must be at most ${max}`)
      .optional(),
  );

/** Plausibility limits mirror the database CHECK constraint (data-entry guards, not clinical ranges). */
export const vitalsSchema = z
  .object({
    encounterId: uuid,
    measuredAt: z.string().datetime({ offset: true }).optional(),
    temperatureC: optNum(25, 45, "Temperature (°C)"),
    pulseBpm: optNum(20, 300, "Pulse (bpm)", true),
    respRatePerMin: optNum(4, 100, "Respiratory rate (/min)", true),
    systolicMmHg: optNum(40, 300, "Systolic BP (mmHg)", true),
    diastolicMmHg: optNum(20, 200, "Diastolic BP (mmHg)", true),
    spo2Pct: optNum(30, 100, "SpO₂ (%)", true),
    weightKg: optNum(0.3, 400, "Weight (kg)"),
    heightCm: optNum(20, 250, "Height (cm)"),
    painScore: optNum(0, 10, "Pain score (0-10)", true),
    notes: optionalText(300),
  })
  .superRefine((v, ctx) => {
    const keys = [
      "temperatureC",
      "pulseBpm",
      "respRatePerMin",
      "systolicMmHg",
      "diastolicMmHg",
      "spo2Pct",
      "weightKg",
      "heightCm",
      "painScore",
    ] as const;
    if (!keys.some((k) => v[k] !== undefined))
      ctx.addIssue({ code: "custom", path: ["_form"], message: "Enter at least one measurement" });
    if ((v.systolicMmHg === undefined) !== (v.diastolicMmHg === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["diastolicMmHg"],
        message: "Enter both systolic and diastolic pressure",
      });
    }
    if (v.systolicMmHg !== undefined && v.diastolicMmHg !== undefined && v.diastolicMmHg >= v.systolicMmHg) {
      ctx.addIssue({
        code: "custom",
        path: ["diastolicMmHg"],
        message: "Diastolic must be lower than systolic",
      });
    }
  });

export const markErrorSchema = z.object({ id: uuid, reason: requiredText("Reason", 300) });

export const triageSchema = z.object({
  encounterId: uuid,
  chiefComplaint: requiredText("Presenting complaint", 300),
  acuity: z.enum(["IMMEDIATE", "VERY_URGENT", "URGENT", "STANDARD", "NON_URGENT"]),
  notes: optionalText(1000),
});

export const NOTE_SECTIONS = [
  "chiefComplaint",
  "history",
  "reviewOfSystems",
  "examination",
  "assessment",
  "plan",
  "returnPrecautions",
  "body",
] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

export const noteContentSchema = z.object(
  Object.fromEntries(NOTE_SECTIONS.map((s) => [s, z.string().max(20000).optional()])) as Record<
    NoteSection,
    z.ZodOptional<z.ZodString>
  >,
);

export const createNoteSchema = z.object({
  encounterId: uuid,
  type: z.enum(["CONSULTATION", "PROGRESS", "NURSING", "PROCEDURE"]),
  templateKey: z.string().max(60).optional(),
});

export const saveNoteSchema = z.object({
  noteId: uuid,
  version: z.number().int().min(1),
  content: noteContentSchema,
});

export const signSchema = z.object({
  id: uuid,
  password: z.string().min(1, "Enter your password to sign"),
});

export const addendumSchema = z.object({ parentNoteId: uuid });

export const diagnosisSchema = z.object({
  encounterId: uuid,
  description: requiredText("Diagnosis", 300),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, "Use an ICD-10 code such as B54 or J18.9")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  certainty: z.enum(["PROVISIONAL", "CONFIRMED"]),
  isPrimary: z.boolean().default(false),
  onProblemList: z.boolean().default(false),
});

export const updateDiagnosisSchema = z.object({
  id: uuid,
  version: z.number().int().min(0),
  certainty: z.enum(["PROVISIONAL", "CONFIRMED", "REFUTED"]).optional(),
  status: z.enum(["ACTIVE", "RESOLVED", "ENTERED_IN_ERROR"]).optional(),
  onProblemList: z.boolean().optional(),
  reason: optionalText(300),
});

export const orderItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LAB"), labTestId: uuid }),
  z.object({ kind: z.literal("IMAGING"), imagingStudyId: uuid }),
  z.object({ kind: z.literal("PROCEDURE"), description: requiredText("Procedure", 200) }),
  z.object({ kind: z.literal("REFERRAL"), description: requiredText("Referral", 200) }),
]);

export const placeOrdersSchema = z.object({
  encounterId: uuid,
  requestGroupId: uuid,
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).default("ROUTINE"),
  clinicalIndication: requiredText("Clinical indication", 500),
  notes: optionalText(500),
  items: z.array(orderItemSchema).min(1, "Choose at least one item").max(30),
});

export const cancelOrderSchema = z.object({
  orderId: uuid,
  version: z.number().int().min(0),
  reason: requiredText("Reason", 300),
});
