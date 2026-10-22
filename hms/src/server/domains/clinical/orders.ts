import type { OrderKind, OrderStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, requirePermission, type AuthContext } from "../../authz/context";
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { todayLocal } from "@/lib/time";
import type { cancelOrderSchema, placeOrdersSchema } from "@/lib/schemas/clinical";
import { getEncounterAccess, joinCareTeam, loadEncounterFor } from "./access";

/** Allowed status moves per order kind. Results only enter through the lab/imaging services. */
export const ORDER_TRANSITIONS: Record<OrderKind, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  LAB: {
    ORDERED: ["SPECIMEN_COLLECTED", "CANCELLED"],
    SPECIMEN_COLLECTED: ["IN_PROGRESS", "ORDERED", "CANCELLED"], // back to ORDERED = specimen rejected, recollect
    IN_PROGRESS: ["RESULTED", "ORDERED"],
    RESULTED: ["VERIFIED", "IN_PROGRESS"],
    VERIFIED: [],
  },
  IMAGING: {
    ORDERED: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
    SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["RESULTED"],
    RESULTED: ["VERIFIED"],
    VERIFIED: [],
  },
  PROCEDURE: { ORDERED: ["COMPLETED", "CANCELLED"] },
  REFERRAL: { ORDERED: ["COMPLETED", "CANCELLED"] },
};

export function canOrderTransition(kind: OrderKind, from: OrderStatus, to: OrderStatus) {
  return (ORDER_TRANSITIONS[kind][from] ?? []).includes(to);
}

/** Statuses after which an order can no longer be cancelled (work has produced a result). */
export const NON_CANCELLABLE: OrderStatus[] = [
  "IN_PROGRESS",
  "RESULTED",
  "VERIFIED",
  "COMPLETED",
  "CANCELLED",
];

/**
 * Move an order between statuses inside the caller's transaction, with optimistic locking and an
 * append-only status event.
 */
export async function transitionOrder(
  tx: Tx,
  order: { id: string; kind: OrderKind; status: OrderStatus; version: number },
  to: OrderStatus,
  userId: string,
  extra: Record<string, unknown> = {},
  note?: string,
) {
  if (!canOrderTransition(order.kind, order.status, to))
    throw new InvalidTransitionError(order.status, to, "order");
  const r = await tx.serviceOrder.updateMany({
    where: { id: order.id, version: order.version, status: order.status },
    data: { status: to, version: { increment: 1 }, ...extra },
  });
  if (r.count !== 1)
    throw new ConflictError("This order was updated by someone else. Refresh and try again.", "STALE");
  await tx.orderStatusEvent.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: to, changedById: userId, note },
  });
  return order.version + 1;
}

export async function placeOrders(
  ctx: AuthContext,
  input: z.output<typeof placeOrdersSchema>,
  db: DbClient = prisma,
) {
  const { enc } = await loadEncounterFor(
    ctx,
    input.encounterId,
    "clinical.order.create",
    { requireOpen: true },
    db,
  );

  // Idempotency: the same request group submitted twice returns the original orders.
  const existing = await db.serviceOrder.findMany({
    where: { requestGroupId: input.requestGroupId },
    orderBy: { itemIndex: "asc" },
  });
  if (existing.length) {
    if (existing[0]!.encounterId !== enc.id) throw new ConflictError("Duplicate request id.");
    return { orders: existing, replayed: true };
  }

  const labIds = input.items.flatMap((i) => (i.kind === "LAB" ? [i.labTestId] : []));
  const imgIds = input.items.flatMap((i) => (i.kind === "IMAGING" ? [i.imagingStudyId] : []));
  if (new Set(labIds).size !== labIds.length || new Set(imgIds).size !== imgIds.length) {
    throw new ValidationError("The same test or study is listed twice.");
  }
  const [tests, studies] = await Promise.all([
    db.labTestDefinition.findMany({ where: { id: { in: labIds }, active: true } }),
    db.imagingStudyDefinition.findMany({ where: { id: { in: imgIds }, active: true } }),
  ]);
  if (tests.length !== labIds.length || studies.length !== imgIds.length)
    throw new ValidationError("One of the selected items is not available.");

  // Warn-free duplicate guard: the same test already open on this visit.
  const open = await db.serviceOrder.findMany({
    where: {
      encounterId: enc.id,
      status: { notIn: ["CANCELLED", "VERIFIED", "COMPLETED"] },
      OR: [{ labTestId: { in: labIds } }, { imagingStudyId: { in: imgIds } }],
    },
    select: { description: true },
  });
  if (open.length)
    throw new ConflictError(
      `Already ordered on this visit and not yet completed: ${open.map((o) => o.description).join(", ")}.`,
      "DUPLICATE_ORDER",
    );

  try {
    return await withTx(db, async (tx) => {
      const year = Number(todayLocal().slice(0, 4));
      const orders = [];
      for (const [i, item] of input.items.entries()) {
        const description =
          item.kind === "LAB"
            ? tests.find((t) => t.id === item.labTestId)!.name
            : item.kind === "IMAGING"
              ? studies.find((s) => s.id === item.imagingStudyId)!.name
              : item.description;
        const o = await tx.serviceOrder.create({
          data: {
            ref: await nextYearlyRef(tx, "ORD", year),
            requestGroupId: input.requestGroupId,
            itemIndex: i,
            kind: item.kind,
            encounterId: enc.id,
            patientId: enc.patientId,
            branchId: enc.branchId,
            labTestId: item.kind === "LAB" ? item.labTestId : null,
            imagingStudyId: item.kind === "IMAGING" ? item.imagingStudyId : null,
            description,
            priority: input.priority,
            clinicalIndication: input.clinicalIndication,
            notes: input.notes,
            orderedById: ctx.userId,
          },
        });
        await tx.orderStatusEvent.create({
          data: { orderId: o.id, fromStatus: null, toStatus: "ORDERED", changedById: ctx.userId },
        });
        orders.push(o);
      }
      await joinCareTeam(tx, enc, ctx.userId, "CONSULTING");
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "clinical.order.place",
        resourceType: "ServiceOrder",
        resourceId: input.requestGroupId,
        patientId: enc.patientId,
        branchId: enc.branchId,
        details: {
          refs: orders.map((o) => o.ref),
          kinds: orders.map((o) => o.kind),
          priority: input.priority,
        },
        meta: ctx.meta,
      });
      return { orders, replayed: false };
    });
  } catch (e) {
    // A concurrent duplicate submission lost the race on (requestGroupId, itemIndex): return the winner.
    const again = await db.serviceOrder.findMany({
      where: { requestGroupId: input.requestGroupId },
      orderBy: { itemIndex: "asc" },
    });
    if (again.length) return { orders: again, replayed: true };
    throw e;
  }
}

export async function cancelOrder(
  ctx: AuthContext,
  input: z.output<typeof cancelOrderSchema>,
  db: DbClient = prisma,
) {
  const order = await db.serviceOrder.findUnique({
    where: { id: input.orderId },
    include: { encounter: true },
  });
  if (!order) throw new NotFoundError("Order not found.");
  requirePermission(ctx, "clinical.order.cancel", { branchId: order.branchId });
  const access = await getEncounterAccess(ctx, order.encounter, db);
  if (!access) throw new ForbiddenError("No care relationship with this patient.");
  if (NON_CANCELLABLE.includes(order.status)) {
    throw new ConflictError(
      order.status === "CANCELLED"
        ? "Already cancelled."
        : "Work on this order has started or finished; it cannot be cancelled.",
    );
  }
  await withTx(db, async (tx) => {
    await transitionOrder(
      tx,
      order,
      "CANCELLED",
      ctx.userId,
      { cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: input.reason },
      input.reason,
    );
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.order.cancel",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      details: { ref: order.ref, from: order.status },
      meta: ctx.meta,
    });
  });
}

/** The ordering clinician (or a colleague caring for the patient) confirms they have seen the result. */
export async function reviewOrderResult(ctx: AuthContext, orderId: string, db: DbClient = prisma) {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { encounter: true } });
  if (!order) throw new NotFoundError("Order not found.");
  if (!can(ctx, "clinical.results.review", { branchId: order.branchId }))
    throw new ForbiddenError(undefined, "clinical.results.review");
  const access = await getEncounterAccess(ctx, order.encounter, db);
  if (!access) throw new ForbiddenError("No care relationship with this patient.");
  if (order.status !== "VERIFIED" && order.status !== "COMPLETED")
    throw new ConflictError("There is no verified result to review yet.");
  if (order.reviewedAt) throw new ConflictError("Already reviewed.");
  await withTx(db, async (tx) => {
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { reviewedAt: new Date(), reviewedById: ctx.userId, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.result.review",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      meta: ctx.meta,
    });
  });
}

export async function completeSimpleOrder(ctx: AuthContext, orderId: string, db: DbClient = prisma) {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { encounter: true } });
  if (!order) throw new NotFoundError();
  if (order.kind !== "PROCEDURE" && order.kind !== "REFERRAL")
    throw new ConflictError("Lab and imaging orders complete through their departments.");
  requirePermission(ctx, "clinical.note.write", { branchId: order.branchId });
  const access = await getEncounterAccess(ctx, order.encounter, db);
  if (!access) throw new ForbiddenError();
  await withTx(db, async (tx) => {
    await transitionOrder(tx, order, "COMPLETED", ctx.userId, { completedAt: new Date() });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.order.complete",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      meta: ctx.meta,
    });
  });
}
