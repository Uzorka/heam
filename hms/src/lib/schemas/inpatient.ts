import { z } from "zod";
import { optionalText, requiredText, uuid } from "./common";

export const admitSchema = z.object({
  encounterId: uuid,
  wardId: uuid,
  bedId: uuid.optional(),
  reason: requiredText("Reason for admission", 500),
  attendingClinicianId: uuid.optional(),
});

export const bedMoveSchema = z.object({
  admissionId: uuid,
  bedId: uuid,
  reason: optionalText(300),
});

export const authoriseDischargeSchema = z.object({
  admissionId: uuid,
  summary: requiredText("Discharge summary", 5000),
  destination: requiredText("Discharged to", 120),
  password: z.string().min(1, "Enter your password to sign"),
});

export const clearanceSchema = z.object({
  admissionId: uuid,
  override: z.boolean().default(false),
  note: optionalText(500),
});

export const marSchema = z.object({
  prescriptionItemId: uuid,
  encounterId: uuid,
  status: z.enum(["GIVEN", "HELD", "REFUSED", "NOT_AVAILABLE"]),
  doseGiven: optionalText(60),
  route: optionalText(40),
  reason: optionalText(300),
  witnessEmail: optionalText(120),
  witnessPassword: z.string().optional(),
});
