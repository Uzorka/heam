import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentMethod } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import {
  branchesWith,
  can,
  requireActingBranch,
  requirePermission,
  type AuthContext,
} from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { sha256 } from "../../crypto";
import { env } from "../../env";
import { logger } from "../../logger";
import { todayLocal, localDayRange } from "@/lib/time";
import type {
  closeShiftSchema,
  openShiftSchema,
  recordPaymentSchema,
  refundRequestSchema,
  reversePaymentSchema,
} from "@/lib/schemas/billing";
import { ACCOUNTS, METHOD_ACCOUNT, postJournal } from "./ledger";
import { invoiceTotals } from "./charges";

const year = () => Number(todayLocal().slice(0, 4));

// ───────────── Cashier shifts ─────────────

export async function currentShift(db: DbClient, userId: string) {
  return db.cashierShift.findFirst({ where: { cashierId: userId, status: "OPEN" } });
}

export async function openShift(
  ctx: AuthContext,
  input: z.output<typeof openShiftSchema>,
  db: DbClient = prisma,
) {
  const branchId = requireActingBranch(ctx, "cashier.shift.manage");
  try {
    return await withTx(db, async (tx) => {
      const s = await tx.cashierShift.create({
        data: { branchId, cashierId: ctx.userId, openingFloatKobo: BigInt(input.openingFloatKobo) },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "billing.shift.open",
        resourceType: "CashierShift",
        resourceId: s.id,
        details: { openingFloatKobo: String(input.openingFloatKobo) },
        meta: ctx.meta,
      });
      return s;
    });
  } catch (e) {
    if (isUniqueViolation(e) || String(e).includes("CashierShift_one_open"))
      throw new ConflictError("You already have an open shift.");
    throw e;
  }
}

/** Cash expected in the drawer: float + cash received - cash refunds paid out during the shift. */
export async function expectedCash(db: DbClient, shiftId: string) {
  const s = await db.cashierShift.findUniqueOrThrow({ where: { id: shiftId } });
  const [cashIn, cashOut] = await Promise.all([
    db.payment.aggregate({
      where: { cashierShiftId: s.id, method: "CASH", status: "CONFIRMED" },
      _sum: { amountKobo: true },
    }),
    db.refund.aggregate({
      where: {
        method: "CASH",
        status: "PAID",
        paidById: s.cashierId,
        paidAt: { gte: s.openedAt, ...(s.closedAt ? { lte: s.closedAt } : {}) },
      },
      _sum: { amountKobo: true },
    }),
  ]);
  return s.openingFloatKobo + (cashIn._sum.amountKobo ?? 0n) - (cashOut._sum.amountKobo ?? 0n);
}

export async function closeShift(
  ctx: AuthContext,
  input: z.output<typeof closeShiftSchema>,
  db: DbClient = prisma,
) {
  const s = await db.cashierShift.findUnique({ where: { id: input.shiftId } });
  if (!s || s.cashierId !== ctx.userId) throw new NotFoundError("Shift not found.");
  requirePermission(ctx, "cashier.shift.manage", { branchId: s.branchId });
  if (s.status !== "OPEN") throw new ConflictError("This shift is already closed.");
  const expected = await expectedCash(db, s.id);
  const counted = BigInt(input.countedCashKobo);
  await withTx(db, async (tx) => {
    const r = await tx.cashierShift.updateMany({
      where: { id: s.id, status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        expectedCashKobo: expected,
        countedCashKobo: counted,
        varianceKobo: counted - expected,
        closeNote: input.note ?? null,
      },
    });
    if (r.count !== 1) throw new ConflictError("This shift is already closed.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.shift.close",
      resourceType: "CashierShift",
      resourceId: s.id,
      details: {
        expected: expected.toString(),
        counted: counted.toString(),
        variance: (counted - expected).toString(),
      },
      meta: ctx.meta,
    });
  });
  return { expected, counted, variance: counted - expected };
}

export async function approveShift(
  ctx: AuthContext,
  input: { id: string; note?: string },
  db: DbClient = prisma,
) {
  const s = await db.cashierShift.findUnique({ where: { id: input.id } });
  if (!s) throw new NotFoundError("Shift not found.");
  requirePermission(ctx, "finance.close.approve", { branchId: s.branchId });
  if (s.status !== "CLOSED") throw new ConflictError("Only closed shifts can be approved.");
  if (s.cashierId === ctx.userId)
    throw new ForbiddenError("You cannot approve your own shift.", "finance.close.approve");
  if (s.varianceKobo !== null && s.varianceKobo !== 0n && !input.note)
    throw new ValidationError("Explain the cash variance before approving.");
  await withTx(db, async (tx) => {
    await tx.cashierShift.update({
      where: { id: s.id },
      data: {
        status: "APPROVED",
        approvedById: ctx.userId,
        approvedAt: new Date(),
        approvalNote: input.note ?? null,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.shift.approve",
      resourceType: "CashierShift",
      resourceId: s.id,
      details: { variance: s.varianceKobo?.toString() ?? null },
      meta: ctx.meta,
    });
  });
}

// ───────────── Payments ─────────────

async function postPaymentConfirmed(
  tx: Tx,
  p: {
    id: string;
    branchId: string;
    patientId: string;
    method: PaymentMethod;
    amountKobo: bigint;
    receiptNo: string | null;
  },
  userId: string | null,
) {
  await postJournal(tx, {
    branchId: p.branchId,
    sourceType: "Payment",
    sourceId: p.id,
    kind: "confirm",
    description: `Payment ${p.receiptNo ?? p.id} (${p.method.toLowerCase().replace("_", " ")})`,
    lines: [
      { account: METHOD_ACCOUNT[p.method], debit: p.amountKobo },
      { account: ACCOUNTS.PATIENT_DEPOSITS, credit: p.amountKobo, patientId: p.patientId },
    ],
    userId,
  });
}

/** Amount of a confirmed payment not yet allocated to invoices or refunded. */
export async function paymentAvailable(db: DbClient, paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status !== "CONFIRMED") return 0n;
  const [alloc, refunds] = await Promise.all([
    db.paymentAllocation.aggregate({ where: { paymentId }, _sum: { amountKobo: true } }),
    db.refund.aggregate({
      where: { paymentId, status: { in: ["REQUESTED", "APPROVED", "PAID"] } },
      _sum: { amountKobo: true },
    }),
  ]);
  return p.amountKobo - (alloc._sum.amountKobo ?? 0n) - (refunds._sum.amountKobo ?? 0n);
}

/** Unallocated patient credit (deposits and overpayments). */
export async function patientCredit(db: DbClient, patientId: string) {
  const payments = await db.payment.findMany({
    where: { patientId, status: "CONFIRMED" },
    select: { id: true },
  });
  let total = 0n;
  for (const p of payments) total += await paymentAvailable(db, p.id);
  return total;
}

/**
 * Allocate up to `max` of a payment to an invoice, never beyond the invoice's outstanding balance
 * (rows locked, so concurrent cashiers cannot over-allocate).
 */
async function allocate(tx: Tx, paymentId: string, invoiceId: string, max: bigint, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === "VOID") return 0n;
  const { outstanding } = await invoiceTotals(tx, invoiceId);
  const available = await paymentAvailable(tx, paymentId);
  const amount = [max, outstanding, available].reduce((a, b) => (b < a ? b : a));
  if (amount <= 0n) return 0n;
  const a = await tx.paymentAllocation.create({
    data: { paymentId, invoiceId, amountKobo: amount, createdById: userId },
  });
  await postJournal(tx, {
    branchId: inv.branchId,
    sourceType: "PaymentAllocation",
    sourceId: a.id,
    kind: "allocate",
    description: `Payment applied to ${inv.ref}`,
    lines: [
      { account: ACCOUNTS.PATIENT_DEPOSITS, debit: amount, patientId: inv.patientId },
      { account: ACCOUNTS.PATIENT_RECEIVABLE, credit: amount, patientId: inv.patientId },
    ],
    userId,
  });
  return amount;
}

/**
 * Record a cash / POS / transfer payment at the desk. Cash needs an open shift. The idempotency
 * key makes a double-submitted form record one payment. Anything above the invoice balance stays
 * as patient credit (a deposit), never as a negative invoice.
 */
export async function recordPayment(
  ctx: AuthContext,
  input: z.output<typeof recordPaymentSchema>,
  db: DbClient = prisma,
) {
  const prior = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) return { payment: prior, allocated: 0n, duplicate: true };
  const branchId = requireActingBranch(ctx, "billing.payment.collect");
  const patient = await db.patient.findUnique({ where: { id: input.patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");
  const shift = await currentShift(db, ctx.userId);
  if (input.method === "CASH" && !shift)
    throw new ConflictError("Open a cashier shift before taking cash.", "NO_SHIFT");
  if (input.invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!inv || inv.patientId !== patient.id)
      throw new ValidationError("That invoice does not belong to this patient.");
  }
  try {
    return await withTx(db, async (tx) => {
      const payment = await tx.payment.create({
        data: {
          receiptNo: await nextYearlyRef(tx, "RCT", year()),
          patientId: patient.id,
          branchId,
          method: input.method,
          amountKobo: BigInt(input.amountKobo),
          status: "CONFIRMED",
          reference: input.reference ?? null,
          idempotencyKey: input.idempotencyKey,
          cashierShiftId: shift?.id ?? null,
          receivedById: ctx.userId,
          confirmedAt: new Date(),
        },
      });
      await postPaymentConfirmed(tx, payment, ctx.userId);
      const allocated = input.invoiceId
        ? await allocate(tx, payment.id, input.invoiceId, payment.amountKobo, ctx.userId)
        : 0n;
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "billing.payment.record",
        resourceType: "Payment",
        resourceId: payment.id,
        patientId: patient.id,
        details: {
          receiptNo: payment.receiptNo,
          method: input.method,
          amountKobo: String(input.amountKobo),
          allocated: allocated.toString(),
        },
        meta: ctx.meta,
      });
      return { payment, allocated, duplicate: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return { payment: again, allocated: 0n, duplicate: true };
    }
    throw e;
  }
}

/** Apply the patient's unallocated credit (oldest first) to an invoice. */
export async function applyCredit(
  ctx: AuthContext,
  input: { patientId: string; invoiceId: string },
  db: DbClient = prisma,
) {
  const inv = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv || inv.patientId !== input.patientId) throw new NotFoundError("Invoice not found.");
  requirePermission(ctx, "billing.payment.collect", { branchId: inv.branchId });
  return withTx(db, async (tx) => {
    const payments = await tx.payment.findMany({
      where: { patientId: input.patientId, status: "CONFIRMED" },
      orderBy: { confirmedAt: "asc" },
    });
    let applied = 0n;
    for (const p of payments) {
      const got = await allocate(tx, p.id, inv.id, p.amountKobo, ctx.userId);
      applied += got;
    }
    if (applied === 0n)
      throw new ConflictError("No credit available, or nothing outstanding on this invoice.");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.credit.apply",
      resourceType: "Invoice",
      resourceId: inv.id,
      patientId: inv.patientId,
      details: { applied: applied.toString() },
      meta: ctx.meta,
    });
    return applied;
  });
}

/** Reverse a payment recorded in error (unallocated and unrefunded only). Needs refund approval rights. */
export async function reversePayment(
  ctx: AuthContext,
  input: z.output<typeof reversePaymentSchema>,
  db: DbClient = prisma,
) {
  const p = await db.payment.findUnique({
    where: { id: input.paymentId },
    include: { allocations: true, refunds: true },
  });
  if (!p) throw new NotFoundError("Payment not found.");
  requirePermission(ctx, "billing.refund.approve", { branchId: p.branchId });
  if (p.status !== "CONFIRMED") throw new ConflictError("Only confirmed payments can be reversed.");
  if (p.allocations.length || p.refunds.some((r) => r.status !== "REJECTED"))
    throw new ConflictError(
      "This payment has been applied or refunded; use a credit note or refund instead.",
    );
  await withTx(db, async (tx) => {
    await tx.payment.update({
      where: { id: p.id },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedById: ctx.userId,
        reversalReason: input.reason,
      },
    });
    await postJournal(tx, {
      branchId: p.branchId,
      sourceType: "Payment",
      sourceId: p.id,
      kind: "reverse",
      description: `Reversal of ${p.receiptNo}: ${input.reason}`,
      lines: [
        { account: ACCOUNTS.PATIENT_DEPOSITS, debit: p.amountKobo, patientId: p.patientId },
        { account: METHOD_ACCOUNT[p.method], credit: p.amountKobo },
      ],
      userId: ctx.userId,
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.payment.reverse",
      resourceType: "Payment",
      resourceId: p.id,
      patientId: p.patientId,
      details: { receiptNo: p.receiptNo, reason: input.reason },
      meta: ctx.meta,
    });
  });
}

// ───────────── Refunds ─────────────

export async function requestRefund(
  ctx: AuthContext,
  input: z.output<typeof refundRequestSchema>,
  db: DbClient = prisma,
) {
  const p = await db.payment.findUnique({ where: { id: input.paymentId } });
  if (!p) throw new NotFoundError("Payment not found.");
  requirePermission(ctx, "billing.refund.request", { branchId: p.branchId });
  return withTx(db, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${p.id}::uuid FOR UPDATE`;
    const available = await paymentAvailable(tx, p.id);
    if (BigInt(input.amountKobo) > available)
      throw new ValidationError(`Only ${available} kobo of this payment is unapplied and refundable.`);
    const r = await tx.refund.create({
      data: {
        paymentId: p.id,
        amountKobo: BigInt(input.amountKobo),
        method: input.method,
        reason: input.reason,
        requestedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.refund.request",
      resourceType: "Refund",
      resourceId: r.id,
      patientId: p.patientId,
      details: { amountKobo: String(input.amountKobo), receiptNo: p.receiptNo },
      meta: ctx.meta,
    });
    return r;
  });
}

export async function decideRefund(
  ctx: AuthContext,
  input: { id: string; decision: "APPROVE" | "REJECT"; note?: string },
  db: DbClient = prisma,
) {
  const r = await db.refund.findUnique({ where: { id: input.id }, include: { payment: true } });
  if (!r) throw new NotFoundError("Refund not found.");
  requirePermission(ctx, "billing.refund.approve", { branchId: r.payment.branchId });
  if (r.status !== "REQUESTED") throw new ConflictError("Already decided.");
  if (r.requestedById === ctx.userId)
    throw new ForbiddenError(
      "Refunds must be approved by someone other than the requester.",
      "billing.refund.approve",
    );
  await withTx(db, async (tx) => {
    const u = await tx.refund.updateMany({
      where: { id: r.id, status: "REQUESTED" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });
    if (u.count !== 1) throw new ConflictError("Already decided.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "billing.refund.approve" : "billing.refund.reject",
      resourceType: "Refund",
      resourceId: r.id,
      patientId: r.payment.patientId,
      details: { amountKobo: r.amountKobo.toString() },
      meta: ctx.meta,
    });
  });
}

export async function markRefundPaid(
  ctx: AuthContext,
  input: { id: string; reference?: string },
  db: DbClient = prisma,
) {
  const r = await db.refund.findUnique({ where: { id: input.id }, include: { payment: true } });
  if (!r) throw new NotFoundError("Refund not found.");
  requirePermission(ctx, "billing.payment.collect", { branchId: r.payment.branchId });
  if (r.status !== "APPROVED") throw new ConflictError("Only approved refunds can be paid out.");
  if (r.method === "CASH" && !(await currentShift(db, ctx.userId)))
    throw new ConflictError("Open a cashier shift before paying out cash.", "NO_SHIFT");
  await withTx(db, async (tx) => {
    const u = await tx.refund.updateMany({
      where: { id: r.id, status: "APPROVED" },
      data: { status: "PAID", paidById: ctx.userId, paidAt: new Date(), reference: input.reference ?? null },
    });
    if (u.count !== 1) throw new ConflictError("Already paid.", "STALE");
    await postJournal(tx, {
      branchId: r.payment.branchId,
      sourceType: "Refund",
      sourceId: r.id,
      kind: "paid",
      description: `Refund against ${r.payment.receiptNo}`,
      lines: [
        { account: ACCOUNTS.PATIENT_DEPOSITS, debit: r.amountKobo, patientId: r.payment.patientId },
        { account: METHOD_ACCOUNT[r.method], credit: r.amountKobo },
      ],
      userId: ctx.userId,
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.refund.paid",
      resourceType: "Refund",
      resourceId: r.id,
      patientId: r.payment.patientId,
      details: { amountKobo: r.amountKobo.toString(), method: r.method },
      meta: ctx.meta,
    });
  });
}

// ───────────── Online payments (provider adapter) ─────────────

export interface ProviderConfig {
  provider: string;
  secret: string;
}

export function providerConfig(): ProviderConfig | null {
  const e = env();
  if (e.PAYMENT_PROVIDER === "disabled" || !e.PAYMENT_WEBHOOK_SECRET) return null;
  return { provider: e.PAYMENT_PROVIDER, secret: e.PAYMENT_WEBHOOK_SECRET };
}

/** HMAC-SHA512 of the raw body, hex encoded (Paystack's scheme), compared in constant time. */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Create a PENDING online payment. Only possible when a provider is configured; the hospital's
 * own integration then redirects the patient. The payment is confirmed solely by a verified
 * provider callback, never by the browser.
 */
export async function createPendingOnlinePayment(
  ctx: AuthContext,
  input: { patientId: string; amountKobo: number; idempotencyKey: string },
  db: DbClient = prisma,
  config: ProviderConfig | null = providerConfig(),
) {
  if (!config)
    throw new ConflictError("Online payments are not configured for this hospital.", "PROVIDER_DISABLED");
  const branchId = requireActingBranch(ctx, "billing.payment.collect");
  const ref = `ADK-${input.idempotencyKey}`;
  return withTx(db, async (tx) => {
    const p = await tx.payment.create({
      data: {
        patientId: input.patientId,
        branchId,
        method: "ONLINE",
        amountKobo: BigInt(input.amountKobo),
        status: "PENDING",
        provider: config.provider,
        providerRef: ref,
        idempotencyKey: input.idempotencyKey,
        receivedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.payment.online_initiated",
      resourceType: "Payment",
      resourceId: p.id,
      patientId: input.patientId,
      details: { provider: config.provider, amountKobo: String(input.amountKobo) },
      meta: ctx.meta,
    });
    return p;
  });
}

export type CallbackOutcome =
  | "confirmed"
  | "duplicate"
  | "already_confirmed"
  | "unknown_reference"
  | "amount_mismatch"
  | "ignored_event"
  | "failed";

/**
 * Provider webhook. Signature verified first; each provider event is stored once, so an identical
 * callback delivered twice produces exactly one confirmation and one ledger posting.
 */
export async function handleProviderCallback(
  rawBody: string,
  signature: string | null,
  config: ProviderConfig | null = providerConfig(),
  db: DbClient = prisma,
): Promise<{ status: number; outcome: CallbackOutcome | "disabled" | "bad_signature" | "bad_payload" }> {
  if (!config) return { status: 503, outcome: "disabled" };
  if (!verifySignature(rawBody, signature, config.secret)) {
    logger.warn("payment_callback_bad_signature", { provider: config.provider });
    return { status: 401, outcome: "bad_signature" };
  }
  let body: {
    event?: string;
    data?: { id?: number | string; reference?: string; amount?: number; status?: string };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, outcome: "bad_payload" };
  }
  const ref = body.data?.reference;
  const eventId = `${body.event ?? "unknown"}:${body.data?.id ?? ref ?? sha256(rawBody)}`;
  if (!ref || typeof body.data?.amount !== "number") return { status: 400, outcome: "bad_payload" };

  return withTx(db, async (tx) => {
    const stored = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "PaymentProviderEvent" ("id", "provider", "eventId", "payloadHash", "outcome")
      VALUES (gen_random_uuid(), ${config.provider}, ${eventId}, ${sha256(rawBody)}, 'received')
      ON CONFLICT ("provider", "eventId") DO NOTHING RETURNING "id"`;
    if (!stored.length) return { status: 200, outcome: "duplicate" as const };
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Payment" WHERE "provider" = ${config.provider} AND "providerRef" = ${ref} FOR UPDATE`;
    const payment = locked ? await tx.payment.findUnique({ where: { id: locked.id } }) : null;
    let outcome: CallbackOutcome;
    if (body.event !== "charge.success") outcome = "ignored_event";
    else if (!payment) outcome = "unknown_reference";
    else if (payment.status === "CONFIRMED") outcome = "already_confirmed";
    else if (payment.status !== "PENDING") outcome = "failed";
    else if (BigInt(body.data!.amount!) !== payment.amountKobo) outcome = "amount_mismatch";
    else {
      const confirmed = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          receiptNo: await nextYearlyRef(tx, "RCT", year()),
        },
      });
      await postPaymentConfirmed(tx, confirmed, null);
      outcome = "confirmed";
    }
    await recordAudit(tx, {
      actorType: "SYSTEM",
      action: "billing.payment.callback",
      resourceType: "Payment",
      resourceId: payment?.id ?? ref,
      patientId: payment?.patientId,
      outcome: outcome === "confirmed" || outcome === "already_confirmed" ? "SUCCESS" : "FAILURE",
      details: { provider: config.provider, eventId, outcome },
    });
    return { status: 200, outcome };
  });
}

// ───────────── Queries ─────────────

export async function patientAccount(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  const b = branchesWith(ctx, "billing.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "billing.read");
  const branchWhere = b === "ALL" ? {} : { branchId: { in: b } };
  const patient = await db.patient.findUnique({
    where: { id: patientId },
    select: { id: true, mrn: true, givenName: true, familyName: true, phoneE164: true },
  });
  if (!patient) throw new NotFoundError("Patient not found.");
  const [invoices, payments, credit] = await Promise.all([
    db.invoice.findMany({
      where: { patientId, ...branchWhere },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { encounter: { select: { ref: true, arrivedAt: true, payerClass: true } } },
    }),
    db.payment.findMany({
      where: { patientId, ...branchWhere },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { allocations: true, refunds: true },
    }),
    patientCredit(db, patientId),
  ]);
  const withTotals = await Promise.all(
    invoices.map(async (i) => ({ ...i, totals: await invoiceTotals(db, i.id) })),
  );
  return { patient, invoices: withTotals, payments, credit };
}

export async function getInvoice(ctx: AuthContext, invoiceId: string, db: DbClient = prisma) {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true, phoneE164: true } },
      encounter: {
        select: { id: true, ref: true, arrivedAt: true, payerClass: true, coverageId: true, status: true },
      },
      charges: {
        orderBy: { createdAt: "asc" },
        include: {
          serviceItem: { select: { code: true, name: true, category: true } },
          payer: { select: { name: true } },
        },
      },
      adjustments: { orderBy: { requestedAt: "asc" } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: { payment: { select: { receiptNo: true, method: true } } },
      },
    },
  });
  if (!inv || !can(ctx, "billing.read", { branchId: inv.branchId }))
    throw new NotFoundError("Invoice not found.");
  return { inv, totals: await invoiceTotals(db, inv.id) };
}

/** Cashier desk: today's open invoices with an outstanding patient balance in the acting branch. */
export async function cashierQueue(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "billing.read");
  const { start } = localDayRange(todayLocal());
  const invoices = await db.invoice.findMany({
    where: {
      branchId,
      status: { in: ["OPEN", "FINALISED"] },
      OR: [{ status: "OPEN" }, { createdAt: { gte: new Date(start.getTime() - 7 * 86_400_000) } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      encounter: { select: { ref: true, payerClass: true, status: true } },
    },
  });
  const rows = await Promise.all(
    invoices.map(async (i) => ({ ...i, totals: await invoiceTotals(db, i.id) })),
  );
  return rows.filter((r) => r.totals.outstanding > 0n || r.totals.unresolved > 0);
}
