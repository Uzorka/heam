import { z } from "zod";
import { optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{2,20}$/, "Use 2-20 letters, numbers, - or _");

export const organizationSchema = z.object({
  version: z.number().int(),
  name: requiredText("Name", 120),
  subtitle: optionalText(120),
  tagline: optionalText(160),
  legalName: optionalText(160),
  website: optionalText(200),
  email: optionalEmail,
  phone: optionalPhone,
  letterhead: optionalText(500),
});

export const branchSchema = z.object({
  id: uuid.optional(),
  code,
  name: requiredText("Name", 120),
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(40),
  phone: optionalPhone,
  email: optionalEmail,
  status: z.enum(["ACTIVE", "PENDING_VERIFICATION", "INACTIVE"]),
  verificationStatus: z.enum(["UNKNOWN", "AWAITING_APPROVAL", "VERIFIED", "REJECTED"]),
  verificationNotes: optionalText(500),
});

export const departmentSchema = z.object({
  id: uuid.optional(),
  branchId: uuid,
  code,
  name: requiredText("Name", 120),
  kind: z.enum(["CLINICAL", "DIAGNOSTIC", "SUPPORT", "ADMINISTRATIVE"]),
  active: z.boolean().default(true),
});

export const wardSchema = z.object({
  id: uuid.optional(),
  branchId: uuid,
  departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  code,
  name: requiredText("Name", 120),
  kind: z.enum(["GENERAL", "MATERNITY", "LABOUR", "PAEDIATRIC", "NEWBORN", "EMERGENCY", "PRIVATE", "OTHER"]),
  active: z.boolean().default(true),
});

export const bedSchema = z.object({
  id: uuid.optional(),
  wardId: uuid,
  code,
  label: requiredText("Label", 60),
  category: requiredText("Category", 40),
  active: z.boolean().default(true),
  status: z.enum(["FREE", "CLEANING", "UNAVAILABLE"]).optional(),
});

export const visitTypeSchema = z.object({
  id: uuid.optional(),
  code,
  name: requiredText("Name", 120),
  departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  defaultDurationMin: z.coerce.number().int().min(5).max(240),
  active: z.boolean().default(true),
});

export const setupFactDecisionSchema = z.object({
  id: uuid,
  status: z.enum(["UNKNOWN", "AWAITING_APPROVAL", "VERIFIED", "REJECTED"]),
  value: requiredText("Value", 500),
  notes: optionalText(500),
});

export const settingUpdateSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
