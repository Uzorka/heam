import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { branchesWith, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";
import type {
  decideSchema,
  purchaseOrderSchema,
  receiveGoodsSchema,
  requisitionSchema,
  supplierSchema,
} from "@/lib/schemas/inventory";
import { postMovement } from "../inventory/ledger";

const year = () => Number(todayLocal().slice(0, 4));

function branchWhere(ctx: AuthContext) {
  const b = branchesWith(ctx, "inventory.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "inventory.read");
  return b === "ALL" ? {} : { branchId: { in: b } };
}

// ───────────── Suppliers ─────────────

export async function listSuppliers(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "inventory.read");
  return db.supplier.findMany({ orderBy: { name: "asc" } });
}

export async function saveSupplier(
  ctx: AuthContext,
  input: z.output<typeof supplierSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "inventory.po.manage");
  const { id, phone, ...rest } = input;
  const data = {
    ...rest,
    contactName: rest.contactName ?? null,
    email: rest.email ?? null,
    address: rest.address ?? null,
    phoneE164: phone ?? null,
  };
  try {
    return await withTx(db, async (tx) => {
      const s = id ? await tx.supplier.update({ where: { id }, data }) : await tx.supplier.create({ data });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: id ? "procurement.supplier.update" : "procurement.supplier.create",
        resourceType: "Supplier",
        resourceId: s.id,
        meta: ctx.meta,
      });
      return s;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A supplier with this name already exists.");
    throw e;
  }
}

// ───────────── Requisitions ─────────────

export async function createRequisition(
  ctx: AuthContext,
  input: z.output<typeof requisitionSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "inventory.requisition.create", { branchId: input.branchId });
  return withTx(db, async (tx) => {
    const req = await tx.purchaseRequisition.create({
      data: {
        ref: await nextYearlyRef(tx, "REQ", year()),
        branchId: input.branchId,
        justification: input.justification,
        requestedById: ctx.userId,
        items: {
          create: input.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            note: i.note ?? null,
          })),
        },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "procurement.requisition.create",
      resourceType: "PurchaseRequisition",
      resourceId: req.id,
      details: { ref: req.ref, items: input.items.length },
      meta: ctx.meta,
    });
    return req;
  });
}

export async function decideRequisition(
  ctx: AuthContext,
  input: z.output<typeof decideSchema>,
  db: DbClient = prisma,
) {
  const req = await db.purchaseRequisition.findUnique({ where: { id: input.id } });
  if (!req) throw new NotFoundError("Requisition not found.");
  requirePermission(ctx, "inventory.requisition.approve", { branchId: req.branchId });
  if (req.status !== "SUBMITTED") throw new ConflictError("This requisition has already been decided.");
  if (req.requestedById === ctx.userId)
    throw new ForbiddenError(
      "Requisitions must be approved by someone other than the requester.",
      "inventory.requisition.approve",
    );
  await withTx(db, async (tx) => {
    const r = await tx.purchaseRequisition.updateMany({
      where: { id: req.id, status: "SUBMITTED" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNotes: input.notes ?? null,
      },
    });
    if (r.count !== 1) throw new ConflictError("This requisition has already been decided.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action:
        input.decision === "APPROVE" ? "procurement.requisition.approve" : "procurement.requisition.reject",
      resourceType: "PurchaseRequisition",
      resourceId: req.id,
      details: { ref: req.ref },
      meta: ctx.meta,
    });
  });
}

export async function listRequisitions(ctx: AuthContext, db: DbClient = prisma) {
  const rows = await db.purchaseRequisition.findMany({
    where: branchWhere(ctx),
    orderBy: { requestedAt: "desc" },
    take: 200,
    include: {
      items: { include: { product: { select: { name: true, sku: true, baseUnit: true } } } },
      branch: { select: { name: true } },
    },
  });
  const users = await db.user.findMany({
    where: { id: { in: rows.flatMap((r) => [r.requestedById, ...(r.decidedById ? [r.decidedById] : [])]) } },
    select: { id: true, displayName: true },
  });
  const name = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? null;
  return rows.map((r) => ({ ...r, requestedBy: name(r.requestedById), decidedBy: name(r.decidedById) }));
}

// ───────────── Purchase orders ─────────────

export async function createPurchaseOrder(
  ctx: AuthContext,
  input: z.output<typeof purchaseOrderSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "inventory.po.manage", { branchId: input.branchId });
  const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier?.active) throw new ValidationError("Choose an active supplier.");
  if (input.requisitionId) {
    const req = await db.purchaseRequisition.findUnique({ where: { id: input.requisitionId } });
    if (!req || req.branchId !== input.branchId) throw new NotFoundError("Requisition not found.");
    if (req.status !== "APPROVED") throw new ConflictError("Only approved requisitions can be ordered.");
  }
  return withTx(db, async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        ref: await nextYearlyRef(tx, "PO", year()),
        supplierId: supplier.id,
        requisitionId: input.requisitionId ?? null,
        branchId: input.branchId,
        createdById: ctx.userId,
        notes: input.notes ?? null,
        items: {
          create: input.items.map((i) => ({
            productId: i.productId,
            quantityOrdered: i.quantity,
            unitCostKobo: BigInt(i.unitCostKobo),
          })),
        },
      },
    });
    if (input.requisitionId) {
      const r = await tx.purchaseRequisition.updateMany({
        where: { id: input.requisitionId, status: "APPROVED" },
        data: { status: "ORDERED" },
      });
      if (r.count !== 1) throw new ConflictError("This requisition was already ordered.", "STALE");
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "procurement.po.create",
      resourceType: "PurchaseOrder",
      resourceId: po.id,
      details: { ref: po.ref, supplier: supplier.name, items: input.items.length },
      meta: ctx.meta,
    });
    return po;
  });
}

async function loadPo(
  ctx: AuthContext,
  id: string,
  permission: "inventory.po.manage" | "inventory.receive" | "inventory.read",
  db: DbClient,
) {
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { product: true } },
      receipts: { orderBy: { receivedAt: "desc" }, include: { lines: true } },
    },
  });
  if (!po) throw new NotFoundError("Purchase order not found.");
  requirePermission(ctx, permission, { branchId: po.branchId });
  return po;
}

export const getPurchaseOrder = (ctx: AuthContext, id: string, db: DbClient = prisma) =>
  loadPo(ctx, id, "inventory.read", db);

export async function listPurchaseOrders(ctx: AuthContext, db: DbClient = prisma) {
  return db.purchaseOrder.findMany({
    where: branchWhere(ctx),
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
  });
}

export async function setPurchaseOrderStatus(
  ctx: AuthContext,
  input: { id: string; version: number; status: "ISSUED" | "CANCELLED" },
  db: DbClient = prisma,
) {
  const po = await loadPo(ctx, input.id, "inventory.po.manage", db);
  const allowed = input.status === "ISSUED" ? po.status === "DRAFT" : ["DRAFT", "ISSUED"].includes(po.status);
  if (!allowed)
    throw new ConflictError(`A ${po.status.toLowerCase()} order cannot be ${input.status.toLowerCase()}.`);
  await withTx(db, async (tx) => {
    const r = await tx.purchaseOrder.updateMany({
      where: { id: po.id, version: input.version },
      data: {
        status: input.status,
        version: { increment: 1 },
        ...(input.status === "ISSUED" ? { issuedById: ctx.userId, issuedAt: new Date() } : {}),
      },
    });
    if (r.count !== 1)
      throw new ConflictError("This order was changed by someone else. Refresh and try again.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.status === "ISSUED" ? "procurement.po.issue" : "procurement.po.cancel",
      resourceType: "PurchaseOrder",
      resourceId: po.id,
      details: { ref: po.ref },
      meta: ctx.meta,
    });
  });
}

/**
 * Goods received note. Creates (or tops up) lots, posts RECEIPT movements and updates the PO.
 * Quarantined lines mark the lot QUARANTINED so it cannot be dispensed until released.
 * The idempotency key makes a retried submission a no-op.
 */
export async function receiveGoods(
  ctx: AuthContext,
  input: z.output<typeof receiveGoodsSchema>,
  db: DbClient = prisma,
) {
  const prior = await db.goodsReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) return { receipt: prior, duplicate: true };
  const po = await loadPo(ctx, input.purchaseOrderId, "inventory.receive", db);
  if (!["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status))
    throw new ConflictError("Goods can only be received against an issued purchase order.");
  const loc = await db.stockLocation.findUnique({ where: { id: input.locationId } });
  if (!loc || !loc.active || loc.branchId !== po.branchId)
    throw new ValidationError("Receive into an active location in the ordering branch.");
  const today = todayLocal();
  for (const line of input.lines) {
    const item = po.items.find((i) => i.id === line.poItemId);
    if (!item) throw new ValidationError("A line does not belong to this purchase order.");
    if (item.product.trackExpiry && !line.expiryDate)
      throw new ValidationError(`Enter the expiry date for ${item.product.name}.`);
    if (line.expiryDate && line.expiryDate <= today)
      throw new ValidationError(
        `${item.product.name} lot ${line.lotNumber} is already expired; do not receive it.`,
      );
  }
  try {
    return await withTx(db, async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          ref: await nextYearlyRef(tx, "GRN", year()),
          purchaseOrderId: po.id,
          locationId: loc.id,
          receivedById: ctx.userId,
          deliveryNote: input.deliveryNote ?? null,
          idempotencyKey: input.idempotencyKey,
        },
      });
      for (const line of input.lines) {
        const item = po.items.find((i) => i.id === line.poItemId)!;
        const r = await tx.purchaseOrderItem.updateMany({
          where: { id: item.id, quantityReceived: { lte: item.quantityOrdered - line.quantity } },
          data: { quantityReceived: { increment: line.quantity } },
        });
        if (r.count !== 1)
          throw new ConflictError(
            `Receiving ${line.quantity} of ${item.product.name} would exceed the quantity ordered.`,
          );
        const expiryDate = line.expiryDate ? calendarDateToUtcMidnight(line.expiryDate) : null;
        let lot = await tx.inventoryLot.findUnique({
          where: { productId_lotNumber: { productId: item.productId, lotNumber: line.lotNumber } },
        });
        if (lot) {
          if ((lot.expiryDate?.getTime() ?? null) !== (expiryDate?.getTime() ?? null))
            throw new ConflictError(
              `Lot ${line.lotNumber} is already on file with a different expiry date. Check the batch.`,
            );
          if (lot.status === "RECALLED") throw new ConflictError(`Lot ${line.lotNumber} has been recalled.`);
          if (line.quarantine && lot.status !== "QUARANTINED")
            lot = await tx.inventoryLot.update({
              where: { id: lot.id },
              data: { status: "QUARANTINED", statusReason: `Quarantined on receipt ${receipt.ref}` },
            });
        } else {
          lot = await tx.inventoryLot.create({
            data: {
              productId: item.productId,
              lotNumber: line.lotNumber,
              expiryDate,
              manufacturer: line.manufacturer ?? null,
              supplierId: po.supplierId,
              unitCostKobo: item.unitCostKobo,
              status: line.quarantine ? "QUARANTINED" : "AVAILABLE",
              statusReason: line.quarantine ? `Quarantined on receipt ${receipt.ref}` : null,
            },
          });
        }
        await tx.goodsReceiptLine.create({
          data: {
            receiptId: receipt.id,
            poItemId: item.id,
            lotId: lot.id,
            quantity: line.quantity,
            unitCostKobo: item.unitCostKobo,
            quarantined: line.quarantine,
          },
        });
        await postMovement(tx, {
          productId: item.productId,
          lotId: lot.id,
          locationId: loc.id,
          type: "RECEIPT",
          quantity: line.quantity,
          referenceType: "GoodsReceipt",
          referenceId: receipt.id,
          idempotencyKey: `grn:${receipt.id}:${item.id}:${lot.id}`,
          userId: ctx.userId,
        });
      }
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
      const complete = items.every((i) => i.quantityReceived >= i.quantityOrdered);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED", version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "procurement.goods.receive",
        resourceType: "GoodsReceipt",
        resourceId: receipt.id,
        details: { ref: receipt.ref, poRef: po.ref, lines: input.lines.length, location: loc.code },
        meta: ctx.meta,
      });
      return { receipt, duplicate: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.goodsReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return { receipt: again, duplicate: true };
    }
    throw e;
  }
}
