import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";
import {
  createPrescription,
  cancelPrescriptionItem,
  setFrequencyStatus,
  createFrequency,
} from "@/server/domains/pharmacy/prescribing";
import { closeItem, dispense, reverseDispense, verifyItem } from "@/server/domains/pharmacy/service";
import {
  approveCount,
  decideAdjustment,
  recordCount,
  requestAdjustment,
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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { TEST_PASSWORD, branch, newPatient, uniq, userCtx, visitInConsultation } from "./helpers";

function addDays(days: number) {
  const d = calendarDateToUtcMidnight(todayLocal());
  return new Date(d.getTime() + days * 86_400_000);
}

async function location(kind: "PHARMACY" | "MAIN_STORE" | "QUARANTINE" = "PHARMACY") {
  const b = await branch();
  return prisma.stockLocation.create({
    data: { branchId: b.id, code: uniq("L").slice(0, 20).toUpperCase(), name: `Test ${kind}`, kind },
  });
}

async function medication(opts: { controlled?: boolean } = {}) {
  const product = await prisma.inventoryProduct.create({
    data: {
      sku: uniq("SKU").toUpperCase().slice(0, 30),
      name: uniq("Med"),
      category: "PHARMACY",
      baseUnit: "tablet",
      reorderLevel: 10,
    },
  });
  return prisma.medicationProduct.create({
    data: {
      inventoryProductId: product.id,
      genericName: uniq("Generic"),
      strength: "500 mg",
      form: "TABLET",
      defaultRoute: "Oral",
      dispensingUnit: "tablet",
      controlled: !!opts.controlled,
    },
  });
}

async function approvedFrequency() {
  const { ctx: author } = await userCtx(["PHARMACIST", "MEDICAL_DIRECTOR"]);
  const { ctx: approver } = await userCtx(["MEDICAL_DIRECTOR"]);
  const f = await createFrequency(author, {
    code: uniq("F").toUpperCase().slice(0, 20),
    label: "Twice daily",
    timesPerDay: 2,
  });
  await setFrequencyStatus(approver, { id: f.id, status: "APPROVED" });
  return f;
}

/** Stock a lot directly through the ledger-backed receipt path used by fixtures. */
async function lot(
  productId: string,
  locationId: string,
  quantity: number,
  opts: { expiry?: Date | null; status?: "AVAILABLE" | "QUARANTINED" | "RECALLED" } = {},
) {
  const l = await prisma.inventoryLot.create({
    data: {
      productId,
      lotNumber: uniq("LOT"),
      expiryDate: opts.expiry === undefined ? addDays(365) : opts.expiry,
      status: opts.status ?? "AVAILABLE",
    },
  });
  const { user } = await userCtx(["STOREKEEPER"]);
  await prisma.$transaction(async (tx) => {
    const { postMovement } = await import("@/server/domains/inventory/ledger");
    await postMovement(tx, {
      productId,
      lotId: l.id,
      locationId,
      type: "RECEIPT",
      quantity,
      userId: user.id,
    });
  });
  return l;
}

const balance = async (lotId: string, locationId: string) =>
  (await prisma.stockBalance.findUnique({ where: { lotId_locationId: { lotId, locationId } } }))?.quantity ??
  0;

async function signedRx(
  quantity = 10,
  opts: { controlled?: boolean; withAllergy?: boolean; med?: Awaited<ReturnType<typeof medication>> } = {},
) {
  const { ctx: reception } = await userCtx(["RECEPTION"]);
  const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
  const p = await newPatient(reception);
  const enc = await visitInConsultation(reception, doctor, p.patientId);
  if (opts.withAllergy) {
    await prisma.patientAllergy.create({
      data: {
        patientId: p.patientId,
        substance: "Penicillin",
        category: "DRUG",
        source: "PATIENT_REPORTED",
        recordedById: doctor.userId,
      },
    });
  }
  const med = opts.med ?? (await medication({ controlled: opts.controlled }));
  const freq = await approvedFrequency();
  const rx = await createPrescription(doctor, {
    encounterId: enc.id,
    items: [
      {
        medicationId: med.id,
        dose: "1",
        route: "Oral",
        frequencyId: freq.id,
        durationDays: 5,
        prn: false,
        quantity,
      },
    ],
    password: TEST_PASSWORD,
    allergiesReviewed: !!opts.withAllergy,
  });
  const item = await prisma.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
  return { reception, doctor, p, enc, med, freq, rx, item };
}

async function verified(quantity = 10, opts: Parameters<typeof signedRx>[1] = {}) {
  const base = await signedRx(quantity, opts);
  const { ctx: pharmacist } = await userCtx(["PHARMACIST"]);
  await verifyItem(pharmacist, { itemId: base.item.id, version: base.item.version, decision: "VERIFY" });
  return { ...base, pharmacist };
}

describe("prescribing", () => {
  it("signs with password, stores a content hash and refuses draft frequencies", async () => {
    const { rx } = await signedRx();
    expect(rx.status).toBe("SIGNED");
    expect(rx.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Signed prescriptions cannot be edited at the database level.
    await expect(
      prisma.prescription.update({ where: { id: rx.id }, data: { notes: "changed" } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.prescriptionItem.updateMany({ where: { prescriptionId: rx.id }, data: { dose: "2" } }),
    ).rejects.toThrow(/cannot change/);

    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const p = await newPatient(reception);
    const enc = await visitInConsultation(reception, doctor, p.patientId);
    const med = await medication();
    const draft = await prisma.medicationFrequency.create({
      data: { code: uniq("D").toUpperCase().slice(0, 20), label: "Draft" },
    });
    await expect(
      createPrescription(doctor, {
        encounterId: enc.id,
        items: [
          { medicationId: med.id, dose: "1", route: "Oral", frequencyId: draft.id, prn: false, quantity: 5 },
        ],
        password: TEST_PASSWORD,
        allergiesReviewed: false,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires the allergy list to be acknowledged and a correct password", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const p = await newPatient(reception);
    const enc = await visitInConsultation(reception, doctor, p.patientId);
    await prisma.patientAllergy.create({
      data: {
        patientId: p.patientId,
        substance: "Sulfonamides",
        category: "DRUG",
        source: "PATIENT_REPORTED",
        recordedById: doctor.userId,
      },
    });
    const med = await medication();
    const freq = await approvedFrequency();
    const input = {
      encounterId: enc.id,
      items: [
        { medicationId: med.id, dose: "1", route: "Oral", frequencyId: freq.id, prn: false, quantity: 5 },
      ],
      password: TEST_PASSWORD,
      allergiesReviewed: false,
    };
    await expect(createPrescription(doctor, input)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createPrescription(doctor, { ...input, allergiesReviewed: true, password: "wrong-password" }),
    ).rejects.toThrow();
    const ok = await createPrescription(doctor, { ...input, allergiesReviewed: true });
    expect(ok.status).toBe("SIGNED");
  });

  it("does not let non-prescribers sign prescriptions", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const { ctx: nurse } = await userCtx(["NURSE"]);
    const p = await newPatient(reception);
    const enc = await visitInConsultation(reception, doctor, p.patientId);
    const med = await medication();
    const freq = await approvedFrequency();
    await expect(
      createPrescription(nurse, {
        encounterId: enc.id,
        items: [
          { medicationId: med.id, dose: "1", route: "Oral", frequencyId: freq.id, prn: false, quantity: 5 },
        ],
        password: TEST_PASSWORD,
        allergiesReviewed: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("frequencies need approval by someone other than the author", async () => {
    const { ctx: md } = await userCtx(["MEDICAL_DIRECTOR"]);
    const f = await createFrequency(md, {
      code: uniq("Q").toUpperCase().slice(0, 20),
      label: "Every 8 hours",
      timesPerDay: 3,
    });
    await expect(setFrequencyStatus(md, { id: f.id, status: "APPROVED" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("pharmacy verification", () => {
  it("unverified items cannot be dispensed and prescribers cannot verify their own prescriptions", async () => {
    const { item, doctor, med } = await signedRx();
    const loc = await location();
    await lot(med.inventoryProductId, loc.id, 50);
    const { ctx: pharmacist } = await userCtx(["PHARMACIST"]);
    await expect(
      dispense(pharmacist, {
        itemId: item.id,
        locationId: loc.id,
        quantity: 5,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // A prescriber without pharmacy rights cannot even see the pharmacy record.
    await expect(
      verifyItem(doctor, { itemId: item.id, version: item.version, decision: "VERIFY" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a user holding both roles cannot verify their own prescription", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: both } = await userCtx(["PHYSICIAN", "PHARMACIST"]);
    const p = await newPatient(reception);
    const enc = await visitInConsultation(reception, both, p.patientId);
    const med = await medication();
    const freq = await approvedFrequency();
    const rx = await createPrescription(both, {
      encounterId: enc.id,
      items: [
        { medicationId: med.id, dose: "1", route: "Oral", frequencyId: freq.id, prn: false, quantity: 5 },
      ],
      password: TEST_PASSWORD,
      allergiesReviewed: false,
    });
    const item = await prisma.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
    await expect(
      verifyItem(both, { itemId: item.id, version: item.version, decision: "VERIFY" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a query notifies the prescriber and needs a note", async () => {
    const { item, doctor } = await signedRx();
    const { ctx: pharmacist } = await userCtx(["PHARMACIST"]);
    await expect(
      verifyItem(pharmacist, { itemId: item.id, version: item.version, decision: "QUERY" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await verifyItem(pharmacist, {
      itemId: item.id,
      version: item.version,
      decision: "QUERY",
      note: "Please confirm duration",
    });
    const n = await prisma.notification.findFirst({
      where: { userId: doctor.userId, template: "pharmacy.item_queried" },
    });
    expect(n).not.toBeNull();
    expect(JSON.stringify(n!.payload)).not.toContain("duration");
  });
});

describe("dispensing (acceptance criteria 8 and 9)", () => {
  it("AC8: dispensing updates the earliest-expiring usable lot exactly once, even when retried", async () => {
    const { item, med, pharmacist } = await verified(10);
    const loc = await location();
    const later = await lot(med.inventoryProductId, loc.id, 30, { expiry: addDays(400) });
    const sooner = await lot(med.inventoryProductId, loc.id, 30, { expiry: addDays(60) });
    const key = crypto.randomUUID();
    const input = {
      itemId: item.id,
      locationId: loc.id,
      quantity: 10,
      counsellingGiven: true,
      idempotencyKey: key,
    };

    const first = await dispense(pharmacist, input);
    const retry = await dispense(pharmacist, input);
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(await balance(sooner.id, loc.id)).toBe(20);
    expect(await balance(later.id, loc.id)).toBe(30);
    expect(await prisma.stockMovement.count({ where: { referenceId: item.id, type: "DISPENSE" } })).toBe(1);
    const after = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.quantityDispensed).toBe(10);
    expect(after.status).toBe("DISPENSED");
    expect((await prisma.prescription.findUniqueOrThrow({ where: { id: item.prescriptionId } })).status).toBe(
      "COMPLETED",
    );
  });

  it("AC8: concurrent retries with the same key still dispense once", async () => {
    const { item, med, pharmacist } = await verified(6);
    const loc = await location();
    const l = await lot(med.inventoryProductId, loc.id, 20);
    const input = {
      itemId: item.id,
      locationId: loc.id,
      quantity: 6,
      counsellingGiven: false,
      idempotencyKey: crypto.randomUUID(),
    };
    const results = await Promise.allSettled([
      dispense(pharmacist, input),
      dispense(pharmacist, input),
      dispense(pharmacist, input),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await balance(l.id, loc.id)).toBe(14);
  });

  it("AC9: expired, quarantined and recalled lots cannot be dispensed", async () => {
    const { item, med, pharmacist } = await verified(5);
    const loc = await location();
    const expired = await lot(med.inventoryProductId, loc.id, 50, { expiry: addDays(-1) });
    const expiresToday = await lot(med.inventoryProductId, loc.id, 50, { expiry: addDays(0) });
    const quarantined = await lot(med.inventoryProductId, loc.id, 50, { status: "QUARANTINED" });
    const recalled = await lot(med.inventoryProductId, loc.id, 50, { status: "RECALLED" });
    for (const l of [expired, expiresToday, quarantined, recalled]) {
      await expect(
        dispense(pharmacist, {
          itemId: item.id,
          locationId: loc.id,
          lotId: l.id,
          quantity: 5,
          counsellingGiven: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "LOT_UNUSABLE" });
    }
    // FEFO skips them all, so there is no usable stock.
    await expect(
      dispense(pharmacist, {
        itemId: item.id,
        locationId: loc.id,
        quantity: 5,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    for (const l of [expired, expiresToday, quarantined, recalled])
      expect(await balance(l.id, loc.id)).toBe(50);
  });

  it("partial fills, never more than prescribed, and FEFO spans lots", async () => {
    const { item, med, pharmacist } = await verified(12);
    const loc = await location();
    const a = await lot(med.inventoryProductId, loc.id, 4, { expiry: addDays(30) });
    const b = await lot(med.inventoryProductId, loc.id, 20, { expiry: addDays(90) });
    await dispense(pharmacist, {
      itemId: item.id,
      locationId: loc.id,
      quantity: 7,
      counsellingGiven: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await balance(a.id, loc.id)).toBe(0);
    expect(await balance(b.id, loc.id)).toBe(17);
    expect((await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      "PARTIALLY_DISPENSED",
    );
    await expect(
      dispense(pharmacist, {
        itemId: item.id,
        locationId: loc.id,
        quantity: 6,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("concurrent dispenses against the last stock never drive it negative", async () => {
    const loc = await location();
    const med = await medication();
    const runs = [await verified(8, { med }), await verified(8, { med })] as const;
    const l = await lot(med.inventoryProductId, loc.id, 10);
    const results = await Promise.allSettled([
      dispense(runs[0].pharmacist, {
        itemId: runs[0].item.id,
        locationId: loc.id,
        quantity: 8,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
      dispense(runs[1].pharmacist, {
        itemId: runs[1].item.id,
        locationId: loc.id,
        quantity: 8,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(l.id, loc.id)).toBe(2);
    await expect(
      prisma.stockBalance.update({
        where: { lotId_locationId: { lotId: l.id, locationId: loc.id } },
        data: { quantity: -1 },
      }),
    ).rejects.toThrow(/nonnegative/);
  });

  it("controlled drugs need the controlled-dispensing grant", async () => {
    const { item, med, pharmacist } = await verified(2, { controlled: true });
    const loc = await location();
    await lot(med.inventoryProductId, loc.id, 10);
    await expect(
      dispense(pharmacist, {
        itemId: item.id,
        locationId: loc.id,
        quantity: 2,
        counsellingGiven: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("same-day reversal returns stock to the lot and reopens the item; dispense rows stay immutable", async () => {
    const { item, med, pharmacist } = await verified(5);
    const loc = await location();
    const l = await lot(med.inventoryProductId, loc.id, 10);
    const { events } = await dispense(pharmacist, {
      itemId: item.id,
      locationId: loc.id,
      quantity: 5,
      counsellingGiven: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await reverseDispense(pharmacist, { dispenseId: events[0]!.id, reason: "Returned unopened" });
    expect(await balance(l.id, loc.id)).toBe(10);
    const after = await prisma.prescriptionItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { prescription: true },
    });
    expect(after.status).toBe("VERIFIED");
    expect(after.prescription.status).toBe("SIGNED");
    await expect(
      reverseDispense(pharmacist, { dispenseId: events[0]!.id, reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      prisma.dispenseEvent.update({ where: { id: events[0]!.id }, data: { quantity: 1 } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.stockMovement.deleteMany({ where: { lotId: l.id } })).rejects.toThrow();
  });

  it("prescribers can cancel undispensed items; pharmacy can close a partial supply", async () => {
    const { item, doctor } = await signedRx(5);
    await cancelPrescriptionItem(doctor, { itemId: item.id, reason: "Changed plan" });
    expect((await prisma.prescription.findUniqueOrThrow({ where: { id: item.prescriptionId } })).status).toBe(
      "CANCELLED",
    );

    const v = await verified(10);
    const loc = await location();
    await lot(v.med.inventoryProductId, loc.id, 4);
    await dispense(v.pharmacist, {
      itemId: v.item.id,
      locationId: loc.id,
      quantity: 4,
      counsellingGiven: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(cancelPrescriptionItem(v.doctor, { itemId: v.item.id, reason: "x" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await closeItem(v.pharmacist, { itemId: v.item.id, reason: "Out of stock; patient to buy remainder" });
    expect(
      (await prisma.prescription.findUniqueOrThrow({ where: { id: v.item.prescriptionId } })).status,
    ).toBe("COMPLETED");
  });
});

describe("procurement and stock control", () => {
  it("requisition -> approval by someone else -> PO -> goods receipt creates stock once", async () => {
    const b = await branch();
    const { ctx: store } = await userCtx(["STOREKEEPER"]);
    const { ctx: finance } = await userCtx(["FINANCE"]);
    const med = await medication();
    const loc = await location("MAIN_STORE");
    const supplier = await saveSupplier(store, { name: uniq("Supplier"), active: true });
    const req = await createRequisition(store, {
      branchId: b.id,
      justification: "Below reorder level",
      items: [{ productId: med.inventoryProductId, quantity: 100 }],
    });
    await expect(decideRequisition(store, { id: req.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideRequisition(finance, { id: req.id, decision: "APPROVE" });
    const po = await createPurchaseOrder(store, {
      requisitionId: req.id,
      branchId: b.id,
      supplierId: supplier.id,
      items: [{ productId: med.inventoryProductId, quantity: 100, unitCostKobo: 2500 }],
    });
    const poItem = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    const key = crypto.randomUUID();
    const grn = {
      purchaseOrderId: po.id,
      locationId: loc.id,
      idempotencyKey: key,
      lines: [
        {
          poItemId: poItem.id,
          quantity: 60,
          lotNumber: uniq("B"),
          expiryDate: todayLocal().replace(/^\d{4}/, (y) => String(Number(y) + 2)),
          quarantine: false,
        },
      ],
    };
    await expect(receiveGoods(store, grn)).rejects.toBeInstanceOf(ConflictError); // not issued yet
    await setPurchaseOrderStatus(store, { id: po.id, version: po.version, status: "ISSUED" });
    const r1 = await receiveGoods(store, grn);
    const r2 = await receiveGoods(store, grn);
    expect(r2.duplicate).toBe(true);
    const lotRow = await prisma.inventoryLot.findFirstOrThrow({
      where: { productId: med.inventoryProductId },
    });
    expect(await balance(lotRow.id, loc.id)).toBe(60);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe(
      "PARTIALLY_RECEIVED",
    );
    expect(r1.receipt.ref).toMatch(/^GRN-\d{4}-\d{6}$/);
    // Over-receipt is refused.
    await expect(
      receiveGoods(store, {
        ...grn,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ ...grn.lines[0]!, quantity: 41 }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Expired goods are refused at the door.
    await expect(
      receiveGoods(store, {
        ...grn,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ ...grn.lines[0]!, lotNumber: uniq("X"), quantity: 1, expiryDate: "2020-01-01" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("quarantine on receipt blocks dispensing until an approver releases it", async () => {
    const b = await branch();
    const { ctx: store } = await userCtx(["STOREKEEPER"]);
    const { ctx: finance } = await userCtx(["FINANCE"]);
    const v = await verified(5);
    const pharmacyLoc = await location();
    const supplier = await saveSupplier(store, { name: uniq("Supplier"), active: true });
    const po = await createPurchaseOrder(store, {
      branchId: b.id,
      supplierId: supplier.id,
      items: [{ productId: v.med.inventoryProductId, quantity: 20, unitCostKobo: 1000 }],
    });
    await setPurchaseOrderStatus(store, { id: po.id, version: po.version, status: "ISSUED" });
    const poItem = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    await receiveGoods(store, {
      purchaseOrderId: po.id,
      locationId: pharmacyLoc.id,
      idempotencyKey: crypto.randomUUID(),
      lines: [
        {
          poItemId: poItem.id,
          quantity: 20,
          lotNumber: uniq("Q"),
          expiryDate: "2099-12-31",
          quarantine: true,
        },
      ],
    });
    const dispenseInput = () => ({
      itemId: v.item.id,
      locationId: pharmacyLoc.id,
      quantity: 5,
      counsellingGiven: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(dispense(v.pharmacist, dispenseInput())).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
    const qLot = await prisma.inventoryLot.findFirstOrThrow({
      where: { productId: v.med.inventoryProductId },
    });
    await expect(
      setLotStatus(store, { lotId: qLot.id, status: "AVAILABLE", reason: "QA passed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setLotStatus(finance, { lotId: qLot.id, status: "AVAILABLE", reason: "QA passed" });
    await dispense(v.pharmacist, dispenseInput());
    expect(await balance(qLot.id, pharmacyLoc.id)).toBe(15);
  });

  it("transfers move stock with paired movements; unusable lots only go to quarantine", async () => {
    const { ctx: store } = await userCtx(["STOREKEEPER"]);
    const med = await medication();
    const main = await location("MAIN_STORE");
    const ph = await location("PHARMACY");
    const q = await location("QUARANTINE");
    const good = await lot(med.inventoryProductId, main.id, 50);
    const key = crypto.randomUUID();
    await transferStock(store, {
      lotId: good.id,
      fromLocationId: main.id,
      toLocationId: ph.id,
      quantity: 20,
      idempotencyKey: key,
    });
    expect(
      (
        await transferStock(store, {
          lotId: good.id,
          fromLocationId: main.id,
          toLocationId: ph.id,
          quantity: 20,
          idempotencyKey: key,
        })
      ).duplicate,
    ).toBe(true);
    expect(await balance(good.id, main.id)).toBe(30);
    expect(await balance(good.id, ph.id)).toBe(20);
    await expect(
      transferStock(store, {
        lotId: good.id,
        fromLocationId: main.id,
        toLocationId: ph.id,
        quantity: 31,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const old = await lot(med.inventoryProductId, main.id, 5, { expiry: addDays(-10) });
    await expect(
      transferStock(store, {
        lotId: old.id,
        fromLocationId: main.id,
        toLocationId: ph.id,
        quantity: 5,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LOT_UNUSABLE" });
    await transferStock(store, {
      lotId: old.id,
      fromLocationId: main.id,
      toLocationId: q.id,
      quantity: 5,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await balance(old.id, q.id)).toBe(5);
  });

  it("adjustments and counts need a second person to approve", async () => {
    const { ctx: store } = await userCtx(["STOREKEEPER"]);
    const { ctx: finance } = await userCtx(["FINANCE"]);
    const med = await medication();
    const loc = await location("MAIN_STORE");
    const l = await lot(med.inventoryProductId, loc.id, 40);
    const adj = await requestAdjustment(store, {
      lotId: l.id,
      locationId: loc.id,
      quantityDelta: -3,
      reason: "DAMAGED",
      notes: "Crushed carton",
    });
    expect(await balance(l.id, loc.id)).toBe(40);
    await expect(decideAdjustment(store, { id: adj.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideAdjustment(finance, { id: adj.id, decision: "APPROVE" });
    expect(await balance(l.id, loc.id)).toBe(37);

    const count = await startCount(store, { locationId: loc.id });
    const line = await prisma.stockCountLine.findFirstOrThrow({ where: { countId: count.id, lotId: l.id } });
    expect(line.systemQty).toBe(37);
    await recordCount(store, {
      countId: count.id,
      lines: [{ lineId: line.id, countedQty: 35, varianceNote: "Two missing" }],
      submit: true,
    });
    await expect(approveCount(store, count.id)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await approveCount(finance, count.id);
    expect(r.posted).toBe(1);
    expect(await balance(l.id, loc.id)).toBe(35);
  });
});
