import type { CoverageDecision, Encounter, PayerTariff } from "@prisma/client";
import type { DbClient } from "../../db";
import { percentOfKobo } from "@/lib/money";

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** The approved cash price effective on a service date (effectiveTo is exclusive). */
export async function cashPriceAt(db: DbClient, serviceItemId: string, serviceDate: Date) {
  return db.servicePrice.findFirst({
    where: {
      serviceItemId,
      status: "APPROVED",
      effectiveFrom: { lte: serviceDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: serviceDate } }],
    },
  });
}

/** The approved payer tariff effective on a date; a plan-specific row wins over a payer-wide one. */
export async function payerTariffAt(
  db: DbClient,
  payerId: string,
  planId: string,
  serviceItemId: string,
  serviceDate: Date,
): Promise<PayerTariff | null> {
  const rows = await db.payerTariff.findMany({
    where: {
      payerId,
      serviceItemId,
      status: "APPROVED",
      OR: [{ planId }, { planId: null }],
      effectiveFrom: { lte: serviceDate },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: serviceDate } }] }],
    },
  });
  return rows.find((r) => r.planId === planId) ?? rows.find((r) => r.planId === null) ?? null;
}

export interface CoverageResult {
  decision: CoverageDecision;
  note: string;
  unitPriceKobo: bigint | null;
  totalKobo: bigint | null;
  payerPortionKobo: bigint;
  patientPortionKobo: bigint | null;
  needsResolution: boolean;
  coverageId: string | null;
  payerId: string | null;
  preauthRequired: boolean;
  preauthId: string | null;
}

const INSURED = new Set(["HMO", "PART_INSURED", "CORPORATE"]);

/**
 * Decide price and payer split for one service on one date. Every outcome carries a decision code
 * and a plain explanation; nothing silently defaults to free or to cash:
 *  - cash visit: approved cash price, or "no price" (needs billing to resolve);
 *  - insured visit with a mapped, covered tariff: payer pays tariff less co-pay;
 *  - excluded by plan / coverage not valid / payer not active: patient pays the cash price, and
 *    the reason is shown;
 *  - tariff not mapped: held for HMO resolution before the invoice can be finalised.
 */
export async function decideCoverage(
  db: DbClient,
  enc: Pick<Encounter, "id" | "payerClass" | "coverageId">,
  serviceItemId: string,
  serviceDate: Date,
  quantity: number,
): Promise<CoverageResult> {
  const cash = await cashPriceAt(db, serviceItemId, serviceDate);
  const base = { coverageId: null, payerId: null, preauthRequired: false, preauthId: null } as const;
  const patientPays = (
    decision: CoverageDecision,
    note: string,
    extra: Partial<CoverageResult> = {},
  ): CoverageResult => {
    if (!cash)
      return {
        ...base,
        decision: "NO_CASH_PRICE",
        note: `${note} No approved cash price exists for this service on ${dateOnly(serviceDate)}.`,
        unitPriceKobo: null,
        totalKobo: null,
        payerPortionKobo: 0n,
        patientPortionKobo: null,
        needsResolution: true,
        ...extra,
      };
    const total = cash.amountKobo * BigInt(quantity);
    return {
      ...base,
      decision,
      note,
      unitPriceKobo: cash.amountKobo,
      totalKobo: total,
      payerPortionKobo: 0n,
      patientPortionKobo: total,
      needsResolution: false,
      ...extra,
    };
  };

  if (!INSURED.has(enc.payerClass) || !enc.coverageId) {
    return patientPays(
      "CASH_PRICE",
      INSURED.has(enc.payerClass) ? "Insured visit but no coverage selected - cash price." : "Cash price.",
      {
        needsResolution: INSURED.has(enc.payerClass) || !cash,
      },
    );
  }
  const coverage = await db.patientCoverage.findUnique({
    where: { id: enc.coverageId },
    include: { plan: true, payer: true },
  });
  if (!coverage)
    return patientPays("COVERAGE_NOT_VALID", "Coverage record not found - patient pays the cash price.");
  const who = { coverageId: coverage.id, payerId: coverage.payerId };
  const day = dateOnly(serviceDate);
  const validTo = coverage.validTo ? dateOnly(coverage.validTo) : null;
  if (
    coverage.status !== "ACTIVE" ||
    dateOnly(coverage.validFrom) > day ||
    (validTo !== null && validTo < day)
  ) {
    return patientPays(
      "COVERAGE_NOT_VALID",
      `${coverage.payer.name} cover is not valid on ${day} - patient pays the cash price.`,
      who,
    );
  }
  if (coverage.payer.status !== "ACTIVE" || coverage.plan.status !== "ACTIVE") {
    return patientPays(
      "PAYER_NOT_ACTIVE",
      `${coverage.payer.name} / ${coverage.plan.name} is not an active contract - patient pays the cash price.`,
      who,
    );
  }
  const tariff = await payerTariffAt(db, coverage.payerId, coverage.planId, serviceItemId, serviceDate);
  if (!tariff) {
    return patientPays(
      "TARIFF_NOT_MAPPED",
      `No approved ${coverage.payer.name} tariff for this service - HMO officer must map it or confirm patient pay.`,
      { ...who, needsResolution: true },
    );
  }
  if (tariff.coverage === "EXCLUDED") {
    return patientPays(
      "EXCLUDED_BY_PLAN",
      `Not covered by ${coverage.plan.name}${tariff.note ? ` (${tariff.note})` : ""} - patient pays the cash price.`,
      who,
    );
  }
  const unit = tariff.amountKobo!;
  const total = unit * BigInt(quantity);
  const copayBp = tariff.copayBasisPoints ?? coverage.plan.copayBasisPoints;
  const patient = percentOfKobo(total, copayBp);
  let preauthId: string | null = null;
  if (tariff.requiresPreauth) {
    const pa = await db.preauthorization.findFirst({
      where: {
        encounterId: enc.id,
        status: { in: ["APPROVED", "PARTIALLY_APPROVED"] },
        items: { some: { serviceItemId } },
        OR: [{ validUntil: null }, { validUntil: { gte: serviceDate } }],
      },
      orderBy: { decidedAt: "desc" },
    });
    preauthId = pa?.id ?? null;
  }
  return {
    ...who,
    decision: "PAYER_TARIFF",
    note: `${coverage.payer.name} tariff${copayBp ? `, patient co-pay ${copayBp / 100}%` : ""}${
      tariff.requiresPreauth ? (preauthId ? ", pre-authorised" : ", PRE-AUTHORISATION REQUIRED") : ""
    }.`,
    unitPriceKobo: unit,
    totalKobo: total,
    payerPortionKobo: total - patient,
    patientPortionKobo: patient,
    needsResolution: false,
    preauthRequired: tariff.requiresPreauth,
    preauthId,
  };
}
