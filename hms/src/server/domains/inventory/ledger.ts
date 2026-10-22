import type { StockMovementType } from "@prisma/client";
import type { Tx } from "../../db";
import { ConflictError } from "../../errors";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";

export interface MovementInput {
  productId: string;
  lotId: string;
  locationId: string;
  type: StockMovementType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  userId: string;
}

/**
 * The only way stock changes. Locks the lot/location balance row, refuses to go negative, writes an
 * append-only ledger row with the resulting balance, and updates the balance - all in the caller's
 * transaction.
 */
export async function postMovement(tx: Tx, m: MovementInput) {
  if (!Number.isInteger(m.quantity) || m.quantity === 0)
    throw new ConflictError("Stock quantities must be whole, non-zero numbers.");
  await tx.$executeRaw`
    INSERT INTO "StockBalance" ("lotId", "locationId", "quantity", "updatedAt")
    VALUES (${m.lotId}::uuid, ${m.locationId}::uuid, 0, now())
    ON CONFLICT ("lotId", "locationId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT "quantity" FROM "StockBalance" WHERE "lotId" = ${m.lotId}::uuid AND "locationId" = ${m.locationId}::uuid FOR UPDATE`;
  const before = rows[0]?.quantity ?? 0;
  const after = before + m.quantity;
  if (after < 0)
    throw new ConflictError(
      `Insufficient stock: ${before} available, ${-m.quantity} requested.`,
      "INSUFFICIENT_STOCK",
    );
  await tx.stockBalance.update({
    where: { lotId_locationId: { lotId: m.lotId, locationId: m.locationId } },
    data: { quantity: after },
  });
  return tx.stockMovement.create({
    data: {
      productId: m.productId,
      lotId: m.lotId,
      locationId: m.locationId,
      type: m.type,
      quantity: m.quantity,
      balanceAfter: after,
      reason: m.reason ?? null,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      idempotencyKey: m.idempotencyKey ?? null,
      performedById: m.userId,
    },
  });
}

/** Today's date in Lagos as a UTC-midnight Date, comparable with Postgres DATE columns. */
export function todayDate(now = new Date()): Date {
  return calendarDateToUtcMidnight(todayLocal(now));
}

/** A lot is usable when AVAILABLE and not expired. It is unusable from its expiry date onward. */
export function lotUsable(
  lot: { status: string; expiryDate: Date | null },
  today: Date = todayDate(),
): boolean {
  return lot.status === "AVAILABLE" && (lot.expiryDate === null || lot.expiryDate > today);
}

export function lotProblem(
  lot: { status: string; expiryDate: Date | null },
  today: Date = todayDate(),
): string | null {
  if (lot.status === "RECALLED") return "recalled";
  if (lot.status === "QUARANTINED") return "quarantined";
  if (lot.expiryDate !== null && lot.expiryDate <= today) return "expired";
  return null;
}

/**
 * First-expiry-first-out allocation of `quantity` from usable lots at a location (locked).
 * Returns the allocation or throws if there is not enough usable stock.
 */
export async function allocateFefo(tx: Tx, productId: string, locationId: string, quantity: number) {
  const today = todayLocal();
  const rows = await tx.$queryRaw<{ lotId: string; quantity: number; expiryDate: Date | null }[]>`
    SELECT b."lotId", b."quantity", l."expiryDate"
    FROM "StockBalance" b JOIN "InventoryLot" l ON l."id" = b."lotId"
    WHERE l."productId" = ${productId}::uuid AND b."locationId" = ${locationId}::uuid AND b."quantity" > 0
      AND l."status" = 'AVAILABLE' AND (l."expiryDate" IS NULL OR l."expiryDate" > ${today}::date)
    ORDER BY l."expiryDate" ASC NULLS LAST, l."receivedAt" ASC
    FOR UPDATE OF b`;
  const allocation: { lotId: string; quantity: number }[] = [];
  let remaining = quantity;
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(r.quantity, remaining);
    allocation.push({ lotId: r.lotId, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new ConflictError(
      `Not enough usable stock: ${quantity - remaining} available (expired, recalled and quarantined lots excluded).`,
      "INSUFFICIENT_STOCK",
    );
  }
  return allocation;
}
