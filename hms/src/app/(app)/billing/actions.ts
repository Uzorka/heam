"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { decidePrice, proposePrice, saveServiceItem } from "@/server/domains/billing/catalogue";
import {
  addManualCharge,
  decideAdjustment,
  finaliseInvoice,
  reevaluateCharge,
  requestAdjustment,
  resolveAsPatientPay,
  voidManualCharge,
} from "@/server/domains/billing/charges";
import {
  applyCredit,
  approveShift,
  closeShift,
  decideRefund,
  markRefundPaid,
  openShift,
  recordPayment,
  requestRefund,
  reversePayment,
} from "@/server/domains/billing/payments";
import {
  adjustmentSchema,
  applyCreditSchema,
  closeShiftSchema,
  decidePriceSchema,
  decisionSchema,
  manualChargeSchema,
  openShiftSchema,
  proposePriceSchema,
  recordPaymentSchema,
  refundPaidSchema,
  refundRequestSchema,
  resolveChargeSchema,
  reversePaymentSchema,
  serviceItemSchema,
} from "@/lib/schemas/billing";
import { optionalText, requiredText, uuid } from "@/lib/schemas/common";

export const saveServiceItemAction = defineAction(
  "billing.service.save",
  serviceItemSchema,
  async (ctx, i) => (await saveServiceItem(ctx, i)).id,
);
export const proposePriceAction = defineAction(
  "billing.price.propose",
  proposePriceSchema,
  async (ctx, i) => (await proposePrice(ctx, i)).id,
);
export const decidePriceAction = defineAction("billing.price.decide", decidePriceSchema, decidePrice);

export const manualChargeAction = defineAction(
  "billing.charge.manual",
  manualChargeSchema,
  async (ctx, i) => (await addManualCharge(ctx, i)).id,
);
export const voidChargeAction = defineAction(
  "billing.charge.void",
  z.object({ chargeId: uuid, reason: requiredText("Reason", 300) }),
  voidManualCharge,
);
export const reevaluateChargeAction = defineAction(
  "billing.charge.reevaluate",
  z.object({ chargeId: uuid }),
  async (ctx, i) => {
    await reevaluateCharge(ctx, i.chargeId);
  },
);
export const resolveChargeAction = defineAction(
  "billing.charge.resolve",
  resolveChargeSchema,
  async (ctx, i) => {
    await resolveAsPatientPay(ctx, i);
  },
);
export const finaliseInvoiceAction = defineAction(
  "billing.invoice.finalise",
  z.object({ invoiceId: uuid, version: z.number().int().min(0) }),
  finaliseInvoice,
);
export const requestAdjustmentAction = defineAction(
  "billing.adjustment.request",
  adjustmentSchema,
  async (ctx, i) => (await requestAdjustment(ctx, i)).id,
);
export const decideAdjustmentAction = defineAction(
  "billing.adjustment.decide",
  decisionSchema,
  decideAdjustment,
);

export const recordPaymentAction = defineAction(
  "billing.payment.record",
  recordPaymentSchema,
  async (ctx, i) => {
    const r = await recordPayment(ctx, i);
    return { paymentId: r.payment.id, receiptNo: r.payment.receiptNo, duplicate: r.duplicate };
  },
);
export const applyCreditAction = defineAction("billing.credit.apply", applyCreditSchema, async (ctx, i) =>
  String(await applyCredit(ctx, i)),
);
export const reversePaymentAction = defineAction(
  "billing.payment.reverse",
  reversePaymentSchema,
  reversePayment,
);
export const requestRefundAction = defineAction(
  "billing.refund.request",
  refundRequestSchema,
  async (ctx, i) => (await requestRefund(ctx, i)).id,
);
export const decideRefundAction = defineAction("billing.refund.decide", decisionSchema, decideRefund);
export const refundPaidAction = defineAction("billing.refund.paid", refundPaidSchema, markRefundPaid);

export const openShiftAction = defineAction(
  "billing.shift.open",
  openShiftSchema,
  async (ctx, i) => (await openShift(ctx, i)).id,
);
export const closeShiftAction = defineAction("billing.shift.close", closeShiftSchema, async (ctx, i) => {
  const r = await closeShift(ctx, i);
  return { variance: r.variance.toString() };
});
export const approveShiftAction = defineAction(
  "billing.shift.approve",
  z.object({ id: uuid, note: optionalText(300) }),
  approveShift,
);
