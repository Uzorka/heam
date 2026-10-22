import type { Charge, ChargeSource, Encounter, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, canAny, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";
import type { adjustmentSchema, manualChargeSchema } from "@/lib/schemas/billing";
import { decideCoverage, type CoverageResult } from "./pricing";
import { ACCOUNTS, postJournal } from "./ledger";

export const serviceDateToday = () => calendarDateToUtcMidnight(todayLocal());

type EncounterLike = Pick<Encounter, "id" | "patientId" | "branchId" | "payerClass" | "coverageId">;

/** The OPEN invoice for a visit, created on first charge. Finalised invoices are never reopened. */
export async function ensureOpenInvoice(tx: Tx, enc: Pick<Encounter, "id" | "patientId" | "branchId">) {
  const open = await tx.invoice.findFirst({ where: { encounterId: enc.id, status: "OPEN" } });
  if (open) return open;
  return tx.invoice.create({
    data: {
      ref: await nextYearlyRef(tx, "INV", Number(todayLocal().slice(0, 4))),
      encounterId: enc.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
    },
  });
}

function recognitionLines(
  c: Pick<Charge, "patientPortionKobo" | "payerPortionKobo" | "totalKobo" | "payerId" | "patientId">,
) {
  return [
    { account: ACCOUNTS.PATIENT_RECEIVABLE, debit: c.patientPortionKobo ?? 0n, patientId: c.patientId },
    { account: ACCOUNTS.PAYER_RECEIVABLE, debit: c.payerPortionKobo, payerId: c.payerId },
    { account: ACCOUNTS.SERVICE_REVENUE, credit: c.totalKobo ?? 0n },
  ];
}
const reversed = (lines: ReturnType<typeof recognitionLines>) =>
  lines.map((l) => ({
    ...l,
    debit: "credit" in l ? l.credit : undefined,
    credit: "debit" in l ? l.debit : undefined,
  }));

async function postRecognition(tx: Tx, c: Charge, userId: string) {
  if (c.totalKobo === null || c.totalKobo === 0n) return;
  await postJournal(tx, {
    branchId: c.branchId,
    sourceType: "Charge",
    sourceId: c.id,
    kind: `recognise:v${c.version}`,
    description: c.description,
    lines: recognitionLines(c),
    userId,
  });
}

async function postReversal(tx: Tx, c: Charge, userId: string, why: string) {
  if (c.totalKobo === null || c.totalKobo === 0n) return;
  await postJournal(tx, {
    branchId: c.branchId,
    sourceType: "Charge",
    sourceId: c.id,
    kind: `reverse:v${c.version}`,
    description: `${why}: ${c.description}`,
    lines: reversed(recognitionLines(c)),
    userId,
  });
}

const splitData = (r: CoverageResult) => ({
  unitPriceKobo: r.unitPriceKobo,
  totalKobo: r.totalKobo,
  payerPortionKobo: r.payerPortionKobo,
  patientPortionKobo: r.patientPortionKobo,
  decision: r.decision,
  decisionNote: r.note,
  needsResolution: r.needsResolution,
  coverageId: r.coverageId,
  payerId: r.payerId,
  preauthRequired: r.preauthRequired,
  preauthId: r.preauthId,
});

/**
 * Create a charge for a billable event inside the caller's transaction. Idempotent per
 * (sourceType, sourceId): a retried event returns the existing charge.
 */
export async function createCharge(
  tx: Tx,
  input: {
    enc: EncounterLike;
    serviceItemId: string;
    description: string;
    quantity: number;
    sourceType: ChargeSource;
    sourceId: string;
    userId: string;
    serviceDate?: Date;
  },
) {
  const existing = await tx.charge.findUnique({
    where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
  });
  if (existing) return existing;
  const serviceDate = input.serviceDate ?? serviceDateToday();
  const split = await decideCoverage(tx, input.enc, input.serviceItemId, serviceDate, input.quantity);
  const invoice = await ensureOpenInvoice(tx, input.enc);
  const charge = await tx.charge.create({
    data: {
      encounterId: input.enc.id,
      patientId: input.enc.patientId,
      branchId: input.enc.branchId,
      invoiceId: invoice.id,
      serviceItemId: input.serviceItemId,
      description: input.description,
      quantity: input.quantity,
      serviceDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdById: input.userId,
      ...splitData(split),
    },
  });
  await postRecognition(tx, charge, input.userId);
  return charge;
}

/** Automatic charge for a clinical order, when its test/study is mapped to a service item. */
export async function chargeForOrder(
  tx: Tx,
  order: {
    id: string;
    encounterId: string;
    labTestId: string | null;
    imagingStudyId: string | null;
    description: string;
  },
  userId: string,
) {
  const item = order.labTestId
    ? await tx.serviceItem.findUnique({ where: { labTestId: order.labTestId } })
    : order.imagingStudyId
      ? await tx.serviceItem.findUnique({ where: { imagingStudyId: order.imagingStudyId } })
      : null;
  if (!item?.active) return null;
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: order.encounterId } });
  return createCharge(tx, {
    enc,
    serviceItemId: item.id,
    description: item.name,
    quantity: 1,
    sourceType: "ORDER",
    sourceId: order.id,
    userId,
  });
}

/** Consultation/visit charge at check-in, when the visit type is mapped to a service item. */
export async function chargeForVisit(tx: Tx, enc: EncounterLike & { visitTypeId: string }, userId: string) {
  const item = await tx.serviceItem.findUnique({ where: { visitTypeId: enc.visitTypeId } });
  if (!item?.active) return null;
  return createCharge(tx, {
    enc,
    serviceItemId: item.id,
    description: item.name,
    quantity: 1,
    sourceType: "VISIT",
    sourceId: enc.id,
    userId,
  });
}

/** Charge for one dispense event (one lot), when the medicine is mapped to a service item. */
export async function chargeForDispense(
  tx: Tx,
  ev: { id: string; quantity: number },
  rx: { encounterId: string },
  inventoryProductId: string,
  userId: string,
) {
  const item = await tx.serviceItem.findUnique({ where: { inventoryProductId } });
  if (!item?.active) return null;
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: rx.encounterId } });
  return createCharge(tx, {
    enc,
    serviceItemId: item.id,
    description: item.name,
    quantity: ev.quantity,
    sourceType: "DISPENSE",
    sourceId: ev.id,
    userId,
  });
}

/**
 * Void the charge of a source event (order cancelled, dispense reversed). Refuses when the charge
 * is already on a finalised invoice or a live claim - those need an explicit financial correction.
 */
export async function voidChargeForSource(
  tx: Tx,
  sourceType: ChargeSource,
  sourceId: string,
  reason: string,
  userId: string,
) {
  const c = await tx.charge.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    include: { invoice: true, claimLines: { where: { removedAt: null } } },
  });
  if (!c || c.status === "VOID") return null;
  if (c.invoice?.status === "FINALISED")
    throw new ConflictError(
      "The charge for this item is on a finalised invoice. Ask billing to issue a credit note first.",
      "CHARGE_FINALISED",
    );
  if (c.claimLines.length)
    throw new ConflictError("The charge for this item is on an HMO claim.", "CHARGE_CLAIMED");
  const r = await tx.charge.updateMany({
    where: { id: c.id, version: c.version, status: "ACTIVE" },
    data: { status: "VOID", voidReason: reason, voidedAt: new Date(), voidedById: userId },
  });
  if (r.count !== 1) throw new ConflictError("The charge changed. Try again.", "STALE");
  await postReversal(tx, c, userId, "Voided");
  return c;
}

// ───────────── Staff actions on charges and invoices ─────────────

async function loadCharge(ctx: AuthContext, chargeId: string, db: DbClient) {
  const c = await db.charge.findUnique({
    where: { id: chargeId },
    include: { invoice: true, claimLines: { where: { removedAt: null } } },
  });
  if (!c) throw new NotFoundError("Charge not found.");
  if (!canAny(ctx, ["billing.read", "hmo.read"], { branchId: c.branchId }))
    throw new NotFoundError("Charge not found.");
  return c;
}

/**
 * Re-run the coverage decision for a charge (after a tariff is mapped, coverage is corrected or a
 * pre-authorisation is approved). Only while the invoice is open and the charge is not claimed.
 */
export async function reevaluateCharge(ctx: AuthContext, chargeId: string, db: DbClient = prisma) {
  const c = await loadCharge(ctx, chargeId, db);
  if (!canAny(ctx, ["hmo.coverage.manage", "billing.invoice.manage"], { branchId: c.branchId }))
    throw new ForbiddenError(undefined, "hmo.coverage.manage");
  return withTx(db, (tx) => reevaluateInTx(tx, c.id, ctx.userId, ctx));
}

export async function reevaluateInTx(tx: Tx, chargeId: string, userId: string, ctx?: AuthContext) {
  const c = await tx.charge.findUniqueOrThrow({
    where: { id: chargeId },
    include: { invoice: true, claimLines: { where: { removedAt: null } } },
  });
  if (c.status !== "ACTIVE" || c.invoice?.status !== "OPEN" || c.claimLines.length) return c;
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: c.encounterId } });
  const split = await decideCoverage(tx, enc, c.serviceItemId, c.serviceDate, c.quantity);
  const same =
    split.totalKobo === c.totalKobo &&
    split.payerPortionKobo === c.payerPortionKobo &&
    split.patientPortionKobo === c.patientPortionKobo &&
    split.decision === c.decision &&
    split.preauthId === c.preauthId &&
    split.needsResolution === c.needsResolution;
  if (same) return c;
  await postReversal(tx, c, userId, "Re-priced");
  const updated = await tx.charge.update({
    where: { id: c.id, version: c.version },
    data: { ...splitData(split), version: { increment: 1 } },
  });
  await postRecognition(tx, updated, userId);
  if (ctx)
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: userId,
      action: "billing.charge.reevaluate",
      resourceType: "Charge",
      resourceId: c.id,
      patientId: c.patientId,
      details: { from: c.decision, to: split.decision },
      meta: ctx.meta,
    });
  return updated;
}

/** Re-evaluate every open, unclaimed charge on a visit (e.g. after coverage or pre-auth changes). */
export async function reevaluateEncounterCharges(tx: Tx, encounterId: string, userId: string) {
  const charges = await tx.charge.findMany({
    where: { encounterId, status: "ACTIVE", invoice: { status: "OPEN" } },
    select: { id: true },
  });
  for (const c of charges) await reevaluateInTx(tx, c.id, userId);
}

/**
 * Resolve an unmapped-tariff or unpriced charge by confirming the patient pays: either the cash
 * price (if one exists) or an explicit amount entered by billing with a reason.
 */
export async function resolveAsPatientPay(
  ctx: AuthContext,
  input: { chargeId: string; note: string; unitPriceKobo?: number },
  db: DbClient = prisma,
) {
  const c = await loadCharge(ctx, input.chargeId, db);
  if (!canAny(ctx, ["hmo.coverage.manage", "billing.invoice.manage"], { branchId: c.branchId }))
    throw new ForbiddenError(undefined, "hmo.coverage.manage");
  if (!c.needsResolution || c.status !== "ACTIVE")
    throw new ConflictError("This charge does not need resolution.");
  if (c.invoice?.status !== "OPEN") throw new ConflictError("The invoice is no longer open.");
  const unit = c.unitPriceKobo ?? (input.unitPriceKobo !== undefined ? BigInt(input.unitPriceKobo) : null);
  if (unit === null) throw new ValidationError("Enter the price to charge (no approved cash price exists).");
  if (c.unitPriceKobo === null && !can(ctx, "billing.invoice.manage", { branchId: c.branchId }))
    throw new ForbiddenError(
      "Only billing staff can set a price for an unpriced service.",
      "billing.invoice.manage",
    );
  return withTx(db, async (tx) => {
    await postReversal(tx, c, ctx.userId, "Resolved");
    const total = unit * BigInt(c.quantity);
    const updated = await tx.charge.update({
      where: { id: c.id, version: c.version },
      data: {
        unitPriceKobo: unit,
        totalKobo: total,
        payerPortionKobo: 0n,
        patientPortionKobo: total,
        decision: "RESOLVED_PATIENT_PAY",
        decisionNote: `Patient pay confirmed: ${input.note}`,
        needsResolution: false,
        version: { increment: 1 },
      },
    });
    await postRecognition(tx, updated, ctx.userId);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.charge.resolve_patient_pay",
      resourceType: "Charge",
      resourceId: c.id,
      patientId: c.patientId,
      details: { previous: c.decision, unitPriceKobo: unit.toString(), note: input.note },
      meta: ctx.meta,
    });
    return updated;
  });
}

export async function addManualCharge(
  ctx: AuthContext,
  input: z.output<typeof manualChargeSchema>,
  db: DbClient = prisma,
) {
  const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "billing.invoice.manage", { branchId: enc.branchId });
  const item = await db.serviceItem.findUnique({ where: { id: input.serviceItemId } });
  if (!item?.active) throw new ValidationError("Choose an active service.");
  return withTx(db, async (tx) => {
    const c = await createCharge(tx, {
      enc,
      serviceItemId: item.id,
      description: input.note ? `${item.name} - ${input.note}` : item.name,
      quantity: input.quantity,
      sourceType: "MANUAL",
      sourceId: input.idempotencyKey,
      userId: ctx.userId,
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.charge.manual",
      resourceType: "Charge",
      resourceId: c.id,
      patientId: enc.patientId,
      details: { service: item.code, quantity: input.quantity },
      meta: ctx.meta,
    });
    return c;
  });
}

export async function voidManualCharge(
  ctx: AuthContext,
  input: { chargeId: string; reason: string },
  db: DbClient = prisma,
) {
  const c = await loadCharge(ctx, input.chargeId, db);
  requirePermission(ctx, "billing.invoice.manage", { branchId: c.branchId });
  if (c.sourceType !== "MANUAL")
    throw new ConflictError(
      "Automatic charges follow their clinical source (cancel the order or reverse the dispense).",
    );
  await withTx(db, async (tx) => {
    await voidChargeForSource(tx, "MANUAL", c.sourceId, input.reason, ctx.userId);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.charge.void",
      resourceType: "Charge",
      resourceId: c.id,
      patientId: c.patientId,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

// ───────────── Invoice totals, finalisation, adjustments ─────────────

export interface InvoiceTotals {
  patientTotal: bigint;
  payerTotal: bigint;
  grossTotal: bigint;
  adjustments: bigint;
  paid: bigint;
  outstanding: bigint;
  unresolved: number;
}

export async function invoiceTotals(db: DbClient, invoiceId: string): Promise<InvoiceTotals> {
  const [charges, adj, alloc, unresolved] = await Promise.all([
    db.charge.aggregate({
      where: { invoiceId, status: "ACTIVE" },
      _sum: { patientPortionKobo: true, payerPortionKobo: true, totalKobo: true },
    }),
    db.invoiceAdjustment.aggregate({ where: { invoiceId, status: "APPROVED" }, _sum: { amountKobo: true } }),
    db.paymentAllocation.aggregate({ where: { invoiceId }, _sum: { amountKobo: true } }),
    db.charge.count({ where: { invoiceId, status: "ACTIVE", needsResolution: true } }),
  ]);
  const patientTotal = charges._sum.patientPortionKobo ?? 0n;
  const adjustments = adj._sum.amountKobo ?? 0n;
  const paid = alloc._sum.amountKobo ?? 0n;
  return {
    patientTotal,
    payerTotal: charges._sum.payerPortionKobo ?? 0n,
    grossTotal: charges._sum.totalKobo ?? 0n,
    adjustments,
    paid,
    outstanding: patientTotal - adjustments - paid,
    unresolved,
  };
}

export async function finaliseInvoice(
  ctx: AuthContext,
  input: { invoiceId: string; version: number },
  db: DbClient = prisma,
) {
  const inv = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv) throw new NotFoundError("Invoice not found.");
  if (!canAny(ctx, ["billing.invoice.manage", "billing.payment.collect"], { branchId: inv.branchId }))
    throw new ForbiddenError(undefined, "billing.invoice.manage");
  if (inv.status !== "OPEN") throw new ConflictError("Only open invoices can be finalised.");
  const totals = await invoiceTotals(db, inv.id);
  if (totals.unresolved > 0)
    throw new ConflictError(
      `${totals.unresolved} charge(s) need pricing or HMO resolution before finalising.`,
      "UNRESOLVED",
    );
  await withTx(db, async (tx) => {
    const r = await tx.invoice.updateMany({
      where: { id: inv.id, version: input.version, status: "OPEN" },
      data: {
        status: "FINALISED",
        finalisedAt: new Date(),
        finalisedById: ctx.userId,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("The invoice changed. Refresh and try again.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.invoice.finalise",
      resourceType: "Invoice",
      resourceId: inv.id,
      patientId: inv.patientId,
      details: {
        ref: inv.ref,
        patientTotal: totals.patientTotal.toString(),
        payerTotal: totals.payerTotal.toString(),
      },
      meta: ctx.meta,
    });
  });
}

const ADJUSTMENT_APPROVER = {
  DISCOUNT: "billing.discount.approve",
  CREDIT_NOTE: "billing.refund.approve",
  WRITE_OFF: "billing.refund.approve",
} as const;

export async function requestAdjustment(
  ctx: AuthContext,
  input: z.output<typeof adjustmentSchema>,
  db: DbClient = prisma,
) {
  const inv = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv) throw new NotFoundError("Invoice not found.");
  if (!canAny(ctx, ["billing.payment.collect", "billing.invoice.manage"], { branchId: inv.branchId }))
    throw new ForbiddenError(undefined, "billing.invoice.manage");
  if (inv.status === "VOID") throw new ConflictError("This invoice is void.");
  const totals = await invoiceTotals(db, inv.id);
  const pending = await db.invoiceAdjustment.aggregate({
    where: { invoiceId: inv.id, status: "PENDING" },
    _sum: { amountKobo: true },
  });
  if (BigInt(input.amountKobo) + (pending._sum.amountKobo ?? 0n) > totals.outstanding)
    throw new ValidationError("The adjustment would make the invoice negative.");
  return withTx(db, async (tx) => {
    const a = await tx.invoiceAdjustment.create({
      data: {
        invoiceId: inv.id,
        type: input.type,
        amountKobo: BigInt(input.amountKobo),
        reason: input.reason,
        requestedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.adjustment.request",
      resourceType: "InvoiceAdjustment",
      resourceId: a.id,
      patientId: inv.patientId,
      details: { type: input.type, amountKobo: String(input.amountKobo), invoice: inv.ref },
      meta: ctx.meta,
    });
    return a;
  });
}

export async function decideAdjustment(
  ctx: AuthContext,
  input: { id: string; decision: "APPROVE" | "REJECT"; note?: string },
  db: DbClient = prisma,
) {
  const a = await db.invoiceAdjustment.findUnique({ where: { id: input.id }, include: { invoice: true } });
  if (!a) throw new NotFoundError("Adjustment not found.");
  const permission = ADJUSTMENT_APPROVER[a.type];
  requirePermission(ctx, permission, { branchId: a.invoice.branchId });
  if (a.status !== "PENDING") throw new ConflictError("Already decided.");
  if (a.requestedById === ctx.userId)
    throw new ForbiddenError("Adjustments must be approved by someone other than the requester.", permission);
  await withTx(db, async (tx) => {
    if (input.decision === "APPROVE") {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${a.invoiceId}::uuid FOR UPDATE`;
      const totals = await invoiceTotals(tx, a.invoiceId);
      if (a.amountKobo > totals.outstanding)
        throw new ConflictError("The adjustment now exceeds the outstanding balance.");
    }
    const r = await tx.invoiceAdjustment.updateMany({
      where: { id: a.id, status: "PENDING" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });
    if (r.count !== 1) throw new ConflictError("Already decided.", "STALE");
    if (input.decision === "APPROVE")
      await postJournal(tx, {
        branchId: a.invoice.branchId,
        sourceType: "InvoiceAdjustment",
        sourceId: a.id,
        kind: "approve",
        description: `${a.type.toLowerCase().replace("_", " ")} on ${a.invoice.ref}`,
        lines: [
          { account: ACCOUNTS.DISCOUNTS, debit: a.amountKobo },
          { account: ACCOUNTS.PATIENT_RECEIVABLE, credit: a.amountKobo, patientId: a.invoice.patientId },
        ],
        userId: ctx.userId,
      });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "billing.adjustment.approve" : "billing.adjustment.reject",
      resourceType: "InvoiceAdjustment",
      resourceId: a.id,
      patientId: a.invoice.patientId,
      details: { type: a.type, amountKobo: a.amountKobo.toString() },
      meta: ctx.meta,
    });
  });
}

export const chargeInclude = {
  serviceItem: { select: { code: true, name: true, category: true } },
  payer: { select: { name: true } },
} satisfies Prisma.ChargeInclude;
