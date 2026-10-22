import type { ClaimStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { branchesWith, can, requirePermission, type AuthContext } from "../../authz/context";
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";
import { koboToNairaString } from "@/lib/money";
import type { claimTransitionSchema, remittanceSchema } from "@/lib/schemas/hmo";
import { ACCOUNTS, postJournal } from "../billing/ledger";

const year = () => Number(todayLocal().slice(0, 4));

/**
 * Manual claim moves. PAID and PARTLY_PAID are deliberately absent: they are set only by
 * reconciling a remittance, so an approval or pre-authorisation can never mark a claim paid.
 */
export const CLAIM_TRANSITIONS: Partial<Record<ClaimStatus, ClaimStatus[]>> = {
  DRAFT: ["CLOSED"],
  VALIDATED: ["SUBMITTED", "DRAFT"],
  SUBMITTED: ["ACKNOWLEDGED", "QUERIED", "APPROVED", "PARTLY_APPROVED", "DENIED"],
  ACKNOWLEDGED: ["QUERIED", "APPROVED", "PARTLY_APPROVED", "DENIED"],
  QUERIED: ["RESUBMITTED"],
  RESUBMITTED: ["ACKNOWLEDGED", "QUERIED", "APPROVED", "PARTLY_APPROVED", "DENIED"],
  APPROVED: ["CLOSED"],
  PARTLY_APPROVED: ["CLOSED"],
  DENIED: ["RESUBMITTED", "CLOSED"],
  PARTLY_PAID: ["CLOSED"],
  PAID: ["CLOSED"],
};

/** Statuses in which a payer payment can be reconciled against the claim. */
const REMITTABLE: ClaimStatus[] = [
  "SUBMITTED",
  "ACKNOWLEDGED",
  "RESUBMITTED",
  "APPROVED",
  "PARTLY_APPROVED",
  "PARTLY_PAID",
];

function branchScope(ctx: AuthContext) {
  const b = branchesWith(ctx, "hmo.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "hmo.read");
  return b === "ALL" ? {} : { branchId: { in: b } };
}

async function event(
  tx: Tx,
  claimId: string,
  from: ClaimStatus | null,
  to: ClaimStatus,
  byId: string,
  note?: string | null,
) {
  await tx.claimEvent.create({ data: { claimId, fromStatus: from, toStatus: to, byId, note: note ?? null } });
}

/**
 * Build a claim from a visit's billed payer portions. Each charge can sit on only one live claim
 * line (partial unique index), so duplicate items cannot be claimed twice.
 */
export async function createClaimForEncounter(ctx: AuthContext, encounterId: string, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({ where: { id: encounterId }, include: { coverage: true } });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "hmo.claim.manage", { branchId: enc.branchId });
  if (!enc.coverage) throw new ConflictError("This visit has no HMO cover.");
  const coverage = enc.coverage;
  const charges = await db.charge.findMany({
    where: {
      encounterId: enc.id,
      status: "ACTIVE",
      payerId: coverage.payerId,
      payerPortionKobo: { gt: 0 },
      claimLines: { none: { removedAt: null } },
    },
    orderBy: { serviceDate: "asc" },
    include: { preauth: { select: { authCode: true } } },
  });
  if (!charges.length) throw new ConflictError("There are no unclaimed payer charges on this visit.");
  try {
    return await withTx(db, async (tx) => {
      const claimed = charges.reduce((s, c) => s + c.payerPortionKobo, 0n);
      const claim = await tx.claim.create({
        data: {
          ref: await nextYearlyRef(tx, "CLM", year()),
          payerId: coverage.payerId,
          coverageId: coverage.id,
          patientId: enc.patientId,
          encounterId: enc.id,
          branchId: enc.branchId,
          claimedKobo: claimed,
          createdById: ctx.userId,
          lines: {
            create: charges.map((c) => ({
              chargeId: c.id,
              serviceItemId: c.serviceItemId,
              description: c.description,
              serviceDate: c.serviceDate,
              quantity: c.quantity,
              claimedKobo: c.payerPortionKobo,
              authCode: c.preauth?.authCode ?? null,
            })),
          },
        },
      });
      await event(tx, claim.id, null, "DRAFT", ctx.userId);
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "hmo.claim.create",
        resourceType: "Claim",
        resourceId: claim.id,
        patientId: enc.patientId,
        details: { ref: claim.ref, lines: charges.length, claimedKobo: claimed.toString() },
        meta: ctx.meta,
      });
      return claim;
    });
  } catch (e) {
    if (isUniqueViolation(e) || String(e).includes("ClaimLine_charge_once"))
      throw new ConflictError("Some of these charges were just claimed by someone else. Refresh.");
    throw e;
  }
}

export async function removeClaimLine(
  ctx: AuthContext,
  input: { lineId: string; reason: string },
  db: DbClient = prisma,
) {
  const line = await db.claimLine.findUnique({ where: { id: input.lineId }, include: { claim: true } });
  if (!line) throw new NotFoundError("Claim line not found.");
  requirePermission(ctx, "hmo.claim.manage", { branchId: line.claim.branchId });
  if (line.claim.status !== "DRAFT") throw new ConflictError("Lines can only be removed from draft claims.");
  if (line.removedAt) throw new ConflictError("Already removed.");
  await withTx(db, async (tx) => {
    await tx.claimLine.update({ where: { id: line.id }, data: { removedAt: new Date() } });
    await tx.claim.update({
      where: { id: line.claimId },
      data: { claimedKobo: { decrement: line.claimedKobo }, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.claim.line.remove",
      resourceType: "Claim",
      resourceId: line.claimId,
      patientId: line.claim.patientId,
      details: { line: line.id, reason: input.reason },
      meta: ctx.meta,
    });
  });
}

/** Problems that stop a claim from being sent. */
export async function claimIssues(db: DbClient, claimId: string): Promise<string[]> {
  const claim = await db.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      payer: true,
      coverage: true,
      lines: { where: { removedAt: null }, include: { charge: { include: { preauth: true } } } },
      encounter: { include: { diagnoses: { where: { status: { not: "ENTERED_IN_ERROR" } } } } },
    },
  });
  const issues: string[] = [];
  if (claim.payer.status !== "ACTIVE") issues.push(`${claim.payer.name} is not an active contract.`);
  if (!claim.lines.length) issues.push("The claim has no lines.");
  if (!claim.encounter.diagnoses.length) issues.push("Record at least one diagnosis on the visit.");
  for (const l of claim.lines) {
    if (l.charge.status !== "ACTIVE") issues.push(`${l.description}: the charge was voided.`);
    if (l.charge.preauthRequired) {
      const pa = l.charge.preauth;
      if (!pa || !["APPROVED", "PARTIALLY_APPROVED"].includes(pa.status) || !pa.authCode)
        issues.push(`${l.description}: needs an approved pre-authorisation.`);
    }
  }
  return issues;
}

export async function validateClaim(
  ctx: AuthContext,
  input: { id: string; version: number },
  db: DbClient = prisma,
) {
  const claim = await db.claim.findUnique({ where: { id: input.id } });
  if (!claim) throw new NotFoundError("Claim not found.");
  requirePermission(ctx, "hmo.claim.manage", { branchId: claim.branchId });
  if (claim.status !== "DRAFT") throw new ConflictError("Only draft claims are validated.");
  const issues = await claimIssues(db, claim.id);
  if (issues.length) throw new ValidationError(`Fix before sending: ${issues.join(" ")}`);
  await withTx(db, async (tx) => {
    const r = await tx.claim.updateMany({
      where: { id: claim.id, version: input.version, status: "DRAFT" },
      data: { status: "VALIDATED", version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictError("The claim changed. Refresh and try again.", "STALE");
    await event(tx, claim.id, "DRAFT", "VALIDATED", ctx.userId);
  });
}

/**
 * Record a claim status change (submission, payer acknowledgement, query, approval, denial, close).
 * Closing with an unpaid balance writes it off and needs finance approval rights.
 */
export async function transitionClaim(
  ctx: AuthContext,
  input: z.output<typeof claimTransitionSchema>,
  db: DbClient = prisma,
) {
  const claim = await db.claim.findUnique({
    where: { id: input.id },
    include: { lines: { where: { removedAt: null } } },
  });
  if (!claim) throw new NotFoundError("Claim not found.");
  requirePermission(ctx, "hmo.claim.submit", { branchId: claim.branchId });
  if (!(CLAIM_TRANSITIONS[claim.status] ?? []).includes(input.to))
    throw new InvalidTransitionError(claim.status, input.to, "claim");
  if (["QUERIED", "DENIED"].includes(input.to) && !input.note)
    throw new ValidationError("Record the payer's reason.");
  if (input.to === "PARTLY_APPROVED") {
    if (input.approvedKobo === undefined || BigInt(input.approvedKobo) >= claim.claimedKobo)
      throw new ValidationError("Enter the approved amount (less than claimed).");
  }
  const writeOff = input.to === "CLOSED" ? claim.claimedKobo - claim.paidKobo : 0n;
  if (input.to === "CLOSED" && claim.status !== "DRAFT" && writeOff > 0n) {
    requirePermission(ctx, "finance.close.approve", { branchId: claim.branchId });
    if (!input.note) throw new ValidationError("Explain why the unpaid balance is being written off.");
  }
  await withTx(db, async (tx) => {
    const r = await tx.claim.updateMany({
      where: { id: claim.id, version: input.version, status: claim.status },
      data: {
        status: input.to,
        version: { increment: 1 },
        ...(input.to === "SUBMITTED" ? { submittedAt: new Date() } : {}),
        ...(input.to === "APPROVED" ? { approvedKobo: claim.claimedKobo } : {}),
        ...(input.to === "PARTLY_APPROVED" ? { approvedKobo: BigInt(input.approvedKobo!) } : {}),
        ...(input.to === "DENIED" ? { denialReason: input.note ?? null, approvedKobo: 0n } : {}),
        ...(input.to === "CLOSED" && claim.status !== "DRAFT" ? { writtenOffKobo: writeOff } : {}),
      },
    });
    if (r.count !== 1) throw new ConflictError("The claim changed. Refresh and try again.", "STALE");
    if (input.to === "CLOSED" && claim.status === "DRAFT") {
      // An abandoned draft releases its charges so they can be claimed again.
      await tx.claimLine.updateMany({
        where: { claimId: claim.id, removedAt: null },
        data: { removedAt: new Date() },
      });
    } else if (input.to === "CLOSED" && writeOff > 0n) {
      await postJournal(tx, {
        branchId: claim.branchId,
        sourceType: "Claim",
        sourceId: claim.id,
        kind: "write-off",
        description: `Write-off on ${claim.ref}: ${input.note}`,
        lines: [
          { account: ACCOUNTS.PAYER_WRITE_OFFS, debit: writeOff },
          { account: ACCOUNTS.PAYER_RECEIVABLE, credit: writeOff, payerId: claim.payerId },
        ],
        userId: ctx.userId,
      });
    }
    await event(tx, claim.id, claim.status, input.to, ctx.userId, input.note);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `hmo.claim.${input.to.toLowerCase()}`,
      resourceType: "Claim",
      resourceId: claim.id,
      patientId: claim.patientId,
      details: { ref: claim.ref, from: claim.status, writeOff: writeOff.toString() },
      meta: ctx.meta,
    });
  });
}

export async function listClaims(
  ctx: AuthContext,
  opts: { status?: ClaimStatus; payerId?: string } = {},
  db: DbClient = prisma,
) {
  return db.claim.findMany({
    where: {
      ...branchScope(ctx),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.payerId ? { payerId: opts.payerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
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

export async function getClaim(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const claim = await db.claim.findUnique({
    where: { id },
    include: {
      payer: { select: { id: true, name: true, status: true } },
      coverage: { select: { memberNumber: true, plan: { select: { name: true } } } },
      encounter: {
        select: {
          id: true,
          ref: true,
          arrivedAt: true,
          patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
          diagnoses: {
            where: { status: { not: "ENTERED_IN_ERROR" } },
            select: { description: true, code: true, isPrimary: true },
          },
        },
      },
      lines: {
        orderBy: { serviceDate: "asc" },
        include: { charge: { select: { preauthRequired: true, status: true } } },
      },
      events: { orderBy: { at: "asc" } },
      remitted: {
        include: { remittance: { select: { ref: true, payerReference: true, receivedDate: true } } },
      },
    },
  });
  if (!claim || !can(ctx, "hmo.read", { branchId: claim.branchId }))
    throw new NotFoundError("Claim not found.");
  return { claim, issues: claim.status === "DRAFT" ? await claimIssues(db, claim.id) : [] };
}

// ───────────── Batches and export ─────────────

export async function createBatch(
  ctx: AuthContext,
  input: { payerId: string; claimIds: string[] },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.claim.submit");
  const claims = await db.claim.findMany({ where: { id: { in: input.claimIds }, ...branchScope(ctx) } });
  if (!claims.length) throw new ValidationError("Choose at least one claim.");
  if (claims.some((c) => c.payerId !== input.payerId || c.status !== "VALIDATED" || c.batchId))
    throw new ConflictError("Batches take validated, unbatched claims for one payer.");
  return withTx(db, async (tx) => {
    const batch = await tx.claimBatch.create({
      data: {
        ref: await nextYearlyRef(tx, "BAT", year()),
        payerId: input.payerId,
        createdById: ctx.userId,
        submittedAt: new Date(),
      },
    });
    for (const c of claims) {
      const r = await tx.claim.updateMany({
        where: { id: c.id, status: "VALIDATED", batchId: null },
        data: { batchId: batch.id, status: "SUBMITTED", submittedAt: new Date(), version: { increment: 1 } },
      });
      if (r.count !== 1) throw new ConflictError("A claim changed while batching. Refresh.", "STALE");
      await event(tx, c.id, "VALIDATED", "SUBMITTED", ctx.userId, `Batch ${batch.ref}`);
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.claim.batch",
      resourceType: "ClaimBatch",
      resourceId: batch.id,
      details: { ref: batch.ref, claims: claims.length },
      meta: ctx.meta,
    });
    return batch;
  });
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Excel-friendly CSV of a batch's claim lines. Export is audited. */
export async function exportBatchCsv(ctx: AuthContext, batchId: string, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.claim.manage");
  const batch = await db.claimBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError("Batch not found.");
  const payer = await db.payer.findUniqueOrThrow({ where: { id: batch.payerId } });
  const claims = await db.claim.findMany({
    where: { batchId, ...branchScope(ctx) },
    include: {
      coverage: { select: { memberNumber: true, plan: { select: { code: true } } } },
      encounter: {
        select: {
          ref: true,
          patient: { select: { mrn: true, givenName: true, familyName: true, dateOfBirth: true } },
          diagnoses: {
            where: { status: { not: "ENTERED_IN_ERROR" } },
            select: { code: true, description: true },
          },
        },
      },
      lines: { where: { removedAt: null }, orderBy: { serviceDate: "asc" } },
    },
  });
  const services = await db.serviceItem.findMany({
    where: { id: { in: claims.flatMap((c) => c.lines.map((l) => l.serviceItemId)) } },
  });
  const header = [
    "Batch",
    "Claim",
    "Payer",
    "Provider code",
    "Member number",
    "Plan",
    "Patient",
    "Hospital number",
    "Date of birth",
    "Visit",
    "Diagnoses",
    "Service date",
    "Service code",
    "Description",
    "Quantity",
    "Amount (NGN)",
    "Authorisation code",
  ];
  const rows = claims.flatMap((c) =>
    c.lines.map((l) => [
      batch.ref,
      c.ref,
      payer.name,
      payer.providerCode,
      c.coverage.memberNumber,
      c.coverage.plan.code,
      `${c.encounter.patient.familyName} ${c.encounter.patient.givenName}`,
      c.encounter.patient.mrn,
      c.encounter.patient.dateOfBirth?.toISOString().slice(0, 10) ?? "",
      c.encounter.ref,
      c.encounter.diagnoses.map((d) => (d.code ? `${d.code} ${d.description}` : d.description)).join("; "),
      l.serviceDate.toISOString().slice(0, 10),
      services.find((s) => s.id === l.serviceItemId)?.code ?? "",
      l.description,
      l.quantity,
      koboToNairaString(l.claimedKobo),
      l.authCode,
    ]),
  );
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "export.claims.batch",
    resourceType: "ClaimBatch",
    resourceId: batch.id,
    details: { ref: batch.ref, claims: claims.length, lines: rows.length },
    meta: ctx.meta,
  });
  return {
    filename: `${batch.ref}-${payer.code}.csv`,
    csv: "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n",
  };
}

export async function listBatches(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.read");
  return db.claimBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { claims: true } } },
  });
}

// ───────────── Remittances ─────────────

/**
 * Import a payer's payment advice and reconcile it claim by claim (and line by line, oldest first).
 * Guards: the same advice cannot be imported twice; totals must add up; no claim or line can be
 * paid more than was claimed. Payments clear the payer receivable - they never add revenue, so
 * several part-payments cannot overstate income.
 */
export async function importRemittance(
  ctx: AuthContext,
  input: z.output<typeof remittanceSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.remittance.reconcile");
  const payer = await db.payer.findUnique({ where: { id: input.payerId } });
  if (!payer) throw new NotFoundError("Payer not found.");
  const lineTotal = input.lines.reduce((s, l) => s + BigInt(l.paidKobo), 0n);
  if (lineTotal !== BigInt(input.totalKobo))
    throw new ValidationError(
      `Line payments add up to ${koboToNairaString(lineTotal)}, not the advice total ${koboToNairaString(BigInt(input.totalKobo))}.`,
    );
  const refs = input.lines.map((l) => l.claimRef.trim().toUpperCase());
  if (new Set(refs).size !== refs.length)
    throw new ValidationError("Each claim may appear once per advice; combine its amounts.");
  try {
    return await withTx(db, async (tx) => {
      const remittance = await tx.remittance.create({
        data: {
          ref: await nextYearlyRef(tx, "REM", year()),
          payerId: payer.id,
          payerReference: input.payerReference,
          receivedDate: calendarDateToUtcMidnight(input.receivedDate),
          totalKobo: BigInt(input.totalKobo),
          note: input.note ?? null,
          importedById: ctx.userId,
        },
      });
      for (const [i, line] of input.lines.entries()) {
        const ref = refs[i]!;
        const [locked] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Claim" WHERE "ref" = ${ref} FOR UPDATE`;
        const claim = locked
          ? await tx.claim.findUnique({
              where: { id: locked.id },
              include: { lines: { where: { removedAt: null }, orderBy: { serviceDate: "asc" } } },
            })
          : null;
        if (!claim || claim.payerId !== payer.id)
          throw new ValidationError(`${ref} is not a ${payer.name} claim.`);
        if (!can(ctx, "hmo.remittance.reconcile", { branchId: claim.branchId }))
          throw new ForbiddenError(undefined, "hmo.remittance.reconcile");
        if (!REMITTABLE.includes(claim.status))
          throw new ConflictError(`${ref} is ${claim.status.toLowerCase()} and cannot take a payment.`);
        const paid = BigInt(line.paidKobo);
        const outstanding = claim.claimedKobo - claim.paidKobo - claim.writtenOffKobo;
        if (paid > outstanding)
          throw new ConflictError(
            `${ref}: payment ${koboToNairaString(paid)} exceeds the unpaid ${koboToNairaString(outstanding)}.`,
          );
        // Spread the payment across lines in service order.
        let left = paid;
        for (const l of claim.lines) {
          if (left <= 0n) break;
          const room = l.claimedKobo - l.paidKobo;
          if (room <= 0n) continue;
          const take = left < room ? left : room;
          await tx.claimLine.update({ where: { id: l.id }, data: { paidKobo: { increment: take } } });
          left -= take;
        }
        await tx.remittanceLine.create({
          data: {
            remittanceId: remittance.id,
            claimId: claim.id,
            paidKobo: paid,
            deniedKobo: BigInt(line.deniedKobo),
            reason: line.reason ?? null,
          },
        });
        const newPaid = claim.paidKobo + paid;
        const target = claim.approvedKobo ?? claim.claimedKobo;
        const status: ClaimStatus = newPaid >= target ? "PAID" : newPaid > 0n ? "PARTLY_PAID" : claim.status;
        await tx.claim.update({
          where: { id: claim.id },
          data: { paidKobo: newPaid, status, version: { increment: 1 } },
        });
        if (status !== claim.status)
          await event(tx, claim.id, claim.status, status, ctx.userId, `Remittance ${remittance.ref}`);
        if (paid > 0n)
          await postJournal(tx, {
            branchId: claim.branchId,
            sourceType: "RemittanceLine",
            sourceId: `${remittance.id}:${claim.id}`,
            kind: "receipt",
            description: `${payer.name} payment ${input.payerReference} for ${claim.ref}`,
            lines: [
              { account: ACCOUNTS.BANK, debit: paid },
              { account: ACCOUNTS.PAYER_RECEIVABLE, credit: paid, payerId: payer.id },
            ],
            userId: ctx.userId,
          });
      }
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "hmo.remittance.import",
        resourceType: "Remittance",
        resourceId: remittance.id,
        details: {
          ref: remittance.ref,
          payerReference: input.payerReference,
          claims: input.lines.length,
          totalKobo: String(input.totalKobo),
        },
        meta: ctx.meta,
      });
      return remittance;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError("This payment advice has already been imported for this payer.");
    throw e;
  }
}

export async function listRemittances(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.read");
  return db.remittance.findMany({
    orderBy: { importedAt: "desc" },
    take: 100,
    include: { payer: { select: { name: true } }, _count: { select: { lines: true } } },
  });
}
