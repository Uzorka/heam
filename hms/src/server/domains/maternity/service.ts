import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, requirePermission, type AuthContext } from "../../authz/context";
import { getClinicalAccess } from "../../authz/clinical-access";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { nextMrn, nextYearlyRef } from "../../sequence";
import { isUniqueViolation } from "../../db-errors";
import { sha256 } from "../../crypto";
import { confirmSignature } from "../../auth/reauth";
import { calendarDateToUtcMidnight, localDateTimeToUtc, todayLocal, toLocalDateString } from "@/lib/time";
import { eddFromLmp, eddFromScan, gestationDays } from "@/lib/obstetrics";
import type {
  ancVisitSchema,
  datingSchema,
  deliverySchema,
  endPregnancySchema,
  markErrorSchema,
  openPregnancySchema,
  postnatalSchema,
} from "@/lib/schemas/maternity";
import { buildNameSearch } from "../patients/normalize";
import { approvedThresholds } from "../clinical/observations";
import { flagVitals } from "../clinical/vital-flags";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const year = () => Number(todayLocal().slice(0, 4));

/**
 * Maternity access: full clinical access to the mother, or an open visit for her in a branch where
 * the user holds the maternity permission (the midwife on duty).
 */
async function requireMaternityAccess(
  ctx: AuthContext,
  patientId: string,
  permission: "maternity.read" | "maternity.write" | "maternity.delivery.sign",
  db: DbClient,
) {
  const access = await getClinicalAccess(ctx, patientId, db);
  if (access.allowed && can(ctx, permission)) return;
  const open = await db.encounter.findFirst({
    where: { patientId, status: "OPEN" },
    select: { branchId: true },
  });
  if (open && can(ctx, permission, { branchId: open.branchId })) return;
  throw new ForbiddenError("You have no care relationship with this patient.", permission);
}

async function loadEpisode(
  ctx: AuthContext,
  id: string,
  permission: "maternity.read" | "maternity.write" | "maternity.delivery.sign",
  db: DbClient,
) {
  const ep = await db.pregnancyEpisode.findUnique({ where: { id } });
  if (!ep) throw new NotFoundError("Pregnancy record not found.");
  await requireMaternityAccess(ctx, ep.patientId, permission, db);
  return ep;
}

export async function openPregnancy(
  ctx: AuthContext,
  input: z.output<typeof openPregnancySchema>,
  db: DbClient = prisma,
) {
  const patient = await db.patient.findUnique({ where: { id: input.patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");
  await requireMaternityAccess(ctx, patient.id, "maternity.write", db);
  if (patient.sexAtBirth === "MALE")
    throw new ValidationError("A pregnancy cannot be opened for a patient recorded as male at birth.");
  if (input.para >= input.gravida)
    throw new ValidationError("Para must be less than gravida (gravida includes this pregnancy).");
  const branchId = ctx.activeBranchId ?? patient.registeredBranchId;
  try {
    return await withTx(db, async (tx) => {
      const ep = await tx.pregnancyEpisode.create({
        data: {
          ref: await nextYearlyRef(tx, "PRG", year()),
          patientId: patient.id,
          branchId,
          gravida: input.gravida,
          para: input.para,
          bookingDate: calendarDateToUtcMidnight(input.bookingDate),
          bloodGroup: input.bloodGroup ?? null,
          riskNotes: input.riskNotes ?? null,
          openedById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "maternity.pregnancy.open",
        resourceType: "PregnancyEpisode",
        resourceId: ep.id,
        patientId: patient.id,
        details: { ref: ep.ref },
        meta: ctx.meta,
      });
      return ep;
    });
  } catch (e) {
    if (isUniqueViolation(e) || String(e).includes("PregnancyEpisode_one_active"))
      throw new ConflictError("This patient already has an active pregnancy record.");
    throw e;
  }
}

/**
 * Record how the pregnancy was dated. The calculated EDD is a proposal; only an explicit adoption
 * by the clinician sets the pregnancy's EDD.
 */
export async function addDating(
  ctx: AuthContext,
  input: z.output<typeof datingSchema>,
  db: DbClient = prisma,
) {
  const ep = await loadEpisode(ctx, input.episodeId, "maternity.write", db);
  if (ep.status !== "ACTIVE") throw new ConflictError("This pregnancy is closed.");
  const gaDays = input.gaWeeks !== undefined ? input.gaWeeks * 7 + (input.gaExtraDays ?? 0) : null;
  const edd =
    input.method === "LMP"
      ? eddFromLmp(input.lmp!)
      : input.method === "ULTRASOUND"
        ? eddFromScan(input.scanDate!, gaDays!)
        : input.edd!;
  const ga = gestationDays(edd, todayLocal());
  if (ga < 0 || ga > 320)
    throw new ValidationError(
      `That gives a gestation of ${Math.floor(ga / 7)} weeks today - check the dates.`,
    );
  return withTx(db, async (tx) => {
    if (input.adopt)
      await tx.pregnancyDatingEvent.updateMany({
        where: { episodeId: ep.id, adopted: true },
        data: { adopted: false },
      });
    const ev = await tx.pregnancyDatingEvent.create({
      data: {
        episodeId: ep.id,
        method: input.method,
        lmp: input.lmp ? calendarDateToUtcMidnight(input.lmp) : null,
        scanDate: input.scanDate ? calendarDateToUtcMidnight(input.scanDate) : null,
        gaAtScanDays: gaDays,
        edd: calendarDateToUtcMidnight(edd),
        note: input.note ?? null,
        adopted: input.adopt,
        recordedById: ctx.userId,
      },
    });
    if (input.adopt)
      await tx.pregnancyEpisode.update({
        where: { id: ep.id },
        data: { edd: calendarDateToUtcMidnight(edd), version: { increment: 1 } },
      });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.adopt ? "maternity.dating.adopt" : "maternity.dating.record",
      resourceType: "PregnancyEpisode",
      resourceId: ep.id,
      patientId: ep.patientId,
      details: { method: input.method, edd },
      meta: ctx.meta,
    });
    return ev;
  });
}

export async function adoptDating(ctx: AuthContext, datingId: string, db: DbClient = prisma) {
  const ev = await db.pregnancyDatingEvent.findUnique({ where: { id: datingId } });
  if (!ev) throw new NotFoundError("Dating record not found.");
  const ep = await loadEpisode(ctx, ev.episodeId, "maternity.write", db);
  if (ev.adopted) throw new ConflictError("Already the adopted dating.");
  await withTx(db, async (tx) => {
    await tx.pregnancyDatingEvent.updateMany({
      where: { episodeId: ep.id, adopted: true },
      data: { adopted: false },
    });
    await tx.pregnancyDatingEvent.update({ where: { id: ev.id }, data: { adopted: true } });
    await tx.pregnancyEpisode.update({
      where: { id: ep.id },
      data: { edd: ev.edd, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.dating.adopt",
      resourceType: "PregnancyEpisode",
      resourceId: ep.id,
      patientId: ep.patientId,
      details: { method: ev.method, edd: iso(ev.edd) },
      meta: ctx.meta,
    });
  });
}

export async function recordAncVisit(
  ctx: AuthContext,
  input: z.output<typeof ancVisitSchema>,
  db: DbClient = prisma,
) {
  const ep = await loadEpisode(ctx, input.episodeId, "maternity.write", db);
  if (ep.status !== "ACTIVE") throw new ConflictError("This pregnancy is closed.");
  if (input.visitDate > todayLocal()) throw new ValidationError("The visit date cannot be in the future.");
  const { episodeId, visitDate, encounterId, ...obs } = input;
  return withTx(db, async (tx) => {
    const v = await tx.antenatalVisit.create({
      data: {
        episodeId,
        encounterId: encounterId ?? null,
        visitDate: calendarDateToUtcMidnight(visitDate),
        gestationDays: ep.edd ? gestationDays(iso(ep.edd), visitDate) : null,
        ...obs,
        recordedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.anc.record",
      resourceType: "AntenatalVisit",
      resourceId: v.id,
      patientId: ep.patientId,
      meta: ctx.meta,
    });
    return v;
  });
}

export async function markAncError(
  ctx: AuthContext,
  input: z.output<typeof markErrorSchema>,
  db: DbClient = prisma,
) {
  const v = await db.antenatalVisit.findUnique({ where: { id: input.id } });
  if (!v) throw new NotFoundError("Visit not found.");
  const ep = await loadEpisode(ctx, v.episodeId, "maternity.write", db);
  if (v.enteredInErrorAt) throw new ConflictError("Already marked.");
  await withTx(db, async (tx) => {
    await tx.antenatalVisit.update({
      where: { id: v.id },
      data: { enteredInErrorAt: new Date(), errorReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.anc.entered_in_error",
      resourceType: "AntenatalVisit",
      resourceId: v.id,
      patientId: ep.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

/** Create the baby's own patient record, linked to the mother as a verified guardian. */
async function createBabyPatient(
  tx: Tx,
  mother: {
    id: string;
    familyName: string;
    givenName: string;
    phoneE164: string | null;
    registeredBranchId: string;
  },
  b: { sex: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN"; birthOrder: number },
  multiple: boolean,
  birthDate: string,
  deliveryRef: string,
  userId: string,
  branchId: string,
) {
  const givenName = "Baby";
  const preferredName = multiple ? `Twin ${b.birthOrder}` : null;
  const baby = await tx.patient.create({
    data: {
      mrn: await nextMrn(tx),
      registeredBranchId: branchId,
      givenName,
      familyName: mother.familyName,
      preferredName,
      nameSearch: buildNameSearch({ givenName, familyName: mother.familyName, preferredName }),
      dateOfBirth: calendarDateToUtcMidnight(birthDate),
      dobProvenance: "DOCUMENT",
      sexAtBirth: b.sex,
      phoneE164: mother.phoneE164,
      registrationStatus: "PROVISIONAL",
      createdById: userId,
    },
  });
  await tx.guardianRelationship.create({
    data: {
      dependentPatientId: baby.id,
      guardianPatientId: mother.id,
      guardianName: `${mother.givenName} ${mother.familyName}`,
      guardianPhoneE164: mother.phoneE164,
      relationship: "Mother",
      verified: true,
      verificationEvidence: `Born at this facility: delivery ${deliveryRef}`,
      verifiedById: userId,
      verifiedAt: new Date(),
      createdById: userId,
    },
  });
  return baby;
}

/**
 * Record and sign a delivery (password signature). One delivery record per pregnancy; one newborn
 * record per baby (twins: birth order 1 and 2), and a separate patient record for each live-born
 * baby linked to the mother. If the mother is an inpatient, live-born babies can be admitted with
 * her (rooming-in) on their own visits.
 */
export async function recordDelivery(
  ctx: AuthContext,
  input: z.output<typeof deliverySchema>,
  db: DbClient = prisma,
) {
  const ep = await loadEpisode(ctx, input.episodeId, "maternity.delivery.sign", db);
  if (ep.status !== "ACTIVE") throw new ConflictError("This pregnancy already has a delivery or is closed.");
  if (input.deliveryDate > todayLocal())
    throw new ValidationError("The delivery date cannot be in the future.");
  const mother = await db.patient.findUniqueOrThrow({ where: { id: ep.patientId } });
  const births = input.babies
    .map((b) => ({ ...b, at: localDateTimeToUtc(input.deliveryDate, b.birthTime) }))
    .sort((a, b) => a.birthOrder - b.birthOrder);
  if (births.some((b) => b.at > new Date())) throw new ValidationError("A birth time is in the future.");
  await confirmSignature(db, ctx, input.password);
  const motherAdmission = await db.admission.findFirst({
    where: { patientId: mother.id, status: { in: ["ADMITTED", "DISCHARGE_AUTHORISED"] } },
    include: { encounter: true },
  });
  return withTx(db, async (tx) => {
    const ref = await nextYearlyRef(tx, "DEL", year());
    const delivery = await tx.deliveryRecord.create({
      data: {
        ref,
        episodeId: ep.id,
        motherPatientId: mother.id,
        encounterId: input.encounterId ?? motherAdmission?.encounterId ?? null,
        deliveredAt: births[0]!.at,
        mode: input.mode,
        gestationDays: ep.edd ? gestationDays(iso(ep.edd), input.deliveryDate) : null,
        bloodLossMl: input.bloodLossMl ?? null,
        placentaComplete: input.placentaComplete ?? null,
        perineum: input.perineum ?? null,
        complications: input.complications ?? null,
        attendants: input.attendants ?? null,
        recordedById: ctx.userId,
      },
    });
    const multiple = births.length > 1;
    const babies: { newbornId: string; babyPatientId: string | null }[] = [];
    for (const b of births) {
      const babyPatient =
        b.outcome === "LIVE_BIRTH"
          ? await createBabyPatient(
              tx,
              mother,
              b,
              multiple,
              toLocalDateString(b.at),
              ref,
              ctx.userId,
              ep.branchId,
            )
          : null;
      const nb = await tx.newbornRecord.create({
        data: {
          deliveryId: delivery.id,
          birthOrder: b.birthOrder,
          outcome: b.outcome,
          sex: b.sex,
          birthAt: b.at,
          birthWeightG: b.birthWeightG ?? null,
          apgar1: b.apgar1 ?? null,
          apgar5: b.apgar5 ?? null,
          resuscitation: b.resuscitation ?? null,
          notes: b.notes ?? null,
          babyPatientId: babyPatient?.id ?? null,
        },
      });
      babies.push({ newbornId: nb.id, babyPatientId: babyPatient?.id ?? null });
      if (babyPatient && motherAdmission && input.admitBabiesWithMother) {
        const enc = await tx.encounter.create({
          data: {
            ref: await nextYearlyRef(tx, "ENC", year()),
            patientId: babyPatient.id,
            branchId: motherAdmission.branchId,
            visitTypeId: motherAdmission.encounter.visitTypeId,
            payerClass: "UNDETERMINED",
            queueStage: "ADMITTED",
            reason: `Newborn of ${ref}`,
            createdById: ctx.userId,
          },
        });
        await tx.visitQueueEvent.create({
          data: { encounterId: enc.id, fromStage: null, toStage: "ADMITTED", changedById: ctx.userId },
        });
        await tx.admission.create({
          data: {
            ref: await nextYearlyRef(tx, "ADM", year()),
            patientId: babyPatient.id,
            encounterId: enc.id,
            branchId: motherAdmission.branchId,
            reason: `Newborn rooming-in with mother (${motherAdmission.ref})`,
            admittedById: ctx.userId,
            attendingClinicianId: motherAdmission.attendingClinicianId,
          },
        });
      }
    }
    const signedAt = new Date();
    const contentHash = sha256(
      JSON.stringify([
        delivery.id,
        ep.id,
        mother.id,
        input.mode,
        births.map((b) => [
          b.birthOrder,
          b.outcome,
          b.sex,
          b.at.toISOString(),
          b.birthWeightG ?? null,
          b.apgar1 ?? null,
          b.apgar5 ?? null,
        ]),
        signedAt.toISOString(),
      ]),
    );
    await tx.deliveryRecord.update({
      where: { id: delivery.id },
      data: { status: "SIGNED", signedById: ctx.userId, signedAt, contentHash, version: { increment: 1 } },
    });
    await tx.pregnancyEpisode.update({
      where: { id: ep.id },
      data: { status: "DELIVERED", endedAt: signedAt, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.delivery.sign",
      resourceType: "DeliveryRecord",
      resourceId: delivery.id,
      patientId: mother.id,
      details: {
        ref,
        babies: births.length,
        liveBirths: babies.filter((b) => b.babyPatientId).length,
        contentHash,
      },
      meta: ctx.meta,
    });
    return { delivery: { ...delivery, ref }, babies };
  });
}

export async function recordPostnatal(
  ctx: AuthContext,
  input: z.output<typeof postnatalSchema>,
  db: DbClient = prisma,
) {
  const ep = await loadEpisode(ctx, input.episodeId, "maternity.write", db);
  if (ep.status !== "DELIVERED") throw new ConflictError("Postnatal visits follow a recorded delivery.");
  if (input.babyPatientId) {
    const nb = await db.newbornRecord.findFirst({
      where: { babyPatientId: input.babyPatientId, delivery: { episodeId: ep.id } },
    });
    if (!nb) throw new ValidationError("That baby is not from this pregnancy.");
  }
  return withTx(db, async (tx) => {
    const v = await tx.postnatalVisit.create({
      data: {
        episodeId: ep.id,
        subject: input.subject,
        babyPatientId: input.babyPatientId ?? null,
        visitDate: calendarDateToUtcMidnight(input.visitDate),
        temperatureC: input.temperatureC ?? null,
        systolicMmHg: input.systolicMmHg ?? null,
        diastolicMmHg: input.diastolicMmHg ?? null,
        weightG: input.weightG ?? null,
        feeding: input.feeding ?? null,
        findings: input.findings,
        plan: input.plan ?? null,
        recordedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.postnatal.record",
      resourceType: "PostnatalVisit",
      resourceId: v.id,
      patientId: input.babyPatientId ?? ep.patientId,
      meta: ctx.meta,
    });
    return v;
  });
}

export async function endPregnancy(
  ctx: AuthContext,
  input: z.output<typeof endPregnancySchema>,
  db: DbClient = prisma,
) {
  const ep = await loadEpisode(ctx, input.episodeId, "maternity.write", db);
  if (ep.status !== "ACTIVE") throw new ConflictError("This pregnancy is already closed.");
  await withTx(db, async (tx) => {
    await tx.pregnancyEpisode.update({
      where: { id: ep.id },
      data: { status: "ENDED", endedAt: new Date(), endReason: input.reason, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "maternity.pregnancy.end",
      resourceType: "PregnancyEpisode",
      resourceId: ep.id,
      patientId: ep.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

/** Full pregnancy record with dating history, ANC trend (flags only from approved thresholds), delivery and babies. */
export async function getPregnancy(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const ep = await loadEpisode(ctx, id, "maternity.read", db);
  const [patient, dating, anc, deliveries, postnatal, thresholds] = await Promise.all([
    db.patient.findUniqueOrThrow({
      where: { id: ep.patientId },
      select: { id: true, mrn: true, givenName: true, familyName: true, dateOfBirth: true, sexAtBirth: true },
    }),
    db.pregnancyDatingEvent.findMany({ where: { episodeId: ep.id }, orderBy: { recordedAt: "asc" } }),
    db.antenatalVisit.findMany({ where: { episodeId: ep.id }, orderBy: { visitDate: "asc" } }),
    db.deliveryRecord.findMany({
      where: { episodeId: ep.id },
      include: {
        newborns: {
          orderBy: { birthOrder: "asc" },
          include: {
            baby: { select: { id: true, mrn: true, givenName: true, familyName: true, preferredName: true } },
          },
        },
      },
    }),
    db.postnatalVisit.findMany({ where: { episodeId: ep.id }, orderBy: { visitDate: "asc" } }),
    approvedThresholds(db),
  ]);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "maternity.pregnancy.view",
    resourceType: "PregnancyEpisode",
    resourceId: ep.id,
    patientId: ep.patientId,
    meta: ctx.meta,
  });
  return {
    ep,
    patient,
    dating,
    anc: anc.map((v) => ({
      ...v,
      flags: flagVitals({ systolicMmHg: v.systolicMmHg, diastolicMmHg: v.diastolicMmHg }, thresholds),
    })),
    deliveries,
    postnatal,
    gaToday: ep.edd && ep.status === "ACTIVE" ? gestationDays(iso(ep.edd), todayLocal()) : null,
  };
}

/** Maternity board: active pregnancies in the acting branch, nearest EDD first. */
export async function maternityBoard(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = ctx.activeBranchId;
  if (!branchId) throw new ForbiddenError("Select a branch.");
  requirePermission(ctx, "maternity.read", { branchId });
  const rows = await db.pregnancyEpisode.findMany({
    where: { branchId, status: "ACTIVE" },
    orderBy: [{ edd: { sort: "asc", nulls: "last" } }],
    take: 300,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      anc: {
        where: { enteredInErrorAt: null },
        orderBy: { visitDate: "desc" },
        take: 1,
        select: { visitDate: true },
      },
    },
  });
  const today = todayLocal();
  return rows.map((r) => ({
    ...r,
    gaToday: r.edd ? gestationDays(iso(r.edd), today) : null,
    lastAnc: r.anc[0]?.visitDate ?? null,
  }));
}

export async function patientPregnancies(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  await requireMaternityAccess(ctx, patientId, "maternity.read", db);
  return db.pregnancyEpisode.findMany({ where: { patientId }, orderBy: { createdAt: "desc" } });
}

/** Babies born to this mother at the facility, and the mother of a baby. */
export async function familyLinks(patientId: string, db: DbClient = prisma) {
  const [asMother, asBaby] = await Promise.all([
    db.newbornRecord.findMany({
      where: { delivery: { motherPatientId: patientId }, babyPatientId: { not: null } },
      include: {
        baby: { select: { id: true, mrn: true, givenName: true, familyName: true, preferredName: true } },
        delivery: { select: { ref: true } },
      },
    }),
    db.newbornRecord.findUnique({
      where: { babyPatientId: patientId },
      include: { delivery: { select: { ref: true, motherPatientId: true } } },
    }),
  ]);
  const mother = asBaby
    ? await db.patient.findUnique({
        where: { id: asBaby.delivery.motherPatientId },
        select: { id: true, mrn: true, givenName: true, familyName: true },
      })
    : null;
  return { babies: asMother, mother, birth: asBaby };
}
