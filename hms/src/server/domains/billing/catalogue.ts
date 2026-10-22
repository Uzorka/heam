import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { calendarDateToUtcMidnight } from "@/lib/time";
import type { decidePriceSchema, proposePriceSchema, serviceItemSchema } from "@/lib/schemas/billing";

export async function listServiceItems(
  opts: { q?: string; includeInactive?: boolean } = {},
  db: DbClient = prisma,
) {
  const where: Prisma.ServiceItemWhereInput = opts.includeInactive ? {} : { active: true };
  if (opts.q)
    where.OR = [
      { name: { contains: opts.q, mode: "insensitive" } },
      { code: { contains: opts.q, mode: "insensitive" } },
    ];
  return db.serviceItem.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
    include: {
      prices: { where: { status: { in: ["APPROVED", "DRAFT"] } }, orderBy: { effectiveFrom: "desc" } },
    },
  });
}

export async function saveServiceItem(
  ctx: AuthContext,
  input: z.output<typeof serviceItemSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "billing.catalogue.manage");
  const { id, ...rest } = input;
  const data = {
    ...rest,
    labTestId: rest.labTestId ?? null,
    imagingStudyId: rest.imagingStudyId ?? null,
    visitTypeId: rest.visitTypeId ?? null,
    inventoryProductId: rest.inventoryProductId ?? null,
  };
  try {
    return await withTx(db, async (tx) => {
      const item = id
        ? await tx.serviceItem.update({ where: { id }, data })
        : await tx.serviceItem.create({ data });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: id ? "billing.service.update" : "billing.service.create",
        resourceType: "ServiceItem",
        resourceId: item.id,
        details: { code: item.code },
        meta: ctx.meta,
      });
      return item;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError("That code or clinical link is already used by another service.");
    throw e;
  }
}

/** Propose a new effective-dated cash price (DRAFT). Approval is a separate person's decision. */
export async function proposePrice(
  ctx: AuthContext,
  input: z.output<typeof proposePriceSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "billing.catalogue.manage");
  const item = await db.serviceItem.findUnique({ where: { id: input.serviceItemId } });
  if (!item) throw new NotFoundError("Service not found.");
  return withTx(db, async (tx) => {
    const p = await tx.servicePrice.create({
      data: {
        serviceItemId: item.id,
        amountKobo: BigInt(input.amountKobo),
        effectiveFrom: calendarDateToUtcMidnight(input.effectiveFrom),
        reason: input.reason,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "billing.price.propose",
      resourceType: "ServicePrice",
      resourceId: p.id,
      details: { code: item.code, amountKobo: String(input.amountKobo), effectiveFrom: input.effectiveFrom },
      meta: ctx.meta,
    });
    return p;
  });
}

export async function decidePrice(
  ctx: AuthContext,
  input: z.output<typeof decidePriceSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "billing.tariff.approve");
  const p = await db.servicePrice.findUnique({ where: { id: input.id }, include: { serviceItem: true } });
  if (!p) throw new NotFoundError("Price not found.");
  if (p.status !== "DRAFT") throw new ConflictError("This price has already been decided.");
  if (p.createdById === ctx.userId)
    throw new ForbiddenError(
      "Prices must be approved by someone other than the proposer.",
      "billing.tariff.approve",
    );
  try {
    await withTx(db, async (tx) => {
      // Approving a new price ends the current open-ended one the day it starts. Rows starting on or
      // after that date are left alone, so a genuine overlap is rejected by the exclusion constraint.
      if (input.decision === "APPROVE")
        await tx.servicePrice.updateMany({
          where: {
            serviceItemId: p.serviceItemId,
            status: "APPROVED",
            effectiveTo: null,
            effectiveFrom: { lt: p.effectiveFrom },
          },
          data: { effectiveTo: p.effectiveFrom },
        });
      await tx.servicePrice.update({
        where: { id: p.id },
        data: {
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedById: ctx.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: input.decision === "APPROVE" ? "billing.price.approve" : "billing.price.reject",
        resourceType: "ServicePrice",
        resourceId: p.id,
        details: {
          code: p.serviceItem.code,
          amountKobo: p.amountKobo.toString(),
          effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
        },
        meta: ctx.meta,
      });
    });
  } catch (e) {
    if (String(e).includes("ServicePrice_no_overlap"))
      throw new ConflictError("Another approved price already covers that date range for this service.");
    throw e;
  }
}
