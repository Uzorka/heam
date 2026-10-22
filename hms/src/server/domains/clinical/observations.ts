import { Prisma, type VitalThreshold } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import type { markErrorSchema, triageSchema, vitalsSchema } from "@/lib/schemas/clinical";
import type { approveRuleSchema, vitalThresholdSchema } from "@/lib/schemas/lab";
import { careRoleFor, getEncounterAccess, joinCareTeam, loadEncounterFor } from "./access";
import { flagVitals, type ThresholdLike } from "./vital-flags";

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d.toString()));

export async function recordVitals(ctx: AuthContext, input: z.output<typeof vitalsSchema>, db: DbClient = prisma) {
  const { enc } = await loadEncounterFor(ctx, input.encounterId, "clinical.vitals.record", { requireOpen: true }, db);
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : new Date();
  if (measuredAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("Measurement time cannot be in the future.");
  if (measuredAt < enc.arrivedAt && enc.arrivedAt.getTime() - measuredAt.getTime() > 60 * 60_000) {
    throw new ValidationError("Measurement time is before this visit started.");
  }
  return withTx(db, async (tx) => {
    const v = await tx.vitalSign.create({
      data: {
        encounterId: enc.id,
        patientId: enc.patientId,
        measuredAt,
        recordedById: ctx.userId,
        temperatureC: input.temperatureC,
        pulseBpm: input.pulseBpm,
        respRatePerMin: input.respRatePerMin,
        systolicMmHg: input.systolicMmHg,
        diastolicMmHg: input.diastolicMmHg,
        spo2Pct: input.spo2Pct,
        weightKg: input.weightKg,
        heightCm: input.heightCm,
        painScore: input.painScore,
        notes: input.notes,
      },
    });
    await joinCareTeam(tx, enc, ctx.userId, careRoleFor(ctx));
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.vitals.record",
      resourceType: "VitalSign",
      resourceId: v.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
      meta: ctx.meta,
    });
    return v;
  });
}

export async function markVitalsInError(ctx: AuthContext, input: z.output<typeof markErrorSchema>, db: DbClient = prisma) {
  const v = await db.vitalSign.findUnique({ where: { id: input.id }, include: { encounter: true } });
  if (!v || !v.encounter) throw new NotFoundError();
  requirePermission(ctx, "clinical.vitals.record", { branchId: v.encounter.branchId });
  if (v.recordedById !== ctx.userId) {
    const access = await getEncounterAccess(ctx, v.encounter, db);
    if (access?.level !== "FULL") throw new ForbiddenError("Only the person who recorded it, or a clinician caring for the patient, can mark it in error.");
  }
  if (v.enteredInErrorAt) throw new ConflictError("Already marked as entered in error.");
  await withTx(db, async (tx) => {
    await tx.vitalSign.update({ where: { id: v.id }, data: { enteredInErrorAt: new Date(), enteredInErrorById: ctx.userId, errorReason: input.reason } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.vitals.entered_in_error",
      resourceType: "VitalSign",
      resourceId: v.id,
      patientId: v.patientId,
      meta: ctx.meta,
    });
  });
}

export async function recordTriage(ctx: AuthContext, input: z.output<typeof triageSchema>, db: DbClient = prisma) {
  const { enc } = await loadEncounterFor(ctx, input.encounterId, "clinical.triage.record", { requireOpen: true }, db);
  return withTx(db, async (tx) => {
    const t = await tx.triageRecord.create({
      data: { encounterId: enc.id, patientId: enc.patientId, chiefComplaint: input.chiefComplaint, acuity: input.acuity, notes: input.notes, recordedById: ctx.userId },
    });
    await joinCareTeam(tx, enc, ctx.userId, careRoleFor(ctx));
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.triage.record",
      resourceType: "TriageRecord",
      resourceId: t.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
      details: { acuity: input.acuity },
      meta: ctx.meta,
    });
    return t;
  });
}

// ───────────── Thresholds (clinical content: draft -> approved by a clinician) ─────────────

export function toThresholdLike(t: VitalThreshold): ThresholdLike {
  return { parameter: t.parameter, low: num(t.low), high: num(t.high), criticalLow: num(t.criticalLow), criticalHigh: num(t.criticalHigh) };
}

export async function approvedThresholds(db: DbClient = prisma) {
  return (await db.vitalThreshold.findMany({ where: { status: "APPROVED" } })).map(toThresholdLike);
}

export async function proposeVitalThreshold(ctx: AuthContext, input: z.output<typeof vitalThresholdSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "lab.catalogue.manage");
  return withTx(db, async (tx) => {
    const t = await tx.vitalThreshold.create({
      data: { parameter: input.parameter, low: input.low, high: input.high, criticalLow: input.criticalLow, criticalHigh: input.criticalHigh, source: input.source, createdById: ctx.userId },
    });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "clinical.threshold.propose", resourceType: "VitalThreshold", resourceId: t.id, details: { parameter: t.parameter }, meta: ctx.meta });
    return t;
  });
}

export async function decideVitalThreshold(ctx: AuthContext, input: z.output<typeof approveRuleSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "clinical.rules.approve");
  const t = await db.vitalThreshold.findUnique({ where: { id: input.id } });
  if (!t) throw new NotFoundError();
  if (input.decision === "APPROVE" && t.status !== "DRAFT") throw new ConflictError("Only drafts can be approved.");
  if (input.decision === "APPROVE" && t.createdById === ctx.userId) throw new ForbiddenError("Clinical content must be approved by someone other than its author.");
  await withTx(db, async (tx) => {
    if (input.decision === "APPROVE") {
      await tx.vitalThreshold.updateMany({ where: { parameter: t.parameter, status: "APPROVED" }, data: { status: "RETIRED" } });
      await tx.vitalThreshold.update({ where: { id: t.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    } else {
      await tx.vitalThreshold.update({ where: { id: t.id }, data: { status: "RETIRED" } });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "clinical.threshold.approve" : "clinical.threshold.retire",
      resourceType: "VitalThreshold",
      resourceId: t.id,
      details: { parameter: t.parameter },
      meta: ctx.meta,
    });
  });
}

export function vitalsView<T extends { temperatureC: Prisma.Decimal | null; weightKg: Prisma.Decimal | null; heightCm: Prisma.Decimal | null; pulseBpm: number | null; respRatePerMin: number | null; systolicMmHg: number | null; diastolicMmHg: number | null; spo2Pct: number | null; painScore: number | null }>(
  v: T,
  thresholds: ThresholdLike[],
) {
  const values = {
    temperatureC: num(v.temperatureC),
    pulseBpm: v.pulseBpm,
    respRatePerMin: v.respRatePerMin,
    systolicMmHg: v.systolicMmHg,
    diastolicMmHg: v.diastolicMmHg,
    spo2Pct: v.spo2Pct,
    weightKg: num(v.weightKg),
    heightCm: num(v.heightCm),
    painScore: v.painScore,
  };
  return { values, flags: flagVitals(values, thresholds) };
}
