import { z } from "zod";
import { optionalText, requiredText, uuid } from "./common";

export const collectSpecimenSchema = z.object({ orderId: uuid, version: z.number().int().min(0) });
export const receiveSpecimenSchema = z.object({ specimenId: uuid });
export const rejectSpecimenSchema = z.object({
  specimenId: uuid,
  reason: requiredText("Rejection reason", 300),
});

export const enterResultsSchema = z.object({
  orderId: uuid,
  results: z.array(z.object({ componentId: uuid, value: z.string().trim().max(500) })).min(1),
  submit: z.boolean().default(false),
});

export const returnResultsSchema = z.object({ orderId: uuid, reason: requiredText("Reason", 300) });

export const verifyResultsSchema = z.object({
  orderId: uuid,
  password: z.string().min(1, "Enter your password to verify"),
});

export const amendResultSchema = z.object({
  resultId: uuid,
  value: requiredText("Corrected value", 500),
  reason: requiredText("Reason for amendment", 500),
  password: z.string().min(1, "Enter your password"),
});

export const acknowledgeCriticalSchema = z.object({
  alertId: uuid,
  communicatedTo: requiredText("Who was informed", 200),
  communicationMethod: z.enum(["IN_PERSON", "PHONE", "IN_APP"]),
  notes: optionalText(500),
});

export const labTestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, "Use 2-20 letters, numbers, - or _"),
  name: requiredText("Name", 120),
  specimenType: requiredText("Specimen", 60),
  turnaroundHours: z.coerce.number().int().min(1).max(720).optional(),
  components: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9_-]{1,20}$/),
        name: requiredText("Component name", 120),
        unit: optionalText(30),
        resultType: z.enum(["NUMERIC", "TEXT", "CODED"]),
        decimals: z.coerce.number().int().min(0).max(4).optional(),
        allowedValues: z.array(z.string().trim().min(1).max(60)).default([]),
      }),
    )
    .min(1),
});

const optDec = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
  z.number().optional(),
);

export const referenceRangeSchema = z
  .object({
    componentId: uuid,
    sex: z.enum(["ANY", "FEMALE", "MALE"]).default("ANY"),
    ageMinDays: z.coerce.number().int().min(0).default(0),
    ageMaxDays: z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : Number(v)),
      z.number().int().min(1).optional(),
    ),
    low: optDec,
    high: optDec,
    criticalLow: optDec,
    criticalHigh: optDec,
    normalText: optionalText(60),
    source: requiredText("Source / reference", 200),
  })
  .superRefine((v, ctx) => {
    if (v.low !== undefined && v.high !== undefined && v.low > v.high)
      ctx.addIssue({ code: "custom", path: ["high"], message: "High must be ≥ low" });
    if (v.criticalLow !== undefined && v.low !== undefined && v.criticalLow > v.low)
      ctx.addIssue({ code: "custom", path: ["criticalLow"], message: "Critical low must be ≤ low" });
    if (v.criticalHigh !== undefined && v.high !== undefined && v.criticalHigh < v.high)
      ctx.addIssue({ code: "custom", path: ["criticalHigh"], message: "Critical high must be ≥ high" });
    if (v.ageMaxDays !== undefined && v.ageMaxDays <= v.ageMinDays)
      ctx.addIssue({ code: "custom", path: ["ageMaxDays"], message: "Must exceed minimum age" });
  });

export const approveRuleSchema = z.object({ id: uuid, decision: z.enum(["APPROVE", "RETIRE"]) });

export const vitalThresholdSchema = z.object({
  parameter: z.enum(["TEMPERATURE_C", "PULSE_BPM", "RESP_RATE", "SYSTOLIC", "DIASTOLIC", "SPO2"]),
  low: optDec,
  high: optDec,
  criticalLow: optDec,
  criticalHigh: optDec,
  source: requiredText("Source / reference", 200),
});

export const imagingReportSchema = z.object({
  orderId: uuid,
  findings: requiredText("Findings", 20000),
  impression: requiredText("Impression", 5000),
});

export const amendImagingSchema = z.object({
  reportId: uuid,
  findings: requiredText("Findings", 20000),
  impression: requiredText("Impression", 5000),
  reason: requiredText("Reason for amendment", 500),
  password: z.string().min(1, "Enter your password"),
});
