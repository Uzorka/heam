/**
 * Phase 3 demo content. FICTIONAL. Medicines use generic names only, with no prices, NAFDAC numbers
 * or brand claims. Dose frequencies are seeded as DRAFT and then given a clearly labelled DEMO
 * approval by the demo medical director so the prescribing flow can be exercised locally; a real
 * deployment must have its own clinicians review and approve them.
 */
import type { PrismaClient } from "@prisma/client";
import { nextYearlyRef } from "../src/server/sequence";
import { postMovement } from "../src/server/domains/inventory/ledger";
import { prescriptionHash } from "../src/server/domains/pharmacy/prescribing";
import { calendarDateToUtcMidnight, todayLocal } from "../src/lib/time";

const FREQUENCIES = [
  { code: "OD", label: "Once daily", timesPerDay: 1 },
  { code: "BD", label: "Twice daily", timesPerDay: 2 },
  { code: "TDS", label: "Three times daily", timesPerDay: 3 },
  { code: "QDS", label: "Four times daily", timesPerDay: 4 },
  { code: "NOCTE", label: "At night", timesPerDay: 1 },
  { code: "STAT", label: "Once, immediately", timesPerDay: null },
  { code: "PRN", label: "When required", timesPerDay: null },
];

const MEDS: {
  sku: string;
  generic: string;
  strength: string;
  form: "TABLET" | "CAPSULE" | "SYRUP" | "INJECTION" | "SUSPENSION";
  route: string;
  unit: string;
  controlled?: boolean;
  reorder: number;
}[] = [
  {
    sku: "DEMO-PCM-500",
    generic: "Paracetamol",
    strength: "500 mg",
    form: "TABLET",
    route: "Oral",
    unit: "tablet",
    reorder: 200,
  },
  {
    sku: "DEMO-AMX-500",
    generic: "Amoxicillin",
    strength: "500 mg",
    form: "CAPSULE",
    route: "Oral",
    unit: "capsule",
    reorder: 100,
  },
  {
    sku: "DEMO-MTZ-400",
    generic: "Metronidazole",
    strength: "400 mg",
    form: "TABLET",
    route: "Oral",
    unit: "tablet",
    reorder: 100,
  },
  {
    sku: "DEMO-ART-LUM",
    generic: "Artemether/Lumefantrine",
    strength: "20/120 mg",
    form: "TABLET",
    route: "Oral",
    unit: "tablet",
    reorder: 96,
  },
  {
    sku: "DEMO-FES-200",
    generic: "Ferrous sulphate",
    strength: "200 mg",
    form: "TABLET",
    route: "Oral",
    unit: "tablet",
    reorder: 150,
  },
  {
    sku: "DEMO-FOL-5",
    generic: "Folic acid",
    strength: "5 mg",
    form: "TABLET",
    route: "Oral",
    unit: "tablet",
    reorder: 150,
  },
  {
    sku: "DEMO-ORS-SAC",
    generic: "Oral rehydration salts",
    strength: "20.5 g sachet",
    form: "SUSPENSION",
    route: "Oral",
    unit: "sachet",
    reorder: 50,
  },
  {
    sku: "DEMO-OXY-10",
    generic: "Oxytocin",
    strength: "10 IU/mL",
    form: "INJECTION",
    route: "IM/IV",
    unit: "ampoule",
    reorder: 30,
  },
  {
    sku: "DEMO-PCM-SYR",
    generic: "Paracetamol",
    strength: "120 mg/5 mL",
    form: "SYRUP",
    route: "Oral",
    unit: "bottle",
    reorder: 20,
  },
  {
    sku: "DEMO-TRM-50",
    generic: "Tramadol",
    strength: "50 mg",
    form: "CAPSULE",
    route: "Oral",
    unit: "capsule",
    controlled: true,
    reorder: 50,
  },
];

const SUPPLIES = [
  {
    sku: "DEMO-GLV-M",
    name: "DEMO Examination gloves, medium (box of 100)",
    category: "MEDICAL_SUPPLY" as const,
    unit: "box",
    reorder: 10,
    expiry: true,
  },
  {
    sku: "DEMO-SYR-5",
    name: "DEMO Syringe 5 mL",
    category: "MEDICAL_SUPPLY" as const,
    unit: "piece",
    reorder: 200,
    expiry: true,
  },
  {
    sku: "DEMO-EDTA",
    name: "DEMO EDTA blood tube",
    category: "LAB_CONSUMABLE" as const,
    unit: "piece",
    reorder: 100,
    expiry: true,
  },
  {
    sku: "DEMO-A4",
    name: "DEMO A4 paper (ream)",
    category: "OFFICE_MAINTENANCE" as const,
    unit: "ream",
    reorder: 5,
    expiry: false,
  },
];

function inDays(days: number) {
  return new Date(calendarDateToUtcMidnight(todayLocal()).getTime() + days * 86_400_000);
}

export async function seedPharmacy(prisma: PrismaClient, users: Record<string, string>, branchId: string) {
  if ((await prisma.inventoryProduct.count()) > 0) return false;
  const pharmacist = users.pharmacist!;
  const meddir = users.meddir!;
  const store = users.store!;
  const year = Number(todayLocal().slice(0, 4));

  await prisma.$transaction(
    async (tx) => {
      const freqIds: Record<string, string> = {};
      for (const f of FREQUENCIES) {
        const row = await tx.medicationFrequency.create({
          data: {
            code: f.code,
            label: f.label,
            timesPerDay: f.timesPerDay,
            createdById: pharmacist,
            status: "APPROVED",
            approvedById: meddir, // DEMO approval - replace with the hospital's own clinical sign-off
            approvedAt: new Date(),
          },
        });
        freqIds[f.code] = row.id;
      }

      const [mainStore, pharmacy, quarantine] = await Promise.all([
        tx.stockLocation.create({
          data: { branchId, code: "DEMO-STORE", name: "DEMO Main store", kind: "MAIN_STORE" },
        }),
        tx.stockLocation.create({
          data: { branchId, code: "DEMO-PHARM", name: "DEMO Outpatient pharmacy", kind: "PHARMACY" },
        }),
        tx.stockLocation.create({
          data: { branchId, code: "DEMO-QUAR", name: "DEMO Quarantine shelf", kind: "QUARANTINE" },
        }),
      ]);
      const supplier = await tx.supplier.create({
        data: {
          name: "DEMO Supplier (fictional)",
          contactName: "Demo contact",
          email: "orders@supplier.demo.test",
        },
      });

      const medIds: Record<string, { id: string; productId: string }> = {};
      for (const m of MEDS) {
        const product = await tx.inventoryProduct.create({
          data: {
            sku: m.sku,
            name: `${m.generic} ${m.strength}`,
            category: "PHARMACY",
            baseUnit: m.unit,
            reorderLevel: m.reorder,
            reorderQuantity: m.reorder * 2,
          },
        });
        const med = await tx.medicationProduct.create({
          data: {
            inventoryProductId: product.id,
            genericName: m.generic,
            strength: m.strength,
            form: m.form,
            defaultRoute: m.route,
            dispensingUnit: m.unit,
            controlled: !!m.controlled,
          },
        });
        medIds[m.sku] = { id: med.id, productId: product.id };
      }
      for (const s of SUPPLIES) {
        const product = await tx.inventoryProduct.create({
          data: {
            sku: s.sku,
            name: s.name,
            category: s.category,
            baseUnit: s.unit,
            reorderLevel: s.reorder,
            trackExpiry: s.expiry,
          },
        });
        const lot = await tx.inventoryLot.create({
          data: {
            productId: product.id,
            lotNumber: `DEMO-${s.sku.slice(5)}-01`,
            expiryDate: s.expiry ? inDays(540) : null,
            supplierId: supplier.id,
          },
        });
        await postMovement(tx, {
          productId: product.id,
          lotId: lot.id,
          locationId: mainStore.id,
          type: "RECEIPT",
          quantity: s.reorder * 3,
          reason: "Demo opening stock",
          userId: store,
        });
      }

      // Lots: a healthy lot for every medicine, plus deliberate edge cases for the demo.
      let n = 0;
      for (const m of MEDS) {
        n++;
        const { productId } = medIds[m.sku]!;
        const main = await tx.inventoryLot.create({
          data: {
            productId,
            lotNumber: `DEMO-L${String(n).padStart(2, "0")}A`,
            expiryDate: inDays(400 + n * 10),
            supplierId: supplier.id,
          },
        });
        const qty = m.sku === "DEMO-FOL-5" ? Math.floor(m.reorder / 2) : m.reorder * 2; // folic acid below reorder level
        await postMovement(tx, {
          productId,
          lotId: main.id,
          locationId: pharmacy.id,
          type: "RECEIPT",
          quantity: qty,
          reason: "Demo opening stock",
          userId: store,
        });
        if (m.sku !== "DEMO-FOL-5")
          await postMovement(tx, {
            productId,
            lotId: main.id,
            locationId: mainStore.id,
            type: "RECEIPT",
            quantity: m.reorder * 3,
            reason: "Demo opening stock",
            userId: store,
          });
      }
      const pcm = medIds["DEMO-PCM-500"]!.productId;
      const near = await tx.inventoryLot.create({
        data: { productId: pcm, lotNumber: "DEMO-PCM-NEAR", expiryDate: inDays(45), supplierId: supplier.id },
      });
      await postMovement(tx, {
        productId: pcm,
        lotId: near.id,
        locationId: pharmacy.id,
        type: "RECEIPT",
        quantity: 60,
        reason: "Demo: near-expiry lot (dispensed first)",
        userId: store,
      });
      const expired = await tx.inventoryLot.create({
        data: { productId: pcm, lotNumber: "DEMO-PCM-EXP", expiryDate: inDays(-5), supplierId: supplier.id },
      });
      await postMovement(tx, {
        productId: pcm,
        lotId: expired.id,
        locationId: pharmacy.id,
        type: "RECEIPT",
        quantity: 40,
        reason: "Demo: expired lot (blocked)",
        userId: store,
      });
      const amx = medIds["DEMO-AMX-500"]!.productId;
      const quarantined = await tx.inventoryLot.create({
        data: {
          productId: amx,
          lotNumber: "DEMO-AMX-QUAR",
          expiryDate: inDays(300),
          supplierId: supplier.id,
          status: "QUARANTINED",
          statusReason: "Demo: damaged outer cartons, awaiting inspection",
        },
      });
      await postMovement(tx, {
        productId: amx,
        lotId: quarantined.id,
        locationId: quarantine.id,
        type: "RECEIPT",
        quantity: 30,
        reason: "Demo: quarantined lot",
        userId: store,
      });

      // A submitted requisition awaiting approval by finance.
      await tx.purchaseRequisition.create({
        data: {
          ref: await nextYearlyRef(tx, "REQ", year),
          branchId,
          justification: "DEMO: folic acid below reorder level",
          requestedById: store,
          items: { create: [{ productId: medIds["DEMO-FOL-5"]!.productId, quantity: 300 }] },
        },
      });

      // A signed prescription waiting for pharmacist verification (demo patient with an open visit).
      const tunde = await tx.patient.findFirst({
        where: { isDemo: true, givenName: "Tunde", familyName: "Bakare" },
      });
      const enc = tunde
        ? await tx.encounter.findFirst({ where: { patientId: tunde.id, status: "OPEN" } })
        : null;
      if (tunde && enc) {
        const lines = [
          {
            medicationId: medIds["DEMO-ART-LUM"]!.id,
            dose: "4",
            route: "Oral",
            frequencyId: freqIds.BD!,
            durationDays: 3,
            prn: false,
            quantity: 24,
            instructions: "Take with food or milk",
          },
          {
            medicationId: medIds["DEMO-PCM-500"]!.id,
            dose: "2",
            route: "Oral",
            frequencyId: freqIds.TDS!,
            durationDays: 3,
            prn: false,
            quantity: 18,
            instructions: null,
          },
        ];
        const draft = await tx.prescription.create({
          data: {
            ref: await nextYearlyRef(tx, "RX", year),
            encounterId: enc.id,
            patientId: tunde.id,
            branchId: enc.branchId,
            prescriberId: users.doctor!,
            items: { create: lines },
          },
        });
        const signedAt = new Date();
        await tx.prescription.update({
          where: { id: draft.id },
          data: {
            status: "SIGNED",
            signedAt,
            contentHash: prescriptionHash(draft, lines, signedAt),
            version: { increment: 1 },
          },
        });
      }
    },
    { timeout: 60_000 },
  );
  return true;
}
