import type { PreauthStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { branchesWith, requirePermission, type AuthContext } from "../../authz/context";
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";
import type { preauthDecisionSchema, preauthSchema } from "@/lib/schemas/hmo";
import { reevaluateEncounterCharges, serviceDateToday } from "../billing/charges";
import { payerTariffAt, cashPriceAt } from "../billing/pricing";

/** Allowed moves. An approval is permission to provide the service - it is not a payment. */
export const PREAUTH_TRANSITIONS: Record<PreauthStatus, PreauthStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["QUERIED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "CANCELLED"],
  QUERIED: ["SUBMITTED", "CANCELLED"],
  APPROVED: ["EXPIRED", "CANCELLED"],
  PARTIALLY_APPROVED: ["EXPIRED", "CANCELLED"],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export async function createPreauth(
  ctx: AuthContext,
  input: z.output<typeof preauthSchema>,
  db: DbClient = prisma,
) {
  const enc = await db.encounter.findUnique({
    where: { id: input.encounterId },
    include: { coverage: true },
  });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "hmo.preauth.manage", { branchId: enc.branchId });
  if (!enc.coverage || enc.coverage.status !== "ACTIVE")
    throw new ConflictError("Set the visit's HMO cover before requesting pre-authorisation.");
  const coverage = enc.coverage;
  const today = serviceDateToday();
  // Requested amount uses the agreed tariff (or cash price) for transparency; nothing is invented.
  let requested = 0n;
  const items: { serviceItemId: string; orderId: string | null; quantity: number; requestedKobo: bigint }[] =
    [];
  for (const it of input.items) {
    const tariff = await payerTariffAt(db, coverage.payerId, coverage.planId, it.serviceItemId, today);
    const unit = tariff?.amountKobo ?? (await cashPriceAt(db, it.serviceItemId, today))?.amountKobo;
    if (unit === undefined || unit === null)
      throw new ValidationError("A requested service has no approved tariff or price; map it first.");
    const amount = unit * BigInt(it.quantity);
    requested += amount;
    items.push({
      serviceItemId: it.serviceItemId,
      orderId: it.orderId ?? null,
      quantity: it.quantity,
      requestedKobo: amount,
    });
  }
  return withTx(db, async (tx) => {
    const pa = await tx.preauthorization.create({
      data: {
        ref: await nextYearlyRef(tx, "PA", Number(todayLocal().slice(0, 4))),
        encounterId: enc.id,
        patientId: enc.patientId,
        coverageId: coverage.id,
        payerId: coverage.payerId,
        medicalNecessity: input.medicalNecessity,
        requestedKobo: requested,
        createdById: ctx.userId,
        items: { create: items },
        events: { create: { toStatus: "DRAFT", byId: ctx.userId } },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.preauth.create",
      resourceType: "Preauthorization",
      resourceId: pa.id,
      patientId: enc.patientId,
      details: { ref: pa.ref, items: items.length, requestedKobo: requested.toString() },
      meta: ctx.meta,
    });
    return pa;
  });
}

/**
 * Move a pre-authorisation through its workflow, recording the payer's decision (auth code, amount,
 * validity) and who recorded it. Approval re-prices the visit's open charges so they link to it.
 */
export async function transitionPreauth(
  ctx: AuthContext,
  input: z.output<typeof preauthDecisionSchema>,
  db: DbClient = prisma,
) {
  const pa = await db.preauthorization.findUnique({ where: { id: input.id }, include: { encounter: true } });
  if (!pa) throw new NotFoundError("Pre-authorisation not found.");
  requirePermission(ctx, "hmo.preauth.manage", { branchId: pa.encounter.branchId });
  if (!PREAUTH_TRANSITIONS[pa.status].includes(input.to))
    throw new InvalidTransitionError(pa.status, input.to, "pre-authorisation");
  const approving = input.to === "APPROVED" || input.to === "PARTIALLY_APPROVED";
  if (approving && !input.authCode) throw new ValidationError("Enter the payer's authorisation code.");
  if (approving && input.approvedKobo === undefined) throw new ValidationError("Enter the approved amount.");
  if (approving && BigInt(input.approvedKobo!) > pa.requestedKobo)
    throw new ValidationError("The approved amount cannot exceed the amount requested.");
  if (input.to === "PARTIALLY_APPROVED" && BigInt(input.approvedKobo!) >= pa.requestedKobo)
    throw new ValidationError("A partial approval must be less than the amount requested.");
  if (["QUERIED", "REJECTED", "CANCELLED"].includes(input.to) && !input.note)
    throw new ValidationError("Record the reason.");
  await withTx(db, async (tx) => {
    const r = await tx.preauthorization.updateMany({
      where: { id: pa.id, version: input.version, status: pa.status },
      data: {
        status: input.to,
        version: { increment: 1 },
        ...(input.to === "SUBMITTED" ? { submittedAt: new Date() } : {}),
        ...(approving
          ? {
              authCode: input.authCode!,
              approvedKobo: BigInt(input.approvedKobo!),
              validUntil: input.validUntil ? calendarDateToUtcMidnight(input.validUntil) : null,
            }
          : {}),
        ...(["APPROVED", "PARTIALLY_APPROVED", "REJECTED"].includes(input.to)
          ? { decidedAt: new Date(), decisionRecordedById: ctx.userId, decisionNote: input.note ?? null }
          : {}),
      },
    });
    if (r.count !== 1) throw new ConflictError("This request changed. Refresh and try again.", "STALE");
    await tx.preauthEvent.create({
      data: {
        preauthId: pa.id,
        fromStatus: pa.status,
        toStatus: input.to,
        note: input.note ?? null,
        byId: ctx.userId,
      },
    });
    if (approving || ["EXPIRED", "CANCELLED"].includes(input.to))
      await reevaluateEncounterCharges(tx, pa.encounterId, ctx.userId);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `hmo.preauth.${input.to.toLowerCase()}`,
      resourceType: "Preauthorization",
      resourceId: pa.id,
      patientId: pa.patientId,
      details: {
        ref: pa.ref,
        authCode: input.authCode ?? null,
        approvedKobo: input.approvedKobo?.toString() ?? null,
      },
      meta: ctx.meta,
    });
  });
}

export async function listPreauths(
  ctx: AuthContext,
  opts: { status?: PreauthStatus } = {},
  db: DbClient = prisma,
) {
  const b = branchesWith(ctx, "hmo.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "hmo.read");
  return db.preauthorization.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(b === "ALL" ? {} : { encounter: { branchId: { in: b } } }),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      payer: { select: { name: true } },
      encounter: {
        select: {
          ref: true,
          patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
        },
      },
    },
  });
}

export async function getPreauth(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const pa = await db.preauthorization.findUnique({
    where: { id },
    include: {
      payer: { select: { name: true } },
      coverage: { select: { memberNumber: true, plan: { select: { name: true } } } },
      encounter: {
        select: {
          id: true,
          ref: true,
          branchId: true,
          patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
        },
      },
      items: true,
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!pa) throw new NotFoundError("Pre-authorisation not found.");
  requirePermission(ctx, "hmo.read", { branchId: pa.encounter.branchId });
  const services = await db.serviceItem.findMany({
    where: { id: { in: pa.items.map((i) => i.serviceItemId) } },
  });
  return {
    ...pa,
    items: pa.items.map((i) => ({ ...i, service: services.find((s) => s.id === i.serviceItemId)! })),
  };
}
