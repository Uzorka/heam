"use server";
import { defineAction } from "@/server/action";
import { assignAttending, checkIn, transitionStage } from "@/server/domains/queue/service";
import { assignClinicianSchema, checkInSchema, transitionSchema } from "@/lib/schemas/scheduling";

export const checkInAction = defineAction("encounter.check_in", checkInSchema, async (ctx, input) => {
  const e = await checkIn(ctx, input);
  return { id: e.id, ref: e.ref };
});
export const transitionAction = defineAction("encounter.transition", transitionSchema, transitionStage);
export const assignAttendingAction = defineAction("encounter.assign", assignClinicianSchema, assignAttending);
