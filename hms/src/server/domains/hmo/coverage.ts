import type { EligibilityOutcome, EligibilityStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, canAny, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { logger } from "../../logger";
import { calendarDateToUtcMidnight } from "@/lib/time";
import type {
  coverageSchema,
  encounterPayerSchema,
  endCoverageSchema,
  manualEligibilitySchema,
} from "@/lib/schemas/hmo";
import { reevaluateEncounterCharges } from "../billing/charges";

export async function patientCoverages(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  if (!canAny(ctx, ["hmo.read", "patient.read"])) throw new ForbiddenError(undefined, "hmo.read");
  return db.patientCoverage.findMany({
    where: { patientId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      payer: { select: { id: true, name: true, status: true } },
      plan: { select: { id: true, name: true, status: true, copayBasisPoints: true } },
      checks: { orderBy: { checkedAt: "desc" }, take: 5 },
    },
  });
}

export async function enrolCoverage(
  ctx: AuthContext,
  input: z.output<typeof coverageSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.coverage.manage");
  const plan = await db.payerPlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new NotFoundError("Plan not found.");
  if (input.validTo && input.validTo <= input.validFrom)
    throw new ValidationError("Cover must end after it starts.");
  const dup = await db.patientCoverage.findFirst({
    where: {
      patientId: input.patientId,
      planId: plan.id,
      memberNumber: input.memberNumber,
      status: "ACTIVE",
    },
  });
  if (dup) throw new ConflictError("This membership is already recorded for the patient.");
  return withTx(db, async (tx) => {
    const c = await tx.patientCoverage.create({
      data: {
        patientId: input.patientId,
        payerId: plan.payerId,
        planId: plan.id,
        memberNumber: input.memberNumber,
        relationship: input.relationship,
        principalName: input.principalName ?? null,
        sponsor: input.sponsor ?? null,
        validFrom: calendarDateToUtcMidnight(input.validFrom),
        validTo: input.validTo ? calendarDateToUtcMidnight(input.validTo) : null,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.coverage.enrol",
      resourceType: "PatientCoverage",
      resourceId: c.id,
      patientId: input.patientId,
      details: { plan: plan.code },
      meta: ctx.meta,
    });
    return c;
  });
}

export async function endCoverage(
  ctx: AuthContext,
  input: z.output<typeof endCoverageSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.coverage.manage");
  const c = await db.patientCoverage.findUnique({ where: { id: input.coverageId } });
  if (!c) throw new NotFoundError("Coverage not found.");
  if (c.status !== "ACTIVE") throw new ConflictError("Already ended.");
  await withTx(db, async (tx) => {
    await tx.patientCoverage.update({
      where: { id: c.id },
      data: { status: "ENDED", endedAt: new Date(), endReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.coverage.end",
      resourceType: "PatientCoverage",
      resourceId: c.id,
      patientId: c.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

const STATUS_FOR: Record<EligibilityOutcome, (online: boolean) => EligibilityStatus> = {
  ELIGIBLE: (online) => (online ? "VERIFIED_ONLINE" : "VERIFIED_MANUAL"),
  NOT_ELIGIBLE: () => "NOT_ELIGIBLE",
  UNREACHABLE: () => "CHECK_FAILED",
  ERROR: () => "CHECK_FAILED",
};

/** A staff member records what the payer said by phone, portal or email, with evidence. */
export async function recordManualEligibility(
  ctx: AuthContext,
  input: z.output<typeof manualEligibilitySchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.eligibility.record");
  const c = await db.patientCoverage.findUnique({ where: { id: input.coverageId } });
  if (!c) throw new NotFoundError("Coverage not found.");
  if (input.outcome === "ELIGIBLE" && !input.reference)
    throw new ValidationError("Enter the payer's confirmation reference for an eligible result.");
  return withTx(db, async (tx) => {
    const check = await tx.eligibilityCheck.create({
      data: {
        coverageId: c.id,
        method: input.method,
        outcome: input.outcome,
        reference: input.reference ?? null,
        evidence: input.evidence,
        checkedById: ctx.userId,
      },
    });
    await tx.patientCoverage.update({
      where: { id: c.id },
      data: { eligibilityStatus: STATUS_FOR[input.outcome](false), lastCheckedAt: check.checkedAt },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.eligibility.manual",
      resourceType: "PatientCoverage",
      resourceId: c.id,
      patientId: c.patientId,
      details: { method: input.method, outcome: input.outcome },
      meta: ctx.meta,
    });
    return check;
  });
}

// ───────────── Payer connectors ─────────────

export interface EligibilityConnector {
  name: string;
  check(input: {
    memberNumber: string;
    providerCode: string | null;
  }): Promise<{ eligible: boolean; reference: string }>;
}

/**
 * Connector registry, keyed by payer code. Empty by default: no payer API is integrated until the
 * hospital has credentials, an agreement and a tested adapter.
 */
export const eligibilityConnectors = new Map<string, EligibilityConnector>();

/**
 * Online eligibility check. Any missing connector, credential error, timeout or malformed reply is
 * recorded as ERROR / CHECK_FAILED - never as verified.
 */
export async function runConnectorEligibility(ctx: AuthContext, coverageId: string, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.eligibility.record");
  const c = await db.patientCoverage.findUnique({ where: { id: coverageId }, include: { payer: true } });
  if (!c) throw new NotFoundError("Coverage not found.");
  const connector = eligibilityConnectors.get(c.payer.code);
  let outcome: EligibilityOutcome = "ERROR";
  let reference: string | null = null;
  let errorCode: string | null = null;
  if (!connector) {
    errorCode = "CONNECTOR_NOT_CONFIGURED";
  } else {
    try {
      const r = await connector.check({ memberNumber: c.memberNumber, providerCode: c.payer.providerCode });
      if (typeof r?.eligible !== "boolean" || !r.reference) {
        errorCode = "MALFORMED_RESPONSE";
      } else {
        outcome = r.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE";
        reference = r.reference;
      }
    } catch (e) {
      errorCode =
        e instanceof Error && /auth|credential|401|403/i.test(e.message) ? "AUTH_FAILED" : "CONNECTOR_ERROR";
      logger.warn("eligibility_connector_failed", { payer: c.payer.code, errorCode });
    }
  }
  return withTx(db, async (tx) => {
    const check = await tx.eligibilityCheck.create({
      data: {
        coverageId: c.id,
        method: "CONNECTOR",
        outcome,
        reference,
        errorCode,
        evidence: connector ? `Connector ${connector.name}` : null,
        checkedById: ctx.userId,
      },
    });
    await tx.patientCoverage.update({
      where: { id: c.id },
      data: { eligibilityStatus: STATUS_FOR[outcome](true), lastCheckedAt: check.checkedAt },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.eligibility.connector",
      resourceType: "PatientCoverage",
      resourceId: c.id,
      patientId: c.patientId,
      outcome: outcome === "ERROR" ? "FAILURE" : "SUCCESS",
      details: { outcome, errorCode },
      meta: ctx.meta,
    });
    return check;
  });
}

/**
 * Set how a visit is paid for. Insured classes need an active coverage of the patient; open
 * charges are re-priced in the same transaction so the bill always matches the visit's payer.
 */
export async function setEncounterPayer(
  ctx: AuthContext,
  input: z.output<typeof encounterPayerSchema>,
  db: DbClient = prisma,
) {
  const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  if (!canAny(ctx, ["hmo.coverage.manage", "queue.manage"], { branchId: enc.branchId }))
    throw new ForbiddenError(undefined, "hmo.coverage.manage");
  let coverageId: string | null = null;
  if (input.payerClass !== "CASH") {
    if (!input.coverageId) throw new ValidationError("Choose the patient's cover for an insured visit.");
    const c = await db.patientCoverage.findUnique({ where: { id: input.coverageId } });
    if (!c || c.patientId !== enc.patientId)
      throw new ValidationError("That cover does not belong to this patient.");
    if (c.status !== "ACTIVE") throw new ConflictError("That cover has ended.");
    coverageId = c.id;
  }
  await withTx(db, async (tx) => {
    const r = await tx.encounter.updateMany({
      where: { id: enc.id, version: enc.version },
      data: { payerClass: input.payerClass, coverageId, version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictError("The visit changed. Refresh and try again.", "STALE");
    await reevaluateEncounterCharges(tx, enc.id, ctx.userId);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.encounter.payer",
      resourceType: "Encounter",
      resourceId: enc.id,
      patientId: enc.patientId,
      details: { from: enc.payerClass, to: input.payerClass, coverageId },
      meta: ctx.meta,
    });
  });
}

export const canSeeCoverage = (ctx: AuthContext) => can(ctx, "hmo.read") || can(ctx, "patient.read");
