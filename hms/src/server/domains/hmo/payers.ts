import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { calendarDateToUtcMidnight } from "@/lib/time";
import type { activatePayerSchema, planSchema, tariffSchema, payerSchema } from "@/lib/schemas/hmo";

const d = (v?: string) => (v ? calendarDateToUtcMidnight(v) : null);

export async function listPayers(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.read");
  return db.payer.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { plans: { orderBy: { name: "asc" } }, _count: { select: { coverages: true, claims: true } } },
  });
}

export async function getPayer(ctx: AuthContext, id: string, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.read");
  const payer = await db.payer.findUnique({
    where: { id },
    include: {
      plans: { orderBy: { name: "asc" } },
      tariffs: {
        where: { status: { in: ["DRAFT", "APPROVED"] } },
        orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
        include: {
          serviceItem: { select: { code: true, name: true } },
          plan: { select: { code: true, name: true } },
        },
      },
    },
  });
  if (!payer) throw new NotFoundError("Payer not found.");
  return payer;
}

export async function savePayer(
  ctx: AuthContext,
  input: z.output<typeof payerSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.partner.manage");
  const { id, contactPhone, contractStart, contractEnd, ...rest } = input;
  const data = {
    ...rest,
    providerCode: rest.providerCode ?? null,
    contactName: rest.contactName ?? null,
    contactEmail: rest.contactEmail ?? null,
    claimsEmail: rest.claimsEmail ?? null,
    contactPhone: contactPhone ?? null,
    contractStart: d(contractStart),
    contractEnd: d(contractEnd),
  };
  if (data.contractStart && data.contractEnd && data.contractEnd <= data.contractStart)
    throw new ValidationError("Contract end must be after the start.");
  try {
    return await withTx(db, async (tx) => {
      const p = id ? await tx.payer.update({ where: { id }, data }) : await tx.payer.create({ data });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: id ? "hmo.payer.update" : "hmo.payer.create",
        resourceType: "Payer",
        resourceId: p.id,
        details: { code: p.code },
        meta: ctx.meta,
      });
      return p;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A payer with this code already exists.");
    throw e;
  }
}

/**
 * Activate a payer only with recorded contract evidence and dates; a directory listing is never
 * enough. Separation of duties: the activator holds hmo.partner.activate (finance), not the officer
 * who configured the payer.
 */
export async function setPayerStatus(
  ctx: AuthContext,
  input: z.output<typeof activatePayerSchema> & { status?: "ACTIVE" | "SUSPENDED" | "TERMINATED" },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.partner.activate");
  const p = await db.payer.findUnique({ where: { id: input.id } });
  if (!p) throw new NotFoundError("Payer not found.");
  const to = input.status ?? "ACTIVE";
  if (to === "ACTIVE" && (!p.contractStart || !p.contractEnd))
    throw new ValidationError("Record the contract start and end dates before activating.");
  if (p.status === to) throw new ConflictError(`Already ${to.toLowerCase()}.`);
  await withTx(db, async (tx) => {
    await tx.payer.update({
      where: { id: p.id },
      data: {
        status: to,
        contractEvidence: input.contractEvidence,
        ...(to === "ACTIVE" ? { activatedById: ctx.userId, activatedAt: new Date() } : {}),
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `hmo.payer.${to.toLowerCase()}`,
      resourceType: "Payer",
      resourceId: p.id,
      details: { from: p.status, to, evidence: input.contractEvidence },
      meta: ctx.meta,
    });
  });
}

export async function savePlan(ctx: AuthContext, input: z.output<typeof planSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.partner.manage");
  try {
    return await withTx(db, async (tx) => {
      const plan = await tx.payerPlan.create({ data: { ...input, notes: input.notes ?? null } });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "hmo.plan.create",
        resourceType: "PayerPlan",
        resourceId: plan.id,
        details: { code: plan.code, copayBasisPoints: plan.copayBasisPoints },
        meta: ctx.meta,
      });
      return plan;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("This payer already has a plan with that code.");
    throw e;
  }
}

export async function setPlanStatus(
  ctx: AuthContext,
  input: { id: string; status: "ACTIVE" | "SUSPENDED" },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.partner.activate");
  const plan = await db.payerPlan.findUnique({ where: { id: input.id }, include: { payer: true } });
  if (!plan) throw new NotFoundError("Plan not found.");
  if (input.status === "ACTIVE" && plan.payer.status !== "ACTIVE")
    throw new ConflictError("Activate the payer's contract first.");
  await withTx(db, async (tx) => {
    await tx.payerPlan.update({
      where: { id: plan.id },
      data: {
        status: input.status,
        ...(input.status === "ACTIVE" ? { activatedById: ctx.userId, activatedAt: new Date() } : {}),
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `hmo.plan.${input.status.toLowerCase()}`,
      resourceType: "PayerPlan",
      resourceId: plan.id,
      meta: ctx.meta,
    });
  });
}

export async function proposeTariff(
  ctx: AuthContext,
  input: z.output<typeof tariffSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.partner.manage");
  if (input.planId) {
    const plan = await db.payerPlan.findUnique({ where: { id: input.planId } });
    if (!plan || plan.payerId !== input.payerId)
      throw new ValidationError("That plan belongs to another payer.");
  }
  return withTx(db, async (tx) => {
    const t = await tx.payerTariff.create({
      data: {
        payerId: input.payerId,
        planId: input.planId ?? null,
        serviceItemId: input.serviceItemId,
        coverage: input.coverage,
        amountKobo: input.coverage === "COVERED" ? BigInt(input.amountKobo!) : null,
        copayBasisPoints: input.copayBasisPoints ?? null,
        requiresPreauth: input.requiresPreauth,
        effectiveFrom: calendarDateToUtcMidnight(input.effectiveFrom),
        note: input.note ?? null,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hmo.tariff.propose",
      resourceType: "PayerTariff",
      resourceId: t.id,
      details: {
        coverage: t.coverage,
        amountKobo: t.amountKobo?.toString() ?? null,
        effectiveFrom: input.effectiveFrom,
      },
      meta: ctx.meta,
    });
    return t;
  });
}

/** Tariffs are contract terms: approved by someone with activation rights, not the proposer. */
export async function decideTariff(
  ctx: AuthContext,
  input: { id: string; decision: "APPROVE" | "REJECT"; note?: string },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "hmo.partner.activate");
  const t = await db.payerTariff.findUnique({ where: { id: input.id } });
  if (!t) throw new NotFoundError("Tariff not found.");
  if (t.status !== "DRAFT") throw new ConflictError("Already decided.");
  if (t.createdById === ctx.userId)
    throw new ForbiddenError(
      "Tariffs must be approved by someone other than the proposer.",
      "hmo.partner.activate",
    );
  try {
    await withTx(db, async (tx) => {
      if (input.decision === "APPROVE")
        await tx.payerTariff.updateMany({
          where: {
            payerId: t.payerId,
            planId: t.planId,
            serviceItemId: t.serviceItemId,
            status: "APPROVED",
            effectiveTo: null,
            effectiveFrom: { lt: t.effectiveFrom },
          },
          data: { effectiveTo: t.effectiveFrom },
        });
      await tx.payerTariff.update({
        where: { id: t.id },
        data: {
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedById: ctx.userId,
          decidedAt: new Date(),
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: input.decision === "APPROVE" ? "hmo.tariff.approve" : "hmo.tariff.reject",
        resourceType: "PayerTariff",
        resourceId: t.id,
        details: { note: input.note ?? null },
        meta: ctx.meta,
      });
    });
  } catch (e) {
    if (String(e).includes("PayerTariff_no_overlap"))
      throw new ConflictError("Another approved tariff already covers that date range for this service.");
    throw e;
  }
}
