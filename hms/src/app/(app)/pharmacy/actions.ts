"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { closeItem, dispense, reverseDispense, verifyItem } from "@/server/domains/pharmacy/service";
import { dispenseSchema, reverseDispenseSchema, verifyItemSchema } from "@/lib/schemas/pharmacy";
import { requiredText, uuid } from "@/lib/schemas/common";

export const verifyItemAction = defineAction("pharmacy.verify", verifyItemSchema, verifyItem);
export const dispenseAction = defineAction("pharmacy.dispense", dispenseSchema, async (ctx, i) => {
  const r = await dispense(ctx, i);
  return { duplicate: r.duplicate, lots: r.events.length };
});
export const reverseDispenseAction = defineAction(
  "pharmacy.dispense.reverse",
  reverseDispenseSchema,
  reverseDispense,
);
export const closeItemAction = defineAction(
  "pharmacy.item.close",
  z.object({ itemId: uuid, reason: requiredText("Reason", 300) }),
  closeItem,
);
