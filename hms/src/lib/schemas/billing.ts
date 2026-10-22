import { z } from "zod";
import { localDate, optionalText, requiredText, uuid } from "./common";

/** Money from forms arrives as integer kobo (converted from naira on the client). */
export const kobo = (label = "Amount") =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be whole kobo`)
    .min(0, `${label} cannot be negative`)
    .max(100_000_000_000_00, `${label} is too large`);
const positiveKobo = (label = "Amount") =>
  kobo(label).refine((v) => v > 0, `${label} must be more than zero`);

export const serviceItemSchema = z.object({
  id: uuid.optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,30}$/, "Code: 2-30 letters, digits or dashes"),
  name: requiredText("Name", 160),
  category: z.enum([
    "CONSULTATION",
    "ADMISSION",
    "LABORATORY",
    "IMAGING",
    "PROCEDURE",
    "MATERNITY",
    "CONSUMABLE",
    "PHARMACY",
    "MISCELLANEOUS",
  ]),
  labTestId: uuid.optional(),
  imagingStudyId: uuid.optional(),
  visitTypeId: uuid.optional(),
  inventoryProductId: uuid.optional(),
  active: z.boolean().default(true),
});

export const proposePriceSchema = z.object({
  serviceItemId: uuid,
  amountKobo: kobo("Price"),
  effectiveFrom: localDate,
  reason: requiredText("Reason / source", 300),
});

export const decidePriceSchema = z.object({
  id: uuid,
  decision: z.enum(["APPROVE", "REJECT"]),
  note: optionalText(300),
});

export const manualChargeSchema = z.object({
  encounterId: uuid,
  serviceItemId: uuid,
  quantity: z.coerce.number().int().min(1).max(1000),
  note: optionalText(200),
  idempotencyKey: z.string().uuid(),
});

export const resolveChargeSchema = z.object({
  chargeId: uuid,
  note: requiredText("Reason", 300),
  unitPriceKobo: kobo("Price").optional(),
});

export const adjustmentSchema = z.object({
  invoiceId: uuid,
  type: z.enum(["DISCOUNT", "CREDIT_NOTE", "WRITE_OFF"]),
  amountKobo: positiveKobo(),
  reason: requiredText("Reason", 300),
});

export const decisionSchema = z.object({
  id: uuid,
  decision: z.enum(["APPROVE", "REJECT"]),
  note: optionalText(300),
});

export const recordPaymentSchema = z
  .object({
    patientId: uuid,
    invoiceId: uuid.optional(),
    method: z.enum(["CASH", "POS", "BANK_TRANSFER"]),
    amountKobo: positiveKobo(),
    reference: optionalText(80),
    idempotencyKey: z.string().uuid(),
  })
  .refine((v) => v.method === "CASH" || !!v.reference, {
    message: "Enter the POS slip or transfer reference",
    path: ["reference"],
  });

export const applyCreditSchema = z.object({ patientId: uuid, invoiceId: uuid });

export const refundRequestSchema = z.object({
  paymentId: uuid,
  amountKobo: positiveKobo(),
  method: z.enum(["CASH", "POS", "BANK_TRANSFER"]),
  reason: requiredText("Reason", 300),
});

export const refundPaidSchema = z.object({ id: uuid, reference: optionalText(80) });

export const reversePaymentSchema = z.object({ paymentId: uuid, reason: requiredText("Reason", 300) });

export const openShiftSchema = z.object({ openingFloatKobo: kobo("Opening float") });
export const closeShiftSchema = z.object({
  shiftId: uuid,
  countedCashKobo: kobo("Counted cash"),
  note: optionalText(300),
});
