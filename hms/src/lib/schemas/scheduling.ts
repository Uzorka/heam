import { z } from "zod";
import { localDate, localTime, optionalText, requiredText, uuid } from "./common";

export const APPOINTMENT_SOURCES = ["WALK_IN", "PHONE", "ONLINE_REQUEST", "REFERRAL", "FOLLOW_UP"] as const;
export const PAYER_CLASSES = ["UNDETERMINED", "CASH", "HMO", "CORPORATE", "PART_INSURED"] as const;
export const PRIORITIES = ["ROUTINE", "URGENT", "EMERGENCY"] as const;

const override = z
  .object({
    reason: requiredText("Override reason", 300).refine((v) => v.length >= 5, "Give a specific reason"),
  })
  .optional();

export const bookAppointmentSchema = z.object({
  patientId: uuid,
  visitTypeId: uuid,
  clinicianId: uuid.optional().or(z.literal("").transform(() => undefined)),
  departmentId: uuid.optional().or(z.literal("").transform(() => undefined)),
  date: localDate,
  time: localTime,
  durationMin: z.coerce.number().int().min(5).max(240).optional(),
  source: z.enum(APPOINTMENT_SOURCES),
  reason: optionalText(300),
  override,
});

export const rescheduleAppointmentSchema = z.object({
  appointmentId: uuid,
  version: z.number().int().min(0),
  date: localDate,
  time: localTime,
  durationMin: z.coerce.number().int().min(5).max(240).optional(),
  clinicianId: uuid.optional().or(z.literal("").transform(() => undefined)),
  override,
});

export const cancelAppointmentSchema = z.object({
  appointmentId: uuid,
  reason: requiredText("Reason", 300),
});

export const listAppointmentsSchema = z.object({
  date: localDate,
  clinicianId: uuid.optional(),
});

export const checkInSchema = z
  .object({
    appointmentId: uuid.optional(),
    patientId: uuid.optional(),
    visitTypeId: uuid.optional(),
    clinicianId: uuid.optional().or(z.literal("").transform(() => undefined)),
    priority: z.enum(PRIORITIES).default("ROUTINE"),
    payerClass: z.enum(PAYER_CLASSES).default("UNDETERMINED"),
    coverageId: uuid.optional(),
    reason: optionalText(300),
    referralSource: optionalText(120),
    financialTermsAcknowledged: z.boolean().default(false),
  })
  .refine((v) => !!v.appointmentId || (!!v.patientId && !!v.visitTypeId), {
    message: "Choose an appointment, or a patient and visit type for a walk-in",
    path: ["patientId"],
  });

export const transitionSchema = z.object({
  encounterId: uuid,
  version: z.number().int().min(0),
  toStage: z.enum([
    "REGISTERED",
    "AWAITING_VITALS",
    "READY_FOR_DOCTOR",
    "IN_CONSULTATION",
    "AWAITING_SERVICES",
    "AWAITING_REVIEW",
    "READY_TO_DISCHARGE",
    "COMPLETED",
    "CANCELLED",
  ]),
  note: optionalText(300),
});

export const assignClinicianSchema = z.object({
  encounterId: uuid,
  clinicianId: uuid,
});
