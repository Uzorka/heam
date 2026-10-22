"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { createFrequency, saveMedication, setFrequencyStatus } from "@/server/domains/pharmacy/prescribing";
import { frequencySchema, medicationSchema } from "@/lib/schemas/pharmacy";
import { uuid } from "@/lib/schemas/common";

export const saveMedicationAction = defineAction(
  "pharmacy.medication.save",
  medicationSchema,
  async (ctx, i) => (await saveMedication(ctx, i)).id,
);
export const createFrequencyAction = defineAction(
  "pharmacy.frequency.create",
  frequencySchema,
  async (ctx, i) => (await createFrequency(ctx, i)).id,
);
export const setFrequencyStatusAction = defineAction(
  "pharmacy.frequency.status",
  z.object({ id: uuid, status: z.enum(["APPROVED", "RETIRED"]) }),
  setFrequencyStatus,
);
