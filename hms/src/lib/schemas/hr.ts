import { z } from "zod";
import { localDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";

export const employeeSchema = z.object({
  id: uuid.optional(),
  staffNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Staff number: 2-20 letters, digits or dashes"),
  givenName: requiredText("First name", 80),
  familyName: requiredText("Surname", 80),
  jobTitle: requiredText("Job title", 120),
  department: optionalText(120),
  employmentType: z.enum(["PERMANENT", "CONTRACT", "LOCUM", "INTERN", "NYSC", "VOLUNTEER"]),
  startDate: localDate,
  phone: optionalPhone,
  email: optionalEmail,
  bankName: optionalText(80),
  bankAccount: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "NUBAN account numbers have 10 digits")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  userEmail: optionalEmail,
});

export const employeeStatusSchema = z.object({
  id: uuid,
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "EXITED"]),
  endDate: localDate.optional(),
  reason: requiredText("Reason", 300),
});

export const credentialSchema = z.object({
  employeeId: uuid,
  kind: requiredText("Credential", 80),
  number: requiredText("Number", 60),
  issuer: requiredText("Issuing body", 120),
  expiresAt: localDate.optional(),
});

export const verifyCredentialSchema = z.object({
  id: uuid,
  evidence: requiredText("How it was verified", 300),
});

export const shiftSchema = z.object({
  employeeId: uuid,
  date: localDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  kind: z.enum(["MORNING", "AFTERNOON", "NIGHT", "ON_CALL", "OTHER"]),
  location: optionalText(80),
  note: optionalText(200),
});

export const leaveSchema = z.object({
  employeeId: uuid.optional(),
  type: z.enum(["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "STUDY", "COMPASSIONATE", "UNPAID", "OTHER"]),
  startDate: localDate,
  endDate: localDate,
  reason: requiredText("Reason", 300),
});

export const payComponentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,20}$/, "Code: 2-20 letters, digits or underscores"),
    name: requiredText("Name", 80),
    kind: z.enum(["EARNING", "DEDUCTION"]),
    calc: z.enum(["FIXED", "PERCENT_OF_BASIC"]),
    rateBasisPoints: z.coerce.number().int().min(0).max(10000).optional(),
    isBasic: z.boolean().default(false),
    note: requiredText("Source / policy reference", 300),
  })
  .refine((v) => v.calc === "FIXED" || v.rateBasisPoints !== undefined, {
    path: ["rateBasisPoints"],
    message: "Enter the percentage in basis points",
  })
  .refine((v) => !v.isBasic || (v.kind === "EARNING" && v.calc === "FIXED"), {
    path: ["isBasic"],
    message: "Basic pay is a fixed earning",
  });

export const payItemSchema = z.object({
  employeeId: uuid,
  componentId: uuid,
  amountKobo: z.coerce.number().int().min(0).optional(),
  effectiveFrom: localDate,
});

export const payrollRunSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"),
  note: optionalText(300),
});
