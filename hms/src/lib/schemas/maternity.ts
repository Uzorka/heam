import { z } from "zod";
import { localDate, optionalText, requiredText, uuid } from "./common";

const optInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();
const optDec = (min: number, max: number) => z.coerce.number().min(min).max(max).optional();

export const openPregnancySchema = z.object({
  patientId: uuid,
  gravida: z.coerce.number().int().min(1, "Gravida is at least 1 (this pregnancy)").max(30),
  para: z.coerce.number().int().min(0).max(29),
  bookingDate: localDate,
  bloodGroup: optionalText(20),
  riskNotes: optionalText(1000),
});

export const datingSchema = z
  .object({
    episodeId: uuid,
    method: z.enum(["LMP", "ULTRASOUND", "ASSISTED_CONCEPTION", "OTHER"]),
    lmp: localDate.optional(),
    scanDate: localDate.optional(),
    gaWeeks: optInt(0, 42),
    gaExtraDays: optInt(0, 6),
    edd: localDate.optional(),
    note: optionalText(500),
    adopt: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.method === "LMP" && !v.lmp)
      ctx.addIssue({
        code: "custom",
        path: ["lmp"],
        message: "Enter the first day of the last menstrual period",
      });
    if (v.method === "ULTRASOUND") {
      if (!v.scanDate) ctx.addIssue({ code: "custom", path: ["scanDate"], message: "Enter the scan date" });
      if (v.gaWeeks === undefined)
        ctx.addIssue({ code: "custom", path: ["gaWeeks"], message: "Enter gestation at the scan" });
    }
    if ((v.method === "ASSISTED_CONCEPTION" || v.method === "OTHER") && !v.edd)
      ctx.addIssue({ code: "custom", path: ["edd"], message: "Enter the EDD and say how it was derived" });
  });

export const adoptDatingSchema = z.object({ datingId: uuid });

export const ancVisitSchema = z.object({
  episodeId: uuid,
  encounterId: uuid.optional(),
  visitDate: localDate,
  weightKg: optDec(20, 300),
  systolicMmHg: optInt(50, 300),
  diastolicMmHg: optInt(20, 200),
  fundalHeightCm: optDec(5, 60),
  fetalHeartRate: optInt(50, 250),
  presentation: optionalText(40),
  urineProtein: optionalText(20),
  oedema: optionalText(40),
  notes: optionalText(2000),
});

export const markErrorSchema = z.object({ id: uuid, reason: requiredText("Reason", 300) });

const baby = z.object({
  birthOrder: z.coerce.number().int().min(1).max(8),
  outcome: z.enum(["LIVE_BIRTH", "FRESH_STILLBIRTH", "MACERATED_STILLBIRTH"]),
  sex: z.enum(["FEMALE", "MALE", "INTERSEX", "UNKNOWN"]),
  birthTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  birthWeightG: optInt(200, 7000),
  apgar1: optInt(0, 10),
  apgar5: optInt(0, 10),
  resuscitation: optionalText(300),
  notes: optionalText(1000),
});

export const deliverySchema = z
  .object({
    episodeId: uuid,
    encounterId: uuid.optional(),
    deliveryDate: localDate,
    mode: z.enum([
      "SVD",
      "ASSISTED_VACUUM",
      "ASSISTED_FORCEPS",
      "BREECH",
      "CAESAREAN_EMERGENCY",
      "CAESAREAN_ELECTIVE",
    ]),
    bloodLossMl: optInt(0, 10000),
    placentaComplete: z.boolean().optional(),
    perineum: optionalText(200),
    complications: optionalText(2000),
    attendants: optionalText(300),
    babies: z.array(baby).min(1, "Record at least one baby").max(8),
    admitBabiesWithMother: z.boolean().default(true),
    password: z.string().min(1, "Enter your password to sign"),
  })
  .superRefine((v, ctx) => {
    const orders = v.babies.map((b) => b.birthOrder);
    if (new Set(orders).size !== orders.length)
      ctx.addIssue({ code: "custom", path: ["babies"], message: "Birth order must be unique" });
  });

export const postnatalSchema = z
  .object({
    episodeId: uuid,
    subject: z.enum(["MOTHER", "BABY"]),
    babyPatientId: uuid.optional(),
    visitDate: localDate,
    temperatureC: optDec(30, 45),
    systolicMmHg: optInt(50, 300),
    diastolicMmHg: optInt(20, 200),
    weightG: optInt(200, 200000),
    feeding: optionalText(100),
    findings: requiredText("Findings", 2000),
    plan: optionalText(1000),
  })
  .refine((v) => (v.subject === "BABY") === !!v.babyPatientId, {
    path: ["babyPatientId"],
    message: "Choose the baby",
  });

export const endPregnancySchema = z.object({
  episodeId: uuid,
  reason: requiredText("Outcome / reason", 500),
});
