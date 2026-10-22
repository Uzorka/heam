import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { sha256 } from "../../crypto";
import { confirmSignature } from "../../auth/reauth";
import { todayLocal } from "@/lib/time";
import type {
  cancelPrescriptionItemSchema,
  createPrescriptionSchema,
  frequencySchema,
  medicationSchema,
} from "@/lib/schemas/pharmacy";
import { isUniqueViolation } from "../../db-errors";
import { careRoleFor, joinCareTeam, loadEncounterFor } from "../clinical/access";

// ───────────── Catalogue ─────────────

export async function listMedications(
  opts: { q?: string; includeInactive?: boolean } = {},
  db: DbClient = prisma,
) {
  const where: Prisma.MedicationProductWhereInput = opts.includeInactive ? {} : { active: true };
  if (opts.q) {
    where.OR = [
      { genericName: { contains: opts.q, mode: "insensitive" } },
      { brandName: { contains: opts.q, mode: "insensitive" } },
    ];
  }
  return db.medicationProduct.findMany({
    where,
    orderBy: [{ genericName: "asc" }, { strength: "asc" }],
    take: 300,
    include: { inventoryProduct: { select: { sku: true, reorderLevel: true, reorderQuantity: true } } },
  });
}

export async function saveMedication(
  ctx: AuthContext,
  input: z.output<typeof medicationSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "pharmacy.catalogue.manage");
  const { id, sku, reorderLevel, reorderQuantity, ...med } = input;
  const label = `${med.genericName} ${med.strength}${med.brandName ? ` (${med.brandName})` : ""}`;
  const medData = {
    ...med,
    brandName: med.brandName ?? null,
    nafdacNumber: med.nafdacNumber ?? null,
  };
  try {
    return await withTx(db, async (tx) => {
      let saved;
      if (id) {
        const existing = await tx.medicationProduct.findUniqueOrThrow({ where: { id } });
        // A changed registration number must be re-verified against the NAFDAC register.
        const nafdacChanged = (existing.nafdacNumber ?? null) !== medData.nafdacNumber;
        saved = await tx.medicationProduct.update({
          where: { id },
          data: { ...medData, ...(nafdacChanged ? { nafdacVerified: false } : {}) },
        });
        await tx.inventoryProduct.update({
          where: { id: existing.inventoryProductId },
          data: { sku, name: label, reorderLevel, reorderQuantity, active: med.active },
        });
      } else {
        const product = await tx.inventoryProduct.create({
          data: {
            sku,
            name: label,
            category: "PHARMACY",
            baseUnit: med.dispensingUnit,
            reorderLevel,
            reorderQuantity,
          },
        });
        saved = await tx.medicationProduct.create({ data: { ...medData, inventoryProductId: product.id } });
      }
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: id ? "pharmacy.medication.update" : "pharmacy.medication.create",
        resourceType: "MedicationProduct",
        resourceId: saved.id,
        details: { sku, label },
        meta: ctx.meta,
      });
      return saved;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A product with this SKU already exists.");
    throw e;
  }
}

export async function listFrequencies(opts: { approvedOnly?: boolean } = {}, db: DbClient = prisma) {
  return db.medicationFrequency.findMany({
    where: opts.approvedOnly ? { status: "APPROVED" } : {},
    orderBy: [{ status: "asc" }, { code: "asc" }],
  });
}

export async function createFrequency(
  ctx: AuthContext,
  input: z.output<typeof frequencySchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "pharmacy.catalogue.manage");
  try {
    return await withTx(db, async (tx) => {
      const f = await tx.medicationFrequency.create({
        data: {
          code: input.code,
          label: input.label,
          timesPerDay: input.timesPerDay ?? null,
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "pharmacy.frequency.create",
        resourceType: "MedicationFrequency",
        resourceId: f.id,
        details: { code: f.code },
        meta: ctx.meta,
      });
      return f;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A frequency with this code already exists.");
    throw e;
  }
}

/** Frequencies are clinical content: a clinician other than the author approves them. */
export async function setFrequencyStatus(
  ctx: AuthContext,
  input: { id: string; status: "APPROVED" | "RETIRED" },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "clinical.rules.approve");
  const f = await db.medicationFrequency.findUnique({ where: { id: input.id } });
  if (!f) throw new NotFoundError("Frequency not found.");
  if (input.status === "APPROVED") {
    if (f.status !== "DRAFT") throw new ConflictError("Only draft frequencies can be approved.");
    if (f.createdById === ctx.userId)
      throw new ForbiddenError(
        "Clinical content must be approved by someone other than its author.",
        "clinical.rules.approve",
      );
  } else if (f.status === "RETIRED") {
    throw new ConflictError("Already retired.");
  }
  await withTx(db, async (tx) => {
    await tx.medicationFrequency.update({
      where: { id: f.id },
      data:
        input.status === "APPROVED"
          ? { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() }
          : { status: "RETIRED" },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.status === "APPROVED" ? "pharmacy.frequency.approve" : "pharmacy.frequency.retire",
      resourceType: "MedicationFrequency",
      resourceId: f.id,
      details: { code: f.code },
      meta: ctx.meta,
    });
  });
}

// ───────────── Prescribing ─────────────

/**
 * Suggested quantity = units per dose x times per day x days, only when the dose is a plain number
 * of dispensing units and the frequency has an approved times-per-day. The prescriber always
 * confirms or overrides it; nothing is calculated silently.
 */
export function suggestQuantity(
  dose: string,
  timesPerDay: number | null,
  durationDays: number | null | undefined,
) {
  const units = Number(dose.trim());
  if (!Number.isFinite(units) || units <= 0 || !timesPerDay || !durationDays) return null;
  const q = Math.ceil(units * timesPerDay * durationDays);
  return q > 0 && q <= 10_000 ? q : null;
}

export function prescriptionHash(
  p: { id: string; encounterId: string; patientId: string; prescriberId: string },
  items: {
    medicationId: string;
    dose: string;
    route: string;
    frequencyId: string;
    durationDays: number | null;
    prn: boolean;
    quantity: number;
    instructions: string | null;
  }[],
  signedAt: Date,
) {
  return sha256(
    JSON.stringify([
      p.id,
      p.encounterId,
      p.patientId,
      p.prescriberId,
      signedAt.toISOString(),
      items.map((i) => [
        i.medicationId,
        i.dose,
        i.route,
        i.frequencyId,
        i.durationDays,
        i.prn,
        i.quantity,
        i.instructions,
      ]),
    ]),
  );
}

export async function activeAllergies(db: DbClient, patientId: string) {
  return db.patientAllergy.findMany({
    where: { patientId, status: "ACTIVE" },
    orderBy: [{ severity: "desc" }, { substance: "asc" }],
    select: { id: true, substance: true, category: true, reaction: true, severity: true, verifiedAt: true },
  });
}

/**
 * Create and sign a prescription in one step (password re-entry is the electronic signature).
 * There is no automated interaction or allergy cross-check: no approved knowledge base is
 * configured, so the prescriber must confirm they reviewed the recorded allergies.
 */
export async function createPrescription(
  ctx: AuthContext,
  input: z.output<typeof createPrescriptionSchema>,
  db: DbClient = prisma,
) {
  const { enc } = await loadEncounterFor(
    ctx,
    input.encounterId,
    "clinical.prescribe",
    { requireOpen: true },
    db,
  );
  const allergies = await activeAllergies(db, enc.patientId);
  if (allergies.length && !input.allergiesReviewed)
    throw new ValidationError("Confirm you have reviewed the patient's recorded allergies before signing.");
  const [meds, freqs] = await Promise.all([
    db.medicationProduct.findMany({ where: { id: { in: input.items.map((i) => i.medicationId) } } }),
    db.medicationFrequency.findMany({ where: { id: { in: input.items.map((i) => i.frequencyId) } } }),
  ]);
  for (const item of input.items) {
    const med = meds.find((m) => m.id === item.medicationId);
    if (!med?.active) throw new ValidationError("A selected medicine is not in the active catalogue.");
    const f = freqs.find((x) => x.id === item.frequencyId);
    if (f?.status !== "APPROVED") throw new ValidationError("Use an approved dose frequency.");
  }
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const signedAt = new Date();
    const items = input.items.map((i) => ({
      medicationId: i.medicationId,
      dose: i.dose,
      route: i.route,
      frequencyId: i.frequencyId,
      durationDays: i.durationDays ?? null,
      prn: i.prn,
      quantity: i.quantity,
      instructions: i.instructions ?? null,
    }));
    const ref = await nextYearlyRef(tx, "RX", Number(todayLocal().slice(0, 4)));
    const draft = await tx.prescription.create({
      data: {
        ref,
        encounterId: enc.id,
        patientId: enc.patientId,
        branchId: enc.branchId,
        prescriberId: ctx.userId,
        notes: input.notes ?? null,
        items: { create: items },
      },
    });
    const contentHash = prescriptionHash(draft, items, signedAt);
    const rx = await tx.prescription.update({
      where: { id: draft.id },
      data: { status: "SIGNED", signedAt, contentHash, version: { increment: 1 } },
    });
    await joinCareTeam(tx, enc, ctx.userId, careRoleFor(ctx));
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.prescription.sign",
      resourceType: "Prescription",
      resourceId: rx.id,
      patientId: enc.patientId,
      details: { ref, items: items.length, contentHash, allergiesOnFile: allergies.length },
      meta: ctx.meta,
    });
    return rx;
  });
}

/** Recompute completion after item changes. Exported for the pharmacy service. */
export async function refreshPrescriptionStatus(tx: Tx, prescriptionId: string) {
  const rx = await tx.prescription.findUniqueOrThrow({
    where: { id: prescriptionId },
    include: { items: true },
  });
  if (rx.status === "DRAFT" || rx.status === "CANCELLED") return;
  const live = rx.items.filter((i) => i.status !== "CANCELLED");
  let next: "SIGNED" | "COMPLETED" | "CANCELLED" = "SIGNED";
  if (live.length === 0) next = rx.items.some((i) => i.quantityDispensed > 0) ? "COMPLETED" : "CANCELLED";
  else if (live.every((i) => i.status === "DISPENSED")) next = "COMPLETED";
  if (next !== rx.status) {
    await tx.prescription.update({
      where: { id: rx.id },
      data: {
        status: next,
        version: { increment: 1 },
        ...(next === "CANCELLED" ? { cancelledAt: new Date(), cancelReason: "All items cancelled" } : {}),
      },
    });
  }
}

/** Cancel an item that has not been dispensed (prescriber, or anyone with order-cancel rights). */
export async function cancelPrescriptionItem(
  ctx: AuthContext,
  input: z.output<typeof cancelPrescriptionItemSchema>,
  db: DbClient = prisma,
) {
  const item = await db.prescriptionItem.findUnique({
    where: { id: input.itemId },
    include: { prescription: true },
  });
  if (!item) throw new NotFoundError("Prescription item not found.");
  const rx = item.prescription;
  const isPrescriber =
    rx.prescriberId === ctx.userId && can(ctx, "clinical.prescribe", { branchId: rx.branchId });
  if (!isPrescriber && !can(ctx, "clinical.order.cancel", { branchId: rx.branchId }))
    throw new ForbiddenError(undefined, "clinical.order.cancel");
  if (!isPrescriber) await loadEncounterFor(ctx, rx.encounterId, "clinical.order.cancel", {}, db);
  if (!["PENDING", "QUERIED", "VERIFIED"].includes(item.status) || item.quantityDispensed > 0)
    throw new ConflictError("Dispensing has started; ask the pharmacy to stop the remaining supply instead.");
  await withTx(db, async (tx) => {
    const r = await tx.prescriptionItem.updateMany({
      where: { id: item.id, version: item.version },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("This item changed. Refresh and try again.", "STALE");
    await refreshPrescriptionStatus(tx, rx.id);
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.prescription.item.cancel",
      resourceType: "PrescriptionItem",
      resourceId: item.id,
      patientId: rx.patientId,
      details: { ref: rx.ref, reason: input.reason },
      meta: ctx.meta,
    });
  });
}

const rxInclude = {
  prescriber: { select: { displayName: true } },
  items: {
    orderBy: { id: "asc" },
    include: {
      medication: true,
      frequency: { select: { code: true, label: true } },
      dispenses: {
        orderBy: { dispensedAt: "asc" },
        include: { lot: { select: { lotNumber: true, expiryDate: true } } },
      },
    },
  },
} satisfies Prisma.PrescriptionInclude;

/** Prescriptions on one visit (encounter access already checked by the caller). */
export async function encounterPrescriptions(encounterId: string, db: DbClient = prisma) {
  return db.prescription.findMany({
    where: { encounterId },
    orderBy: { createdAt: "desc" },
    include: rxInclude,
  });
}

/** Medication history for a chart (record-level access already checked by the caller). */
export async function patientPrescriptions(patientId: string, db: DbClient = prisma) {
  return db.prescription.findMany({
    where: { patientId, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: rxInclude,
  });
}

export { rxInclude };
