import type { InventoryCategory, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { branchesWith, can, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { todayLocal } from "@/lib/time";
import type {
  adjustmentRequestSchema,
  countLinesSchema,
  decideSchema,
  locationSchema,
  lotStatusSchema,
  productSchema,
  startCountSchema,
  transferSchema,
} from "@/lib/schemas/inventory";
import { getSetting } from "../settings/system-settings";
import { lotProblem, postMovement, todayDate } from "./ledger";

const year = () => Number(todayLocal().slice(0, 4));

function branchFilter(ctx: AuthContext, permission: "inventory.read" = "inventory.read") {
  const b = branchesWith(ctx, permission);
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, permission);
  return b === "ALL" ? {} : { branchId: { in: b } };
}

export async function listLocations(ctx: AuthContext, db: DbClient = prisma) {
  return db.stockLocation.findMany({
    where: { ...branchFilter(ctx), active: true },
    orderBy: [{ branchId: "asc" }, { code: "asc" }],
    include: { branch: { select: { name: true } } },
  });
}

async function loadLocation(
  ctx: AuthContext,
  locationId: string,
  permission: Parameters<typeof can>[1],
  db: DbClient,
) {
  const loc = await db.stockLocation.findUnique({ where: { id: locationId } });
  if (!loc || !loc.active) throw new NotFoundError("Stock location not found.");
  if (!can(ctx, permission, { branchId: loc.branchId })) throw new ForbiddenError(undefined, permission);
  return loc;
}

export async function createLocation(
  ctx: AuthContext,
  input: z.output<typeof locationSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "settings.manage", { branchId: input.branchId });
  try {
    return await withTx(db, async (tx) => {
      const loc = await tx.stockLocation.create({ data: input });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "inventory.location.create",
        resourceType: "StockLocation",
        resourceId: loc.id,
        details: { code: loc.code, kind: loc.kind },
        meta: ctx.meta,
      });
      return loc;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError("A location with this code already exists in the branch.");
    throw e;
  }
}

export async function saveProduct(
  ctx: AuthContext,
  input: z.output<typeof productSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "inventory.po.manage");
  const { id, ...data } = input;
  try {
    return await withTx(db, async (tx) => {
      const product = id
        ? await tx.inventoryProduct.update({ where: { id }, data })
        : await tx.inventoryProduct.create({ data });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: id ? "inventory.product.update" : "inventory.product.create",
        resourceType: "InventoryProduct",
        resourceId: product.id,
        details: { sku: product.sku },
        meta: ctx.meta,
      });
      return product;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A product with this SKU already exists.");
    throw e;
  }
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  baseUnit: string;
  reorderLevel: number;
  usable: number;
  unusable: number;
  nearestExpiry: Date | null;
  nearExpiryQty: number;
  lowStock: boolean;
}

/**
 * Per-product stock across the given locations. "usable" excludes expired, quarantined and
 * recalled lots; low-stock compares usable stock with the product's reorder level.
 */
export async function stockOverview(
  ctx: AuthContext,
  opts: { locationId?: string; q?: string; category?: InventoryCategory; filter?: "low" | "expiring" } = {},
  db: DbClient = prisma,
): Promise<StockRow[]> {
  const where: Prisma.StockBalanceWhereInput = { location: { ...branchFilter(ctx), active: true } };
  if (opts.locationId) where.locationId = opts.locationId;
  const productWhere: Prisma.InventoryProductWhereInput = { active: true };
  if (opts.category) productWhere.category = opts.category;
  if (opts.q) {
    productWhere.OR = [
      { name: { contains: opts.q, mode: "insensitive" } },
      { sku: { contains: opts.q, mode: "insensitive" } },
    ];
  }
  const [products, balances, nearDays] = await Promise.all([
    db.inventoryProduct.findMany({ where: productWhere, orderBy: { name: "asc" }, take: 500 }),
    db.stockBalance.findMany({
      where: { ...where, quantity: { gt: 0 }, lot: { product: productWhere } },
      include: { lot: true },
    }),
    getSetting(db, "inventory.nearExpiryDays"),
  ]);
  const today = todayDate();
  const nearLimit = new Date(today.getTime() + nearDays * 86_400_000);
  const rows = products.map((p): StockRow => {
    const mine = balances.filter((b) => b.lot.productId === p.id);
    let usable = 0;
    let unusable = 0;
    let nearExpiryQty = 0;
    let nearestExpiry: Date | null = null;
    for (const b of mine) {
      if (lotProblem(b.lot, today)) {
        unusable += b.quantity;
        continue;
      }
      usable += b.quantity;
      if (b.lot.expiryDate) {
        if (!nearestExpiry || b.lot.expiryDate < nearestExpiry) nearestExpiry = b.lot.expiryDate;
        if (b.lot.expiryDate <= nearLimit) nearExpiryQty += b.quantity;
      }
    }
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      baseUnit: p.baseUnit,
      reorderLevel: p.reorderLevel,
      usable,
      unusable,
      nearestExpiry,
      nearExpiryQty,
      lowStock: usable <= p.reorderLevel,
    };
  });
  if (opts.filter === "low") return rows.filter((r) => r.lowStock);
  if (opts.filter === "expiring") return rows.filter((r) => r.nearExpiryQty > 0 || r.unusable > 0);
  return rows;
}

/** Product detail: lots with balances per location and the recent ledger. */
export async function productDetail(ctx: AuthContext, productId: string, db: DbClient = prisma) {
  const bf = branchFilter(ctx);
  const product = await db.inventoryProduct.findUnique({
    where: { id: productId },
    include: { medication: true },
  });
  if (!product) throw new NotFoundError("Product not found.");
  const [lots, movements, nearDays] = await Promise.all([
    db.inventoryLot.findMany({
      where: { productId },
      orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
      include: {
        supplier: { select: { name: true } },
        balances: {
          where: { location: bf },
          include: { location: { select: { id: true, code: true, name: true, kind: true } } },
        },
      },
    }),
    db.stockMovement.findMany({
      where: { productId, location: bf },
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: {
        lot: { select: { lotNumber: true } },
        location: { select: { code: true } },
        performedBy: { select: { displayName: true } },
      },
    }),
    getSetting(db, "inventory.nearExpiryDays"),
  ]);
  const today = todayDate();
  return {
    product,
    nearLimit: new Date(today.getTime() + nearDays * 86_400_000),
    lots: lots.map((l) => ({ ...l, problem: lotProblem(l, today) })),
    movements,
  };
}

export async function transferStock(
  ctx: AuthContext,
  input: z.output<typeof transferSchema>,
  db: DbClient = prisma,
) {
  if (input.fromLocationId === input.toLocationId)
    throw new ValidationError("Choose two different locations.");
  const [from, to] = await Promise.all([
    loadLocation(ctx, input.fromLocationId, "inventory.transfer", db),
    loadLocation(ctx, input.toLocationId, "inventory.transfer", db),
  ]);
  const lot = await db.inventoryLot.findUnique({ where: { id: input.lotId } });
  if (!lot) throw new NotFoundError("Lot not found.");
  // Unusable lots may only move into quarantine, never into a dispensing or ward location.
  const problem = lotProblem(lot);
  if (problem && to.kind !== "QUARANTINE")
    throw new ConflictError(
      `This lot is ${problem}; it can only be moved to a quarantine location.`,
      "LOT_UNUSABLE",
    );
  const existing = await db.stockMovement.findUnique({
    where: { idempotencyKey: `${input.idempotencyKey}:out` },
  });
  if (existing) return { duplicate: true };
  try {
    return await withTx(db, async (tx) => {
      const out = await postMovement(tx, {
        productId: lot.productId,
        lotId: lot.id,
        locationId: from.id,
        type: "TRANSFER_OUT",
        quantity: -input.quantity,
        reason: input.reason,
        referenceType: "Transfer",
        referenceId: input.idempotencyKey,
        idempotencyKey: `${input.idempotencyKey}:out`,
        userId: ctx.userId,
      });
      await postMovement(tx, {
        productId: lot.productId,
        lotId: lot.id,
        locationId: to.id,
        type: "TRANSFER_IN",
        quantity: input.quantity,
        reason: input.reason,
        referenceType: "Transfer",
        referenceId: input.idempotencyKey,
        idempotencyKey: `${input.idempotencyKey}:in`,
        userId: ctx.userId,
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "inventory.transfer",
        resourceType: "InventoryLot",
        resourceId: lot.id,
        details: { from: from.code, to: to.code, quantity: input.quantity, movementId: out.id },
        meta: ctx.meta,
      });
      return { duplicate: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { duplicate: true };
    throw e;
  }
}

/**
 * Quarantine or recall a lot (blocks dispensing everywhere), or release it back to AVAILABLE.
 * Releasing needs the approval permission because it puts stock back into use.
 */
export async function setLotStatus(
  ctx: AuthContext,
  input: z.output<typeof lotStatusSchema>,
  db: DbClient = prisma,
) {
  const lot = await db.inventoryLot.findUnique({
    where: { id: input.lotId },
    include: { balances: { include: { location: true } } },
  });
  if (!lot) throw new NotFoundError("Lot not found.");
  const branchIds = [...new Set(lot.balances.map((b) => b.location.branchId))];
  const permission = input.status === "AVAILABLE" ? "inventory.adjust.approve" : "inventory.transfer";
  const allowed = branchIds.length
    ? branchIds.every((b) => can(ctx, permission, { branchId: b }))
    : can(ctx, permission);
  if (!allowed) throw new ForbiddenError(undefined, permission);
  if (lot.status === input.status)
    throw new ConflictError(`The lot is already ${input.status.toLowerCase()}.`);
  if (lot.status === "RECALLED" && input.status === "AVAILABLE")
    throw new ConflictError("Recalled lots cannot be released back into use.");
  await withTx(db, async (tx) => {
    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: { status: input.status, statusReason: input.reason },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "inventory.lot.status",
      resourceType: "InventoryLot",
      resourceId: lot.id,
      details: { from: lot.status, to: input.status, reason: input.reason, lotNumber: lot.lotNumber },
      meta: ctx.meta,
    });
  });
}

// ───────────── Adjustments (two-person) ─────────────

export async function requestAdjustment(
  ctx: AuthContext,
  input: z.output<typeof adjustmentRequestSchema>,
  db: DbClient = prisma,
) {
  const loc = await loadLocation(ctx, input.locationId, "inventory.adjust", db);
  const lot = await db.inventoryLot.findUnique({ where: { id: input.lotId } });
  if (!lot) throw new NotFoundError("Lot not found.");
  if (input.quantityDelta < 0) {
    const bal = await db.stockBalance.findUnique({
      where: { lotId_locationId: { lotId: lot.id, locationId: loc.id } },
    });
    if ((bal?.quantity ?? 0) + input.quantityDelta < 0)
      throw new ConflictError(
        `Only ${bal?.quantity ?? 0} in this location; the adjustment would make stock negative.`,
      );
  }
  return withTx(db, async (tx) => {
    const req = await tx.stockAdjustmentRequest.create({
      data: { ...input, requestedById: ctx.userId },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "inventory.adjust.request",
      resourceType: "StockAdjustmentRequest",
      resourceId: req.id,
      details: {
        lotNumber: lot.lotNumber,
        location: loc.code,
        delta: input.quantityDelta,
        reason: input.reason,
      },
      meta: ctx.meta,
    });
    return req;
  });
}

export async function decideAdjustment(
  ctx: AuthContext,
  input: z.output<typeof decideSchema>,
  db: DbClient = prisma,
) {
  const req = await db.stockAdjustmentRequest.findUnique({ where: { id: input.id } });
  if (!req) throw new NotFoundError("Adjustment request not found.");
  const loc = await loadLocation(ctx, req.locationId, "inventory.adjust.approve", db);
  if (req.status !== "PENDING") throw new ConflictError("This request has already been decided.");
  if (req.requestedById === ctx.userId)
    throw new ForbiddenError(
      "Adjustments must be approved by someone other than the requester.",
      "inventory.adjust.approve",
    );
  const lot = await db.inventoryLot.findUniqueOrThrow({ where: { id: req.lotId } });
  return withTx(db, async (tx) => {
    let movementId: string | null = null;
    if (input.decision === "APPROVE") {
      const m = await postMovement(tx, {
        productId: lot.productId,
        lotId: lot.id,
        locationId: loc.id,
        type: "ADJUSTMENT",
        quantity: req.quantityDelta,
        reason: `${req.reason}: ${req.notes}`,
        referenceType: "StockAdjustmentRequest",
        referenceId: req.id,
        idempotencyKey: `adj:${req.id}`,
        userId: ctx.userId,
      });
      movementId = m.id;
    }
    const r = await tx.stockAdjustmentRequest.updateMany({
      where: { id: req.id, status: "PENDING" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNotes: input.notes ?? null,
        movementId,
      },
    });
    if (r.count !== 1) throw new ConflictError("This request has already been decided.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "inventory.adjust.approve" : "inventory.adjust.reject",
      resourceType: "StockAdjustmentRequest",
      resourceId: req.id,
      details: { delta: req.quantityDelta, movementId },
      meta: ctx.meta,
    });
  });
}

export async function listAdjustments(
  ctx: AuthContext,
  status: "PENDING" | "DECIDED",
  db: DbClient = prisma,
) {
  const bf = branchFilter(ctx);
  const rows = await db.stockAdjustmentRequest.findMany({
    where: status === "PENDING" ? { status: "PENDING" } : { status: { not: "PENDING" } },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  const [lots, locs, users] = await Promise.all([
    db.inventoryLot.findMany({
      where: { id: { in: rows.map((r) => r.lotId) } },
      include: { product: { select: { name: true, sku: true } } },
    }),
    db.stockLocation.findMany({ where: { id: { in: rows.map((r) => r.locationId) }, ...bf } }),
    db.user.findMany({
      where: { id: { in: rows.flatMap((r) => [r.requestedById, r.decidedById ?? r.requestedById]) } },
      select: { id: true, displayName: true },
    }),
  ]);
  return rows
    .filter((r) => locs.some((l) => l.id === r.locationId))
    .map((r) => ({
      ...r,
      lot: lots.find((l) => l.id === r.lotId)!,
      location: locs.find((l) => l.id === r.locationId)!,
      requestedBy: users.find((u) => u.id === r.requestedById)?.displayName ?? "",
      decidedBy: users.find((u) => u.id === r.decidedById)?.displayName ?? null,
    }));
}

// ───────────── Cycle counts ─────────────

export async function startCount(
  ctx: AuthContext,
  input: z.output<typeof startCountSchema>,
  db: DbClient = prisma,
) {
  const loc = await loadLocation(ctx, input.locationId, "inventory.count", db);
  const open = await db.stockCount.findFirst({
    where: { locationId: loc.id, status: { in: ["OPEN", "SUBMITTED"] } },
  });
  if (open) throw new ConflictError(`Count ${open.ref} is already in progress for this location.`);
  return withTx(db, async (tx) => {
    const balances = await tx.stockBalance.findMany({ where: { locationId: loc.id, quantity: { gt: 0 } } });
    const count = await tx.stockCount.create({
      data: {
        ref: await nextYearlyRef(tx, "CNT", year()),
        locationId: loc.id,
        startedById: ctx.userId,
        notes: input.notes ?? null,
        lines: { create: balances.map((b) => ({ lotId: b.lotId, systemQty: b.quantity })) },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "inventory.count.start",
      resourceType: "StockCount",
      resourceId: count.id,
      details: { ref: count.ref, location: loc.code, lines: balances.length },
      meta: ctx.meta,
    });
    return count;
  });
}

export async function getCount(ctx: AuthContext, countId: string, db: DbClient = prisma) {
  const count = await db.stockCount.findUnique({
    where: { id: countId },
    include: { location: true, lines: true },
  });
  if (!count) throw new NotFoundError("Count not found.");
  requirePermission(ctx, "inventory.read", { branchId: count.location.branchId });
  const lots = await db.inventoryLot.findMany({
    where: { id: { in: count.lines.map((l) => l.lotId) } },
    include: { product: { select: { name: true, sku: true, baseUnit: true } } },
  });
  return {
    ...count,
    lines: count.lines
      .map((l) => ({ ...l, lot: lots.find((x) => x.id === l.lotId)! }))
      .sort((a, b) => a.lot.product.name.localeCompare(b.lot.product.name)),
  };
}

export async function listCounts(ctx: AuthContext, db: DbClient = prisma) {
  return db.stockCount.findMany({
    where: { location: branchFilter(ctx) },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { location: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
  });
}

export async function recordCount(
  ctx: AuthContext,
  input: z.output<typeof countLinesSchema>,
  db: DbClient = prisma,
) {
  const count = await db.stockCount.findUnique({
    where: { id: input.countId },
    include: { location: true, lines: true },
  });
  if (!count) throw new NotFoundError("Count not found.");
  requirePermission(ctx, "inventory.count", { branchId: count.location.branchId });
  if (count.status !== "OPEN")
    throw new ConflictError("This count has been submitted and can no longer be edited.");
  await withTx(db, async (tx) => {
    for (const l of input.lines) {
      if (!count.lines.some((x) => x.id === l.lineId))
        throw new ValidationError("Count line does not belong to this count.");
      await tx.stockCountLine.update({
        where: { id: l.lineId },
        data: { countedQty: l.countedQty, varianceNote: l.varianceNote ?? null },
      });
    }
    if (input.submit) {
      const missing = await tx.stockCountLine.count({ where: { countId: count.id, countedQty: null } });
      if (missing) throw new ValidationError(`${missing} line(s) have not been counted yet.`);
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: "SUBMITTED", submittedById: ctx.userId, submittedAt: new Date() },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "inventory.count.submit",
        resourceType: "StockCount",
        resourceId: count.id,
        details: { ref: count.ref },
        meta: ctx.meta,
      });
    }
  });
}

/**
 * Approve a submitted count: each variance (counted - system quantity at the snapshot) posts as a
 * COUNT_ADJUSTMENT. Approver must be someone other than whoever started or submitted the count.
 */
export async function approveCount(ctx: AuthContext, countId: string, db: DbClient = prisma) {
  const count = await db.stockCount.findUnique({
    where: { id: countId },
    include: { location: true, lines: true },
  });
  if (!count) throw new NotFoundError("Count not found.");
  requirePermission(ctx, "inventory.adjust.approve", { branchId: count.location.branchId });
  if (count.status !== "SUBMITTED") throw new ConflictError("Only submitted counts can be approved.");
  if (count.startedById === ctx.userId || count.submittedById === ctx.userId)
    throw new ForbiddenError(
      "A count must be approved by someone who did not perform it.",
      "inventory.adjust.approve",
    );
  const lots = await db.inventoryLot.findMany({ where: { id: { in: count.lines.map((l) => l.lotId) } } });
  return withTx(db, async (tx) => {
    let posted = 0;
    for (const line of count.lines) {
      const delta = (line.countedQty ?? line.systemQty) - line.systemQty;
      if (delta === 0) continue;
      await postMovement(tx, {
        productId: lots.find((l) => l.id === line.lotId)!.productId,
        lotId: line.lotId,
        locationId: count.locationId,
        type: "COUNT_ADJUSTMENT",
        quantity: delta,
        reason: line.varianceNote ?? `Count ${count.ref}`,
        referenceType: "StockCount",
        referenceId: count.id,
        idempotencyKey: `cnt:${line.id}`,
        userId: ctx.userId,
      });
      posted++;
    }
    const r = await tx.stockCount.updateMany({
      where: { id: count.id, status: "SUBMITTED" },
      data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() },
    });
    if (r.count !== 1) throw new ConflictError("This count was already decided.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "inventory.count.approve",
      resourceType: "StockCount",
      resourceId: count.id,
      details: { ref: count.ref, adjustments: posted },
      meta: ctx.meta,
    });
    return { posted };
  });
}

export async function lotsAtLocation(ctx: AuthContext, locationId: string, db: DbClient = prisma) {
  await loadLocation(ctx, locationId, "inventory.read", db);
  const today = todayDate();
  const rows = await db.stockBalance.findMany({
    where: { locationId, quantity: { gt: 0 } },
    include: { lot: { include: { product: { select: { name: true, sku: true, baseUnit: true } } } } },
    orderBy: [{ lot: { expiryDate: "asc" } }],
  });
  return rows.map((r) => ({ ...r, problem: lotProblem(r.lot, today) }));
}
