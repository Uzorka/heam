import type { PrescriptionItemStatus } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { notifyUsers } from "../../notify";
import { toLocalDateString, todayLocal } from "@/lib/time";
import type { dispenseSchema, reverseDispenseSchema, verifyItemSchema } from "@/lib/schemas/pharmacy";
import { getSetting } from "../settings/system-settings";
import { allocateFefo, lotProblem, postMovement, todayDate } from "../inventory/ledger";
import { activeAllergies, refreshPrescriptionStatus, rxInclude } from "./prescribing";

export type PharmacyTab = "TO_VERIFY" | "QUERIED" | "TO_DISPENSE" | "COMPLETED_TODAY";
const TAB_ITEM_STATUS: Record<Exclude<PharmacyTab, "COMPLETED_TODAY">, PrescriptionItemStatus[]> = {
  TO_VERIFY: ["PENDING"],
  QUERIED: ["QUERIED"],
  TO_DISPENSE: ["VERIFIED", "PARTIALLY_DISPENSED"],
};

/** Pharmacy worklist: patient identity and medicine names only. */
export async function pharmacyQueue(ctx: AuthContext, tab: PharmacyTab, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "pharmacy.queue");
  const since = new Date(Date.now() - 24 * 3_600_000);
  return db.prescription.findMany({
    where:
      tab === "COMPLETED_TODAY"
        ? { branchId, status: "COMPLETED", updatedAt: { gt: since } }
        : { branchId, status: "SIGNED", items: { some: { status: { in: TAB_ITEM_STATUS[tab] } } } },
    orderBy: { signedAt: "asc" },
    take: 200,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      prescriber: { select: { displayName: true } },
      items: {
        select: {
          status: true,
          medication: { select: { genericName: true, strength: true, controlled: true } },
        },
      },
    },
  });
}

export async function pharmacyTabCounts(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "pharmacy.queue");
  const counts = await Promise.all(
    (Object.keys(TAB_ITEM_STATUS) as (keyof typeof TAB_ITEM_STATUS)[]).map(async (tab) => [
      tab,
      await db.prescription.count({
        where: { branchId, status: "SIGNED", items: { some: { status: { in: TAB_ITEM_STATUS[tab] } } } },
      }),
    ]),
  );
  return Object.fromEntries(counts) as Record<keyof typeof TAB_ITEM_STATUS, number>;
}

/**
 * One prescription for pharmacy work: items, recorded allergies (needed for safe dispensing) and
 * usable stock at the branch's pharmacy locations. Viewing is audited.
 */
export async function getPharmacyPrescription(
  ctx: AuthContext,
  prescriptionId: string,
  db: DbClient = prisma,
) {
  const rx = await db.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      ...rxInclude,
      patient: {
        select: {
          id: true,
          mrn: true,
          givenName: true,
          familyName: true,
          sexAtBirth: true,
          dateOfBirth: true,
        },
      },
      encounter: { select: { ref: true } },
    },
  });
  if (!rx || rx.status === "DRAFT") throw new NotFoundError("Prescription not found.");
  if (!can(ctx, "pharmacy.queue", { branchId: rx.branchId }))
    throw new NotFoundError("Prescription not found.");
  const productIds = rx.items.map((i) => i.medication.inventoryProductId);
  const [allergies, locations, balances] = await Promise.all([
    activeAllergies(db, rx.patientId),
    db.stockLocation.findMany({
      where: { branchId: rx.branchId, kind: "PHARMACY", active: true },
      orderBy: { code: "asc" },
    }),
    db.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        location: { branchId: rx.branchId, kind: "PHARMACY", active: true },
        lot: { productId: { in: productIds } },
      },
      include: { lot: true },
      orderBy: [{ lot: { expiryDate: "asc" } }],
    }),
  ]);
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "pharmacy.prescription.view",
    resourceType: "Prescription",
    resourceId: rx.id,
    patientId: rx.patientId,
    meta: ctx.meta,
  });
  const today = todayDate();
  return {
    rx,
    allergies,
    locations,
    stock: balances.map((b) => ({
      productId: b.lot.productId,
      lotId: b.lotId,
      lotNumber: b.lot.lotNumber,
      expiryDate: b.lot.expiryDate,
      locationId: b.locationId,
      quantity: b.quantity,
      problem: lotProblem(b.lot, today),
    })),
  };
}

async function loadItem(
  ctx: AuthContext,
  itemId: string,
  permission: "pharmacy.verify" | "pharmacy.dispense",
  db: DbClient,
) {
  const item = await db.prescriptionItem.findUnique({
    where: { id: itemId },
    include: { prescription: true, medication: true },
  });
  if (!item || item.prescription.status === "DRAFT") throw new NotFoundError("Prescription item not found.");
  if (!can(ctx, "pharmacy.queue", { branchId: item.prescription.branchId }))
    throw new NotFoundError("Prescription item not found.");
  requirePermission(ctx, permission, { branchId: item.prescription.branchId });
  return item;
}

export async function verifyItem(
  ctx: AuthContext,
  input: z.output<typeof verifyItemSchema>,
  db: DbClient = prisma,
) {
  const item = await loadItem(ctx, input.itemId, "pharmacy.verify", db);
  if (item.prescription.status !== "SIGNED")
    throw new ConflictError("This prescription is no longer active.");
  if (!["PENDING", "QUERIED"].includes(item.status))
    throw new ConflictError("This item has already been verified.");
  if (input.decision === "QUERY" && !input.note)
    throw new ValidationError("Explain the query for the prescriber.");
  if (
    item.prescription.prescriberId === ctx.userId &&
    (await getSetting(db, "pharmacy.requireIndependentVerification"))
  )
    throw new ForbiddenError("You cannot verify a prescription you wrote.", "pharmacy.verify");
  await withTx(db, async (tx) => {
    const r = await tx.prescriptionItem.updateMany({
      where: { id: item.id, version: input.version },
      data:
        input.decision === "VERIFY"
          ? {
              status: "VERIFIED",
              verifiedById: ctx.userId,
              verifiedAt: new Date(),
              pharmacistNote: input.note ?? item.pharmacistNote,
              version: { increment: 1 },
            }
          : { status: "QUERIED", pharmacistNote: input.note ?? null, version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictError("This item changed. Refresh and try again.", "STALE");
    if (input.decision === "QUERY")
      await notifyUsers(tx, [item.prescription.prescriberId], "pharmacy.item_queried", {
        prescriptionId: item.prescriptionId,
        encounterId: item.prescription.encounterId,
      });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "VERIFY" ? "pharmacy.item.verify" : "pharmacy.item.query",
      resourceType: "PrescriptionItem",
      resourceId: item.id,
      patientId: item.prescription.patientId,
      details: { ref: item.prescription.ref },
      meta: ctx.meta,
    });
  });
}

/**
 * Dispense against a verified item. Stock comes from usable lots only (expired, quarantined and
 * recalled lots are refused), first-expiry-first-out unless the pharmacist picks a lot. The
 * idempotency key makes a retried request return the original dispense instead of issuing twice.
 */
export async function dispense(
  ctx: AuthContext,
  input: z.output<typeof dispenseSchema>,
  db: DbClient = prisma,
) {
  const prior = await db.dispenseEvent.findMany({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior.length) return { events: prior, duplicate: true };
  const item = await loadItem(ctx, input.itemId, "pharmacy.dispense", db);
  const branchId = item.prescription.branchId;
  if (item.medication.controlled) requirePermission(ctx, "pharmacy.controlled.dispense", { branchId });
  const loc = await db.stockLocation.findUnique({ where: { id: input.locationId } });
  if (!loc || !loc.active || loc.branchId !== branchId || loc.kind !== "PHARMACY")
    throw new ValidationError("Dispense from an active pharmacy location in this branch.");
  const productId = item.medication.inventoryProductId;
  try {
    return await withTx(db, async (tx) => {
      // Lock the item so concurrent dispenses cannot exceed the prescribed quantity.
      const [locked] = await tx.$queryRaw<
        { status: PrescriptionItemStatus; quantity: number; quantityDispensed: number }[]
      >`
        SELECT "status", "quantity", "quantityDispensed" FROM "PrescriptionItem" WHERE "id" = ${item.id}::uuid FOR UPDATE`;
      // A concurrent retry with the same key that won the lock has already dispensed.
      const raced = await tx.dispenseEvent.findMany({ where: { idempotencyKey: input.idempotencyKey } });
      if (raced.length) return { events: raced, duplicate: true };
      const rxNow = await tx.prescription.findUniqueOrThrow({ where: { id: item.prescriptionId } });
      if (rxNow.status !== "SIGNED") throw new ConflictError("This prescription is no longer active.");
      if (!locked || !["VERIFIED", "PARTIALLY_DISPENSED"].includes(locked.status))
        throw new ConflictError("Only pharmacist-verified items can be dispensed.");
      const remaining = locked.quantity - locked.quantityDispensed;
      if (input.quantity > remaining)
        throw new ConflictError(
          `Only ${remaining} ${item.medication.dispensingUnit}(s) remain on this prescription.`,
        );

      let allocation: { lotId: string; quantity: number }[];
      if (input.lotId) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: input.lotId } });
        if (!lot || lot.productId !== productId) throw new ValidationError("That lot is not this medicine.");
        const problem = lotProblem(lot);
        if (problem)
          throw new ConflictError(
            `Lot ${lot.lotNumber} is ${problem} and cannot be dispensed.`,
            "LOT_UNUSABLE",
          );
        allocation = [{ lotId: lot.id, quantity: input.quantity }];
      } else {
        allocation = await allocateFefo(tx, productId, loc.id, input.quantity);
      }

      const events = [];
      for (const a of allocation) {
        const movement = await postMovement(tx, {
          productId,
          lotId: a.lotId,
          locationId: loc.id,
          type: "DISPENSE",
          quantity: -a.quantity,
          referenceType: "PrescriptionItem",
          referenceId: item.id,
          idempotencyKey: `disp:${input.idempotencyKey}:${a.lotId}`,
          userId: ctx.userId,
        });
        events.push(
          await tx.dispenseEvent.create({
            data: {
              itemId: item.id,
              lotId: a.lotId,
              locationId: loc.id,
              quantity: a.quantity,
              dispensedById: ctx.userId,
              counsellingGiven: input.counsellingGiven,
              idempotencyKey: input.idempotencyKey,
              movementId: movement.id,
            },
          }),
        );
      }
      const dispensed = locked.quantityDispensed + input.quantity;
      await tx.prescriptionItem.update({
        where: { id: item.id },
        data: {
          quantityDispensed: dispensed,
          status: dispensed >= locked.quantity ? "DISPENSED" : "PARTIALLY_DISPENSED",
          version: { increment: 1 },
        },
      });
      await refreshPrescriptionStatus(tx, item.prescriptionId);
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: item.medication.controlled ? "pharmacy.dispense.controlled" : "pharmacy.dispense",
        resourceType: "PrescriptionItem",
        resourceId: item.id,
        patientId: item.prescription.patientId,
        details: {
          ref: item.prescription.ref,
          quantity: input.quantity,
          lots: allocation.length,
          location: loc.code,
        },
        meta: ctx.meta,
      });
      return { events, duplicate: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.dispenseEvent.findMany({ where: { idempotencyKey: input.idempotencyKey } });
      if (again.length) return { events: again, duplicate: true };
    }
    throw e;
  }
}

/**
 * Reverse a dispense recorded today (medicine returned unused to the pharmacy). Stock goes back to
 * the same lot and location; the original record is kept with a reversal marker.
 */
export async function reverseDispense(
  ctx: AuthContext,
  input: z.output<typeof reverseDispenseSchema>,
  db: DbClient = prisma,
) {
  const ev = await db.dispenseEvent.findUnique({
    where: { id: input.dispenseId },
    include: { item: { include: { prescription: true, medication: true } }, lot: true },
  });
  if (!ev) throw new NotFoundError("Dispense record not found.");
  const rx = ev.item.prescription;
  if (!can(ctx, "pharmacy.queue", { branchId: rx.branchId }))
    throw new NotFoundError("Dispense record not found.");
  requirePermission(ctx, "pharmacy.dispense", { branchId: rx.branchId });
  if (ev.reversedAt) throw new ConflictError("This dispense has already been reversed.");
  if (toLocalDateString(ev.dispensedAt) !== toLocalDateString(new Date()))
    throw new ConflictError(
      "Only same-day dispenses can be reversed; record older returns as a stock adjustment.",
    );
  if (rx.status === "CANCELLED") throw new ConflictError("This prescription is cancelled.");
  await withTx(db, async (tx) => {
    const [locked] = await tx.$queryRaw<{ quantity: number; quantityDispensed: number }[]>`
      SELECT "quantity", "quantityDispensed" FROM "PrescriptionItem" WHERE "id" = ${ev.itemId}::uuid FOR UPDATE`;
    const r = await tx.dispenseEvent.updateMany({
      where: { id: ev.id, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: ctx.userId, reversalReason: input.reason },
    });
    if (r.count !== 1) throw new ConflictError("This dispense has already been reversed.", "STALE");
    await postMovement(tx, {
      productId: ev.lot.productId,
      lotId: ev.lotId,
      locationId: ev.locationId,
      type: "DISPENSE_REVERSAL",
      quantity: ev.quantity,
      reason: input.reason,
      referenceType: "DispenseEvent",
      referenceId: ev.id,
      idempotencyKey: `rev:${ev.id}`,
      userId: ctx.userId,
    });
    const left = locked!.quantityDispensed - ev.quantity;
    await tx.prescriptionItem.update({
      where: { id: ev.itemId },
      data: {
        quantityDispensed: left,
        status: left > 0 ? "PARTIALLY_DISPENSED" : "VERIFIED",
        version: { increment: 1 },
      },
    });
    if (rx.status === "COMPLETED")
      await tx.prescription.update({
        where: { id: rx.id },
        data: { status: "SIGNED", version: { increment: 1 } },
      });
    await refreshPrescriptionStatus(tx, rx.id);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "pharmacy.dispense.reverse",
      resourceType: "DispenseEvent",
      resourceId: ev.id,
      patientId: rx.patientId,
      details: { ref: rx.ref, quantity: ev.quantity, reason: input.reason },
      meta: ctx.meta,
    });
  });
}

/** Stop supplying the undispensed balance of a partially dispensed item (pharmacist decision). */
export async function closeItem(
  ctx: AuthContext,
  input: { itemId: string; reason: string },
  db: DbClient = prisma,
) {
  const item = await loadItem(ctx, input.itemId, "pharmacy.dispense", db);
  if (!["PENDING", "QUERIED", "VERIFIED", "PARTIALLY_DISPENSED"].includes(item.status))
    throw new ConflictError("This item is already closed.");
  await withTx(db, async (tx) => {
    const r = await tx.prescriptionItem.updateMany({
      where: { id: item.id, version: item.version },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: `Pharmacy: ${input.reason}`,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("This item changed. Refresh and try again.", "STALE");
    await refreshPrescriptionStatus(tx, item.prescriptionId);
    await notifyUsers(tx, [item.prescription.prescriberId], "pharmacy.item_closed", {
      prescriptionId: item.prescriptionId,
      encounterId: item.prescription.encounterId,
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "pharmacy.item.close",
      resourceType: "PrescriptionItem",
      resourceId: item.id,
      patientId: item.prescription.patientId,
      details: { ref: item.prescription.ref, reason: input.reason, dispensed: item.quantityDispensed },
      meta: ctx.meta,
    });
  });
}

/** Usable units per inventory product across a branch's pharmacy locations (for prescribers). */
export async function pharmacyAvailability(branchId: string, db: DbClient = prisma) {
  const rows = await db.$queryRaw<{ productId: string; qty: bigint }[]>`
    SELECT l."productId", SUM(b."quantity")::bigint AS qty
    FROM "StockBalance" b
    JOIN "InventoryLot" l ON l."id" = b."lotId"
    JOIN "StockLocation" s ON s."id" = b."locationId"
    WHERE s."branchId" = ${branchId}::uuid AND s."kind" = 'PHARMACY' AND s."active"
      AND l."status" = 'AVAILABLE' AND (l."expiryDate" IS NULL OR l."expiryDate" > ${todayLocal()}::date)
    GROUP BY l."productId"`;
  return new Map(rows.map((r) => [r.productId, Number(r.qty)]));
}
