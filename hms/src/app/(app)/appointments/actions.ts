"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { bookAppointment, cancelAppointment, markNoShow, rescheduleAppointment } from "@/server/domains/appointments/service";
import { bookAppointmentSchema, cancelAppointmentSchema, rescheduleAppointmentSchema } from "@/lib/schemas/scheduling";
import { uuid } from "@/lib/schemas/common";

export const bookAppointmentAction = defineAction("appointment.book", bookAppointmentSchema, async (ctx, input) => {
  const a = await bookAppointment(ctx, input);
  return { id: a.id, ref: a.ref };
});
export const rescheduleAppointmentAction = defineAction("appointment.reschedule", rescheduleAppointmentSchema, async (ctx, input) => {
  const a = await rescheduleAppointment(ctx, input);
  return { id: a.id, ref: a.ref };
});
export const cancelAppointmentAction = defineAction("appointment.cancel", cancelAppointmentSchema, cancelAppointment);
export const noShowAction = defineAction("appointment.no_show", z.object({ appointmentId: uuid }), async (ctx, i) => markNoShow(ctx, i.appointmentId));
