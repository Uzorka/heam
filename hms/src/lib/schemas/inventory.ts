import { z } from "zod";
import { localDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";

const qty = z.coerce.number().int().min(1, "Quantity must be at least 1").max(1_000_000);

export const productSchema = z.object({
  id: uuid.optional(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,30}$/, "SKU: 3-30 letters, digits or dashes"),
  name: requiredText("Name", 120),
  category: z.enum(["LAB_CONSUMABLE", "MEDICAL_SUPPLY", "MATERNITY_THEATRE", "OFFICE_MAINTENANCE", "ASSET"]),
  baseUnit: requiredText("Base unit", 30),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000).default(0),
  reorderQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  trackExpiry: z.boolean().default(true),
  active: z.boolean().default(true),
});

export const locationSchema = z.object({
  branchId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Code: 2-20 letters, digits or dashes"),
  name: requiredText("Name", 80),
  kind: z.enum(["MAIN_STORE", "PHARMACY", "WARD", "LABORATORY", "THEATRE", "QUARANTINE"]),
});

export const supplierSchema = z.object({
  id: uuid.optional(),
  name: requiredText("Supplier name", 120),
  contactName: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  active: z.boolean().default(true),
});

export const requisitionSchema = z.object({
  branchId: uuid,
  justification: requiredText("Justification", 500),
  items: z
    .array(z.object({ productId: uuid, quantity: qty, note: optionalText(200) }))
    .min(1, "Add at least one item")
    .max(50),
});

export const decideSchema = z.object({
  id: uuid,
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: optionalText(500),
});

export const purchaseOrderSchema = z.object({
  requisitionId: uuid.optional(),
  branchId: uuid,
  supplierId: uuid,
  notes: optionalText(500),
  items: z
    .array(
      z.object({
        productId: uuid,
        quantity: qty,
        /** Unit cost in kobo, entered by a person from the supplier's quotation. */
        unitCostKobo: z.coerce.number().int().min(0).max(1_000_000_000_00),
      }),
    )
    .min(1)
    .max(50),
});

export const receiveGoodsSchema = z.object({
  purchaseOrderId: uuid,
  locationId: uuid,
  deliveryNote: optionalText(120),
  idempotencyKey: z.string().uuid(),
  lines: z
    .array(
      z.object({
        poItemId: uuid,
        quantity: qty,
        lotNumber: requiredText("Lot/batch number", 60),
        expiryDate: localDate.optional(),
        manufacturer: optionalText(120),
        quarantine: z.boolean().default(false),
      }),
    )
    .min(1),
});

export const transferSchema = z.object({
  lotId: uuid,
  fromLocationId: uuid,
  toLocationId: uuid,
  quantity: qty,
  reason: optionalText(200),
  idempotencyKey: z.string().uuid(),
});

export const adjustmentRequestSchema = z.object({
  lotId: uuid,
  locationId: uuid,
  quantityDelta: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, "Enter a non-zero change")
    .refine((v) => Math.abs(v) <= 1_000_000, "Too large"),
  reason: z.enum(["DAMAGED", "EXPIRED", "LOST", "RECALLED", "FOUND", "OTHER"]),
  notes: requiredText("Notes", 500),
});

export const lotStatusSchema = z.object({
  lotId: uuid,
  status: z.enum(["AVAILABLE", "QUARANTINED", "RECALLED"]),
  reason: requiredText("Reason", 300),
});

export const startCountSchema = z.object({ locationId: uuid, notes: optionalText(300) });
export const countLinesSchema = z.object({
  countId: uuid,
  lines: z
    .array(
      z.object({
        lineId: uuid,
        countedQty: z.coerce.number().int().min(0).max(1_000_000),
        varianceNote: optionalText(200),
      }),
    )
    .min(1),
  submit: z.boolean().default(false),
});
