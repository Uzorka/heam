"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  approveCount,
  createLocation,
  decideAdjustment,
  recordCount,
  requestAdjustment,
  saveProduct,
  setLotStatus,
  startCount,
  transferStock,
} from "@/server/domains/inventory/service";
import {
  createPurchaseOrder,
  createRequisition,
  decideRequisition,
  receiveGoods,
  saveSupplier,
  setPurchaseOrderStatus,
} from "@/server/domains/procurement/service";
import {
  adjustmentRequestSchema,
  countLinesSchema,
  decideSchema,
  locationSchema,
  lotStatusSchema,
  productSchema,
  purchaseOrderSchema,
  receiveGoodsSchema,
  requisitionSchema,
  startCountSchema,
  supplierSchema,
  transferSchema,
} from "@/lib/schemas/inventory";
import { uuid } from "@/lib/schemas/common";

const id = <T extends { id: string }>(p: Promise<T>) => p.then((x) => x.id);

export const saveProductAction = defineAction("inventory.product.save", productSchema, async (ctx, i) =>
  id(saveProduct(ctx, i)),
);
export const createLocationAction = defineAction(
  "inventory.location.create",
  locationSchema,
  async (ctx, i) => id(createLocation(ctx, i)),
);
export const transferAction = defineAction("inventory.transfer", transferSchema, transferStock);
export const lotStatusAction = defineAction("inventory.lot.status", lotStatusSchema, setLotStatus);
export const requestAdjustmentAction = defineAction(
  "inventory.adjust.request",
  adjustmentRequestSchema,
  async (ctx, i) => id(requestAdjustment(ctx, i)),
);
export const decideAdjustmentAction = defineAction("inventory.adjust.decide", decideSchema, decideAdjustment);
export const startCountAction = defineAction("inventory.count.start", startCountSchema, async (ctx, i) =>
  id(startCount(ctx, i)),
);
export const recordCountAction = defineAction("inventory.count.record", countLinesSchema, recordCount);
export const approveCountAction = defineAction(
  "inventory.count.approve",
  z.object({ countId: uuid }),
  async (ctx, i) => approveCount(ctx, i.countId),
);
export const saveSupplierAction = defineAction("procurement.supplier.save", supplierSchema, async (ctx, i) =>
  id(saveSupplier(ctx, i)),
);
export const createRequisitionAction = defineAction(
  "procurement.requisition.create",
  requisitionSchema,
  async (ctx, i) => id(createRequisition(ctx, i)),
);
export const decideRequisitionAction = defineAction(
  "procurement.requisition.decide",
  decideSchema,
  decideRequisition,
);
export const createPurchaseOrderAction = defineAction(
  "procurement.po.create",
  purchaseOrderSchema,
  async (ctx, i) => id(createPurchaseOrder(ctx, i)),
);
export const setPurchaseOrderStatusAction = defineAction(
  "procurement.po.status",
  z.object({ id: uuid, version: z.number().int().min(0), status: z.enum(["ISSUED", "CANCELLED"]) }),
  setPurchaseOrderStatus,
);
export const receiveGoodsAction = defineAction(
  "procurement.goods.receive",
  receiveGoodsSchema,
  async (ctx, i) => {
    const r = await receiveGoods(ctx, i);
    return { ref: r.receipt.ref, duplicate: r.duplicate };
  },
);
