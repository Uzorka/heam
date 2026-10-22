"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  admit,
  authoriseDischarge,
  completeDischarge,
  financialClearance,
  markAdministrationError,
  markBedReady,
  moveBed,
  recordAdministration,
} from "@/server/domains/inpatient/service";
import {
  admitSchema,
  authoriseDischargeSchema,
  bedMoveSchema,
  clearanceSchema,
  marSchema,
} from "@/lib/schemas/inpatient";
import { requiredText, uuid } from "@/lib/schemas/common";

export const admitAction = defineAction(
  "admission.admit",
  admitSchema,
  async (ctx, i) => (await admit(ctx, i)).id,
);
export const moveBedAction = defineAction("admission.bed", bedMoveSchema, async (ctx, i) => {
  await moveBed(ctx, i);
});
export const bedReadyAction = defineAction("admission.bed.ready", z.object({ bedId: uuid }), async (ctx, i) =>
  markBedReady(ctx, i.bedId),
);
export const authoriseDischargeAction = defineAction(
  "admission.discharge.authorise",
  authoriseDischargeSchema,
  authoriseDischarge,
);
export const clearanceAction = defineAction("admission.clearance", clearanceSchema, async (ctx, i) => {
  const r = await financialClearance(ctx, i);
  return { outstanding: r.outstanding.toString(), unresolved: r.unresolved };
});
export const completeDischargeAction = defineAction(
  "admission.discharge.complete",
  z.object({ admissionId: uuid }),
  async (ctx, i) => completeDischarge(ctx, i.admissionId),
);
export const marAction = defineAction(
  "nursing.mar.record",
  marSchema,
  async (ctx, i) => (await recordAdministration(ctx, i)).id,
);
export const marErrorAction = defineAction(
  "nursing.mar.error",
  z.object({ id: uuid, reason: requiredText("Reason", 300) }),
  markAdministrationError,
);
