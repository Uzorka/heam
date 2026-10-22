"use server";
import { defineAction } from "@/server/action";
import {
  addDating,
  adoptDating,
  endPregnancy,
  markAncError,
  openPregnancy,
  recordAncVisit,
  recordDelivery,
  recordPostnatal,
} from "@/server/domains/maternity/service";
import {
  adoptDatingSchema,
  ancVisitSchema,
  datingSchema,
  deliverySchema,
  endPregnancySchema,
  markErrorSchema,
  openPregnancySchema,
  postnatalSchema,
} from "@/lib/schemas/maternity";

export const openPregnancyAction = defineAction(
  "maternity.pregnancy.open",
  openPregnancySchema,
  async (ctx, i) => (await openPregnancy(ctx, i)).id,
);
export const addDatingAction = defineAction(
  "maternity.dating.add",
  datingSchema,
  async (ctx, i) => (await addDating(ctx, i)).id,
);
export const adoptDatingAction = defineAction("maternity.dating.adopt", adoptDatingSchema, async (ctx, i) =>
  adoptDating(ctx, i.datingId),
);
export const ancVisitAction = defineAction(
  "maternity.anc.record",
  ancVisitSchema,
  async (ctx, i) => (await recordAncVisit(ctx, i)).id,
);
export const ancErrorAction = defineAction("maternity.anc.error", markErrorSchema, markAncError);
export const deliveryAction = defineAction("maternity.delivery.sign", deliverySchema, async (ctx, i) => {
  const r = await recordDelivery(ctx, i);
  return { ref: r.delivery.ref, babies: r.babies.filter((b) => b.babyPatientId).length };
});
export const postnatalAction = defineAction(
  "maternity.postnatal.record",
  postnatalSchema,
  async (ctx, i) => (await recordPostnatal(ctx, i)).id,
);
export const endPregnancyAction = defineAction("maternity.pregnancy.end", endPregnancySchema, endPregnancy);
