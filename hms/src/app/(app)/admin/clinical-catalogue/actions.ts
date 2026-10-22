"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  createImagingStudy,
  createLabTest,
  decideReferenceRange,
  proposeReferenceRange,
  setLabTestActive,
} from "@/server/domains/catalogue/service";
import { decideVitalThreshold, proposeVitalThreshold } from "@/server/domains/clinical/observations";
import {
  approveRuleSchema,
  labTestSchema,
  referenceRangeSchema,
  vitalThresholdSchema,
} from "@/lib/schemas/lab";
import { requiredText, uuid } from "@/lib/schemas/common";

export const createLabTestAction = defineAction(
  "catalogue.lab_test",
  labTestSchema,
  async (ctx, i) => (await createLabTest(ctx, i)).id,
);
export const setLabTestActiveAction = defineAction(
  "catalogue.lab_test.active",
  z.object({ testId: uuid, active: z.boolean() }),
  async (ctx, i) => setLabTestActive(ctx, i.testId, i.active),
);
export const proposeRangeAction = defineAction(
  "catalogue.range.propose",
  referenceRangeSchema,
  async (ctx, i) => (await proposeReferenceRange(ctx, i)).id,
);
export const decideRangeAction = defineAction(
  "catalogue.range.decide",
  approveRuleSchema,
  decideReferenceRange,
);
export const proposeThresholdAction = defineAction(
  "catalogue.threshold.propose",
  vitalThresholdSchema,
  async (ctx, i) => (await proposeVitalThreshold(ctx, i)).id,
);
export const decideThresholdAction = defineAction(
  "catalogue.threshold.decide",
  approveRuleSchema,
  decideVitalThreshold,
);
export const createImagingStudyAction = defineAction(
  "catalogue.imaging_study",
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,20}$/, "Use 2-20 letters, numbers, - or _"),
    name: requiredText("Name", 120),
    modality: z.enum(["XRAY", "ULTRASOUND", "CT", "MRI", "ECG", "OTHER"]),
    bodyPart: z.string().trim().max(60).optional(),
  }),
  async (ctx, i) => (await createImagingStudy(ctx, i)).id,
);
