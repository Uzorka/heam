"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { createAddendum, createNote, discardNote, saveNote, signNote } from "@/server/domains/clinical/notes";
import { markVitalsInError, recordTriage, recordVitals } from "@/server/domains/clinical/observations";
import { addDiagnosis, updateDiagnosis } from "@/server/domains/clinical/diagnoses";
import {
  cancelOrder,
  completeSimpleOrder,
  placeOrders,
  reviewOrderResult,
} from "@/server/domains/clinical/orders";
import { acknowledgeCritical } from "@/server/domains/lab/service";
import { invokeBreakGlass } from "@/server/domains/security/breakglass";
import {
  addendumSchema,
  cancelOrderSchema,
  createNoteSchema,
  diagnosisSchema,
  markErrorSchema,
  placeOrdersSchema,
  saveNoteSchema,
  signSchema,
  triageSchema,
  updateDiagnosisSchema,
  vitalsSchema,
} from "@/lib/schemas/clinical";
import { acknowledgeCriticalSchema } from "@/lib/schemas/lab";
import { breakGlassSchema } from "@/lib/schemas/staff";
import { uuid } from "@/lib/schemas/common";

export const recordVitalsAction = defineAction(
  "clinical.vitals",
  vitalsSchema,
  async (ctx, i) => (await recordVitals(ctx, i)).id,
);
export const vitalsErrorAction = defineAction("clinical.vitals.error", markErrorSchema, markVitalsInError);
export const recordTriageAction = defineAction(
  "clinical.triage",
  triageSchema,
  async (ctx, i) => (await recordTriage(ctx, i)).id,
);
export const createNoteAction = defineAction(
  "clinical.note.create",
  createNoteSchema,
  async (ctx, i) => (await createNote(ctx, i)).id,
);
export const saveNoteAction = defineAction("clinical.note.save", saveNoteSchema, saveNote);
export const signNoteAction = defineAction("clinical.note.sign", signSchema, async (ctx, i) => {
  await signNote(ctx, i);
  return null;
});
export const discardNoteAction = defineAction(
  "clinical.note.discard",
  z.object({ noteId: uuid }),
  async (ctx, i) => discardNote(ctx, i.noteId),
);
export const addendumAction = defineAction(
  "clinical.note.addendum",
  addendumSchema,
  async (ctx, i) => (await createAddendum(ctx, i.parentNoteId)).id,
);
export const addDiagnosisAction = defineAction(
  "clinical.diagnosis.add",
  diagnosisSchema,
  async (ctx, i) => (await addDiagnosis(ctx, i)).id,
);
export const updateDiagnosisAction = defineAction(
  "clinical.diagnosis.update",
  updateDiagnosisSchema,
  updateDiagnosis,
);
export const placeOrdersAction = defineAction("clinical.order.place", placeOrdersSchema, async (ctx, i) => {
  const r = await placeOrders(ctx, i);
  return { refs: r.orders.map((o) => o.ref), replayed: r.replayed };
});
export const cancelOrderAction = defineAction("clinical.order.cancel", cancelOrderSchema, cancelOrder);
export const reviewResultAction = defineAction(
  "clinical.result.review",
  z.object({ orderId: uuid }),
  async (ctx, i) => reviewOrderResult(ctx, i.orderId),
);
export const completeOrderAction = defineAction(
  "clinical.order.complete",
  z.object({ orderId: uuid }),
  async (ctx, i) => completeSimpleOrder(ctx, i.orderId),
);
export const acknowledgeCriticalAction = defineAction(
  "lab.critical.ack",
  acknowledgeCriticalSchema,
  acknowledgeCritical,
);
export const breakGlassAction = defineAction(
  "clinical.breakglass",
  breakGlassSchema,
  async (ctx, i) => (await invokeBreakGlass(ctx, i)).id,
);
