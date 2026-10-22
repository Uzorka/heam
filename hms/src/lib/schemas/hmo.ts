import { z } from "zod";
import { localDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";
import { kobo } from "./billing";

const bp = z.coerce.number().int().min(0).max(10000);

export const payerSchema = z.object({
  id: uuid.optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Code: 2-20 letters, digits or dashes"),
  name: requiredText("Name", 120),
  scheme: z.enum(["PRIVATE_HMO", "NHIA", "STATE_SCHEME", "CORPORATE"]),
  providerCode: optionalText(60),
  contactName: optionalText(120),
  contactPhone: optionalPhone,
  contactEmail: optionalEmail,
  claimsEmail: optionalEmail,
  contractStart: localDate.optional(),
  contractEnd: localDate.optional(),
});

export const activatePayerSchema = z.object({
  id: uuid,
  contractEvidence: requiredText("Contract evidence (document reference, signatories, date)", 500),
});

export const planSchema = z.object({
  payerId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, "Code: up to 20 letters, digits or dashes"),
  name: requiredText("Plan name", 120),
  billingModel: z.enum(["FEE_FOR_SERVICE", "CAPITATION"]).default("FEE_FOR_SERVICE"),
  copayBasisPoints: bp.default(0),
  notes: optionalText(500),
});

export const tariffSchema = z
  .object({
    payerId: uuid,
    planId: uuid.optional(),
    serviceItemId: uuid,
    coverage: z.enum(["COVERED", "EXCLUDED"]),
    amountKobo: kobo("Tariff").optional(),
    copayBasisPoints: bp.optional(),
    requiresPreauth: z.boolean().default(false),
    effectiveFrom: localDate,
    note: optionalText(300),
  })
  .refine((v) => v.coverage === "EXCLUDED" || v.amountKobo !== undefined, {
    message: "Enter the agreed tariff",
    path: ["amountKobo"],
  });

export const coverageSchema = z.object({
  patientId: uuid,
  planId: uuid,
  memberNumber: requiredText("Member / enrollee number", 60),
  relationship: z.enum(["PRINCIPAL", "SPOUSE", "CHILD", "OTHER_DEPENDANT"]).default("PRINCIPAL"),
  principalName: optionalText(120),
  sponsor: optionalText(120),
  validFrom: localDate,
  validTo: localDate.optional(),
});

export const endCoverageSchema = z.object({ coverageId: uuid, reason: requiredText("Reason", 300) });

export const manualEligibilitySchema = z.object({
  coverageId: uuid,
  method: z.enum(["MANUAL_PHONE", "MANUAL_PORTAL", "MANUAL_EMAIL"]),
  outcome: z.enum(["ELIGIBLE", "NOT_ELIGIBLE", "UNREACHABLE"]),
  reference: optionalText(120),
  evidence: requiredText("Who confirmed and what they said", 500),
});

export const encounterPayerSchema = z.object({
  encounterId: uuid,
  payerClass: z.enum(["CASH", "HMO", "CORPORATE", "PART_INSURED"]),
  coverageId: uuid.optional(),
});

export const preauthSchema = z.object({
  encounterId: uuid,
  medicalNecessity: requiredText("Medical necessity", 2000),
  items: z
    .array(
      z.object({
        serviceItemId: uuid,
        orderId: uuid.optional(),
        quantity: z.coerce.number().int().min(1).max(1000),
      }),
    )
    .min(1, "Add at least one service"),
});

export const preauthDecisionSchema = z
  .object({
    id: uuid,
    version: z.number().int().min(0),
    to: z.enum([
      "SUBMITTED",
      "QUERIED",
      "APPROVED",
      "PARTIALLY_APPROVED",
      "REJECTED",
      "EXPIRED",
      "CANCELLED",
    ]),
    authCode: optionalText(80),
    approvedKobo: kobo("Approved amount").optional(),
    validUntil: localDate.optional(),
    note: optionalText(1000),
  })
  .refine((v) => !["APPROVED", "PARTIALLY_APPROVED"].includes(v.to) || !!v.authCode, {
    message: "Enter the payer's authorisation code",
    path: ["authCode"],
  });

export const claimTransitionSchema = z.object({
  id: uuid,
  version: z.number().int().min(0),
  to: z.enum([
    "SUBMITTED",
    "ACKNOWLEDGED",
    "QUERIED",
    "RESUBMITTED",
    "APPROVED",
    "PARTLY_APPROVED",
    "DENIED",
    "CLOSED",
  ]),
  approvedKobo: kobo("Approved amount").optional(),
  note: optionalText(1000),
});

export const remittanceSchema = z.object({
  payerId: uuid,
  payerReference: requiredText("Payer payment reference", 80),
  receivedDate: localDate,
  totalKobo: kobo("Total"),
  note: optionalText(300),
  lines: z
    .array(
      z.object({
        claimRef: requiredText("Claim reference", 40),
        paidKobo: kobo("Paid"),
        deniedKobo: kobo("Denied").default(0),
        reason: optionalText(200),
      }),
    )
    .min(1, "Add at least one claim line"),
});
