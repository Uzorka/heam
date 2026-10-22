import { z } from "zod";
import { optionalText, requiredText, uuid } from "./common";

const dosageForms = [
  "TABLET",
  "CAPSULE",
  "SYRUP",
  "SUSPENSION",
  "INJECTION",
  "INFUSION",
  "CREAM",
  "OINTMENT",
  "DROPS",
  "INHALER",
  "SUPPOSITORY",
  "PESSARY",
  "OTHER",
] as const;

export const medicationSchema = z.object({
  id: uuid.optional(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,30}$/, "SKU: 3-30 letters, digits or dashes"),
  genericName: requiredText("Generic name", 120),
  brandName: optionalText(120),
  strength: requiredText("Strength", 60),
  form: z.enum(dosageForms, { errorMap: () => ({ message: "Choose a dosage form" }) }),
  defaultRoute: requiredText("Default route", 40),
  dispensingUnit: requiredText("Dispensing unit", 30),
  nafdacNumber: optionalText(40),
  controlled: z.boolean().default(false),
  formularyStatus: z.enum(["FORMULARY", "RESTRICTED", "NON_FORMULARY"]).default("FORMULARY"),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000).default(0),
  reorderQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
});

export const frequencySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,20}$/, "Code: up to 20 letters, digits or underscores"),
  label: requiredText("Label", 80),
  timesPerDay: z.coerce.number().min(0).max(48).optional(),
});

export const prescriptionItemSchema = z.object({
  medicationId: uuid,
  dose: requiredText("Dose", 60),
  route: requiredText("Route", 40),
  frequencyId: uuid,
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  prn: z.boolean().default(false),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(10_000),
  instructions: optionalText(500),
});

export const createPrescriptionSchema = z.object({
  encounterId: uuid,
  notes: optionalText(500),
  items: z.array(prescriptionItemSchema).min(1, "Add at least one medicine").max(20),
  password: z.string().min(1, "Enter your password to sign"),
  /** Acknowledges the allergy list was reviewed when the patient has active allergies. */
  allergiesReviewed: z.boolean().default(false),
});

export const cancelPrescriptionItemSchema = z.object({
  itemId: uuid,
  reason: requiredText("Reason", 300),
});

export const verifyItemSchema = z.object({
  itemId: uuid,
  version: z.number().int().min(0),
  decision: z.enum(["VERIFY", "QUERY"]),
  note: optionalText(500),
});

export const dispenseSchema = z.object({
  itemId: uuid,
  locationId: uuid,
  quantity: z.coerce.number().int().min(1).max(10_000),
  /** Specific lot chosen by the pharmacist; omitted = first-expiry-first-out. */
  lotId: uuid.optional(),
  counsellingGiven: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
});

export const reverseDispenseSchema = z.object({
  dispenseId: uuid,
  reason: requiredText("Reason", 300),
});
