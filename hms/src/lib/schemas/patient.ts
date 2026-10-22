import { z } from "zod";
import { localDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";

export const SEX_OPTIONS = ["FEMALE", "MALE", "INTERSEX", "UNKNOWN"] as const;
export const DOB_PROVENANCE = ["DOCUMENT", "STATED", "ESTIMATED", "UNKNOWN"] as const;
export const IDENTIFIER_TYPES = ["NIN", "NHIA_NUMBER", "PASSPORT", "VOTERS_CARD", "DRIVERS_LICENCE", "OTHER"] as const;
export const ALLERGY_REVIEW = ["NOT_ASKED", "NO_KNOWN_ALLERGIES", "HAS_ALLERGIES"] as const;
export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

const nextOfKin = z
  .object({
    name: optionalText(120),
    relationship: optionalText(60),
    phone: optionalPhone,
  })
  .optional()
  .refine((v) => !v || !v.name || !!v.relationship, { message: "Relationship is required", path: ["relationship"] });

const demographics = {
  givenName: requiredText("First name", 80),
  middleName: optionalText(80),
  familyName: requiredText("Surname", 80),
  preferredName: optionalText(80),
  dateOfBirth: localDate.optional().or(z.literal("").transform(() => undefined)),
  estimatedAgeYears: z.coerce.number().int().min(0).max(130).optional(),
  dobProvenance: z.enum(DOB_PROVENANCE, { errorMap: () => ({ message: "Select where the date of birth came from" }) }),
  sexAtBirth: z.enum(SEX_OPTIONS, { errorMap: () => ({ message: "Select sex at birth" }) }),
  genderIdentity: optionalText(60),
  phone: optionalPhone,
  altPhone: optionalPhone,
  email: optionalEmail,
  addressLine: optionalText(200),
  city: optionalText(80),
  lga: optionalText(80),
  state: optionalText(40),
  occupation: optionalText(80),
  maritalStatus: optionalText(30),
  preferredLanguage: optionalText(40),
};

export const registerPatientSchema = z
  .object({
    ...demographics,
    referralSource: optionalText(120),
    registrationStatus: z.enum(["COMPLETE", "PROVISIONAL"]).default("COMPLETE"),
    nextOfKin,
    identifier: z
      .object({ type: z.enum(IDENTIFIER_TYPES), value: optionalText(40) })
      .optional(),
    allergyReviewStatus: z.enum(ALLERGY_REVIEW).default("NOT_ASKED"),
    privacyNoticeGiven: z.boolean(),
    smsReminderConsent: z.boolean().default(false),
    acknowledgedDuplicateIds: z.array(uuid).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.registrationStatus === "COMPLETE") {
      if (!v.dateOfBirth && v.estimatedAgeYears === undefined) {
        ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Date of birth or estimated age is required" });
      }
      if (!v.phone && !v.nextOfKin?.phone) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: "A patient or next-of-kin phone is required" });
      }
      if (!v.privacyNoticeGiven) {
        ctx.addIssue({ code: "custom", path: ["privacyNoticeGiven"], message: "Confirm the privacy notice was given" });
      }
    }
    if (v.dateOfBirth && v.dobProvenance === "ESTIMATED") {
      ctx.addIssue({ code: "custom", path: ["dobProvenance"], message: "Use 'Estimated' only with an estimated age" });
    }
    if (v.estimatedAgeYears !== undefined && v.dateOfBirth) {
      ctx.addIssue({ code: "custom", path: ["estimatedAgeYears"], message: "Enter either a date of birth or an estimated age" });
    }
  });
export type RegisterPatientInput = z.input<typeof registerPatientSchema>;

export const updatePatientSchema = z.object({
  id: uuid,
  version: z.number().int().min(0),
  ...demographics,
  referralSource: optionalText(120),
});
export type UpdatePatientInput = z.input<typeof updatePatientSchema>;

export const searchPatientsSchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeInactive: z.boolean().default(false),
  provisionalOnly: z.boolean().default(false),
});

export const allergySchema = z.object({
  patientId: uuid,
  substance: requiredText("Substance", 120),
  category: z.enum(["DRUG", "FOOD", "ENVIRONMENT", "OTHER"]),
  reaction: optionalText(200),
  severity: z.enum(["MILD", "MODERATE", "SEVERE", "UNKNOWN"]),
  source: z.enum(["PATIENT_REPORTED", "CLINICIAN_VERIFIED", "PRIOR_RECORDS"]),
});

export const consentSchema = z.object({
  patientId: uuid,
  type: z.enum([
    "DATA_PROCESSING_NOTICE",
    "GENERAL_TREATMENT",
    "PHOTO_CAPTURE",
    "SMS_REMINDERS",
    "EMAIL_NOTICES",
    "WHATSAPP_MESSAGES",
    "PORTAL_ACCESS",
  ]),
  status: z.enum(["GRANTED", "DECLINED", "WITHDRAWN"]),
  signatoryName: optionalText(120),
  signatoryRelationship: optionalText(60),
  notes: optionalText(300),
});

export const contactSchema = z.object({
  patientId: uuid,
  kind: z.enum(["NEXT_OF_KIN", "EMERGENCY", "BOTH"]),
  name: requiredText("Name", 120),
  relationship: requiredText("Relationship", 60),
  phone: optionalPhone,
  addressLine: optionalText(200),
  isPrimary: z.boolean().default(false),
});

export const guardianSchema = z.object({
  dependentPatientId: uuid,
  guardianPatientId: uuid.optional(),
  guardianName: requiredText("Guardian name", 120),
  guardianPhone: optionalPhone,
  relationship: requiredText("Relationship", 60),
});

export const statusSchema = z.object({
  patientId: uuid,
  status: z.enum(["ACTIVE", "INACTIVE", "DECEASED"]),
  reason: requiredText("Reason", 300),
  deceasedDate: localDate.optional(),
});
