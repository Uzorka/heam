/**
 * Phase 4 demo content. FICTIONAL PRICES. Every amount here is a DEMO figure for local testing only,
 * recorded with that reason, and must be replaced by the hospital's approved price list before
 * go-live. The three HMOs seen in public provider directories are created as PENDING_VERIFICATION
 * (a listing is not a contract). One clearly fictional payer is active so the HMO flow can be
 * exercised end to end.
 */
import type { PrismaClient } from "@prisma/client";
import { calendarDateToUtcMidnight, todayLocal } from "../src/lib/time";

const DEMO_REASON = "DEMO price for local testing - fictional, replace before go-live";

/** [code, name, category, link, demo naira] */
const SERVICES: [
  string,
  string,
  string,
  { lab?: string; study?: string; visit?: string; sku?: string },
  number,
][] = [
  ["CONS-NEW", "Consultation (new patient)", "CONSULTATION", { visit: "GOPD-NEW" }, 5000],
  ["CONS-FU", "Consultation (follow-up)", "CONSULTATION", { visit: "GOPD-FU" }, 3000],
  ["LAB-FBC", "Full blood count", "LABORATORY", { lab: "FBC" }, 4000],
  ["LAB-MP", "Malaria parasite test", "LABORATORY", { lab: "MP" }, 1500],
  ["LAB-RBS", "Random blood sugar", "LABORATORY", { lab: "RBS" }, 1000],
  ["LAB-URINE", "Urinalysis", "LABORATORY", { lab: "URINE" }, 1500],
  ["IMG-USOBS", "Obstetric ultrasound", "IMAGING", { study: "US-OBS" }, 8000],
  ["IMG-XRLIMB", "X-ray, limb", "IMAGING", { study: "XR-LIMB" }, 7000],
  ["RX-PCM500", "Paracetamol 500 mg (per tablet)", "PHARMACY", { sku: "DEMO-PCM-500" }, 20],
  ["RX-ARTLUM", "Artemether/Lumefantrine (per tablet)", "PHARMACY", { sku: "DEMO-ART-LUM" }, 150],
  ["PROC-DRESS", "Wound dressing", "PROCEDURE", {}, 2500],
];

export async function seedBilling(prisma: PrismaClient, users: Record<string, string>) {
  if ((await prisma.serviceItem.count()) > 0) return false;
  const finance = users.finance!;
  const owner = users.owner!;
  const hmo = users.hmo!;
  const today = todayLocal();
  const yearStart = calendarDateToUtcMidnight(`${today.slice(0, 4)}-01-01`);

  await prisma.$transaction(
    async (tx) => {
      const ids: Record<string, string> = {};
      for (const [code, name, category, link, naira] of SERVICES) {
        const labTestId = link.lab
          ? (await tx.labTestDefinition.findUnique({ where: { code: link.lab } }))?.id
          : undefined;
        const imagingStudyId = link.study
          ? (await tx.imagingStudyDefinition.findUnique({ where: { code: link.study } }))?.id
          : undefined;
        const visitTypeId = link.visit
          ? (await tx.visitType.findUnique({ where: { code: link.visit } }))?.id
          : undefined;
        const inventoryProductId = link.sku
          ? (await tx.inventoryProduct.findUnique({ where: { sku: link.sku } }))?.id
          : undefined;
        const item = await tx.serviceItem.create({
          data: {
            code,
            name,
            category: category as never,
            labTestId: labTestId ?? null,
            imagingStudyId: imagingStudyId ?? null,
            visitTypeId: visitTypeId ?? null,
            inventoryProductId: inventoryProductId ?? null,
          },
        });
        ids[code] = item.id;
        await tx.servicePrice.create({
          data: {
            serviceItemId: item.id,
            amountKobo: BigInt(naira * 100),
            effectiveFrom: yearStart,
            reason: DEMO_REASON,
            status: "APPROVED",
            createdById: finance,
            decidedById: owner,
            decidedAt: new Date(),
          },
        });
      }

      const listings: [string, string, string][] = [
        ["HYGEIA", "Hygeia HMO", "https://hygeiahmo.com/provider-directory/"],
        ["RELIANCE", "Reliance Health (Alafia)", "https://getreliancehealth.com/alafia/providers/"],
        ["FOUNTAIN", "Fountain Healthcare", "https://fountainhealthcareng.com/service-providers/"],
      ];
      for (const [code, name, url] of listings) {
        await tx.payer.create({
          data: {
            code,
            name,
            scheme: "PRIVATE_HMO",
            status: "PENDING_VERIFICATION",
            sourceNote: `Hospital appears in this payer's public provider directory (${url}). A listing is not a contract: verify the agreement, tariffs and provider code before activating.`,
          },
        });
      }

      const demo = await tx.payer.create({
        data: {
          code: "DEMO-HMO",
          name: "DEMO Health Plan (fictional)",
          scheme: "PRIVATE_HMO",
          status: "ACTIVE",
          providerCode: "DEMO-0001",
          contractStart: yearStart,
          contractEnd: calendarDateToUtcMidnight(`${Number(today.slice(0, 4)) + 1}-12-31`),
          contractEvidence: "DEMO - fictional payer for local testing only",
          activatedById: finance,
          activatedAt: new Date(),
          sourceNote: "Fictional payer created by the demo seed.",
        },
      });
      const plan = await tx.payerPlan.create({
        data: {
          payerId: demo.id,
          code: "GOLD",
          name: "Gold (demo)",
          copayBasisPoints: 1000,
          status: "ACTIVE",
          activatedById: finance,
          activatedAt: new Date(),
          notes: "DEMO plan: 10% co-pay; ultrasound needs pre-authorisation; wound dressing excluded.",
        },
      });
      const tariff = (
        code: string,
        extra: { amount?: number; coverage?: "COVERED" | "EXCLUDED"; preauth?: boolean },
      ) =>
        tx.payerTariff.create({
          data: {
            payerId: demo.id,
            serviceItemId: ids[code]!,
            coverage: extra.coverage ?? "COVERED",
            amountKobo: extra.coverage === "EXCLUDED" ? null : BigInt((extra.amount ?? 0) * 100),
            requiresPreauth: !!extra.preauth,
            effectiveFrom: yearStart,
            status: "APPROVED",
            note: "DEMO tariff",
            createdById: hmo,
            decidedById: finance,
            decidedAt: new Date(),
          },
        });
      await tariff("CONS-NEW", { amount: 4000 });
      await tariff("CONS-FU", { amount: 2500 });
      await tariff("LAB-FBC", { amount: 3500 });
      await tariff("LAB-MP", { amount: 1200 });
      await tariff("IMG-USOBS", { amount: 7000, preauth: true });
      await tariff("PROC-DRESS", { coverage: "EXCLUDED" });
      // LAB-RBS, LAB-URINE, imaging X-ray and pharmacy are deliberately unmapped: they show the
      // "tariff not mapped" resolution flow.

      const ngozi = await tx.patient.findFirst({
        where: { isDemo: true, givenName: "Ngozi", familyName: "Okafor" },
      });
      if (ngozi) {
        await tx.patientCoverage.create({
          data: {
            patientId: ngozi.id,
            payerId: demo.id,
            planId: plan.id,
            memberNumber: "DEMO-GOLD-000123",
            relationship: "PRINCIPAL",
            sponsor: "DEMO Employer Ltd (fictional)",
            validFrom: yearStart,
            createdById: hmo,
          },
        });
      }
    },
    { timeout: 60_000 },
  );
  return true;
}
