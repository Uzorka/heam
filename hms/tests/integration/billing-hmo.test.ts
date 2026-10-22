import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { AuthContext } from "@/server/authz/context";
import { todayLocal } from "@/lib/time";
import { saveServiceItem, proposePrice, decidePrice } from "@/server/domains/billing/catalogue";
import {
  createCharge,
  decideAdjustment,
  finaliseInvoice,
  invoiceTotals,
  requestAdjustment,
  resolveAsPatientPay,
} from "@/server/domains/billing/charges";
import {
  applyCredit,
  approveShift,
  closeShift,
  createPendingOnlinePayment,
  decideRefund,
  handleProviderCallback,
  markRefundPaid,
  openShift,
  patientCredit,
  recordPayment,
  requestRefund,
} from "@/server/domains/billing/payments";
import { ACCOUNTS, accountBalance } from "@/server/domains/billing/ledger";
import {
  decideTariff,
  proposeTariff,
  savePayer,
  savePlan,
  setPayerStatus,
  setPlanStatus,
} from "@/server/domains/hmo/payers";
import {
  enrolCoverage,
  eligibilityConnectors,
  recordManualEligibility,
  runConnectorEligibility,
  setEncounterPayer,
} from "@/server/domains/hmo/coverage";
import { createPreauth, transitionPreauth } from "@/server/domains/hmo/preauth";
import {
  createBatch,
  createClaimForEncounter,
  exportBatchCsv,
  importRemittance,
  transitionClaim,
  validateClaim,
} from "@/server/domains/hmo/claims";
import { cancelOrder, placeOrders } from "@/server/domains/clinical/orders";
import { addDiagnosis } from "@/server/domains/clinical/diagnoses";
import { claimTransitionSchema } from "@/lib/schemas/hmo";
import { ConflictError, ForbiddenError, InvalidTransitionError, ValidationError } from "@/server/errors";
import { newPatient, uniq, userCtx, visitInConsultation } from "./helpers";

const day = (offset: number) => {
  const d = new Date(`${todayLocal()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const code = (p: string) =>
  uniq(p)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 20);

async function team() {
  const [finance, owner, hmo, cashier, reception, doctor] = await Promise.all([
    userCtx(["FINANCE"]),
    userCtx(["OWNER"]),
    userCtx(["HMO_OFFICER"]),
    userCtx(["CASHIER"]),
    userCtx(["RECEPTION"]),
    userCtx(["PHYSICIAN"]),
  ]);
  return {
    finance: finance.ctx,
    owner: owner.ctx,
    hmo: hmo.ctx,
    cashier: cashier.ctx,
    reception: reception.ctx,
    doctor: doctor.ctx,
  };
}
type Team = Awaited<ReturnType<typeof team>>;

async function pricedService(
  t: Team,
  amountKobo: number,
  opts: { from?: string; labTestId?: string; category?: "LABORATORY" | "CONSULTATION" | "PROCEDURE" } = {},
) {
  const item = await saveServiceItem(t.finance, {
    code: code("SVC"),
    name: uniq("Service "),
    category: opts.category ?? "LABORATORY",
    labTestId: opts.labTestId,
    active: true,
  });
  const p = await proposePrice(t.finance, {
    serviceItemId: item.id,
    amountKobo,
    effectiveFrom: opts.from ?? day(-300),
    reason: "Test price",
  });
  await decidePrice(t.owner, { id: p.id, decision: "APPROVE" });
  return item;
}

async function activePlan(t: Team, copayBasisPoints = 0) {
  const payer = await savePayer(t.hmo, {
    code: code("P"),
    name: uniq("Test HMO "),
    scheme: "PRIVATE_HMO",
    contractStart: day(-400),
    contractEnd: day(400),
  });
  await setPayerStatus(t.finance, { id: payer.id, contractEvidence: "Signed agreement ref TEST-1" });
  const plan = await savePlan(t.hmo, {
    payerId: payer.id,
    code: code("PL"),
    name: "Gold",
    billingModel: "FEE_FOR_SERVICE",
    copayBasisPoints,
  });
  await setPlanStatus(t.finance, { id: plan.id, status: "ACTIVE" });
  return { payer, plan };
}

async function tariff(
  t: Team,
  i: {
    payerId: string;
    serviceItemId: string;
    coverage: "COVERED" | "EXCLUDED";
    amountKobo?: number;
    requiresPreauth?: boolean;
    from?: string;
  },
) {
  const row = await proposeTariff(t.hmo, {
    ...i,
    requiresPreauth: !!i.requiresPreauth,
    effectiveFrom: i.from ?? day(-300),
  });
  await decideTariff(t.finance, { id: row.id, decision: "APPROVE" });
  return row;
}

async function insuredVisit(t: Team, planId: string, opts: { validTo?: string } = {}) {
  const p = await newPatient(t.reception);
  const cover = await enrolCoverage(t.hmo, {
    patientId: p.patientId,
    planId,
    memberNumber: uniq("M"),
    relationship: "PRINCIPAL",
    validFrom: day(-100),
    validTo: opts.validTo,
  });
  const enc = await visitInConsultation(t.reception, t.doctor, p.patientId);
  await setEncounterPayer(t.hmo, { encounterId: enc.id, payerClass: "HMO", coverageId: cover.id });
  return {
    patientId: p.patientId,
    enc: await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } }),
    cover,
  };
}

async function cashVisit(t: Team) {
  const p = await newPatient(t.reception);
  const enc = await visitInConsultation(t.reception, t.doctor, p.patientId);
  return { patientId: p.patientId, enc: await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } }) };
}

const charge = (
  enc: Parameters<typeof createCharge>[1]["enc"],
  serviceItemId: string,
  userId: string,
  serviceDate?: string,
) =>
  prisma.$transaction((tx) =>
    createCharge(tx, {
      enc,
      serviceItemId,
      description: "test",
      quantity: 1,
      sourceType: "MANUAL",
      sourceId: crypto.randomUUID(),
      userId,
      serviceDate: serviceDate ? new Date(`${serviceDate}T00:00:00Z`) : undefined,
    }),
  );

async function labTestWithService(t: Team, amountKobo: number) {
  const test = await prisma.labTestDefinition.create({
    data: { code: code("LT"), name: uniq("Billing test "), specimenType: "Blood" },
  });
  const item = await pricedService(t, amountKobo, { labTestId: test.id });
  return { test, item };
}

describe("tariffs and prices", () => {
  it("AC15: invoices use the price effective on the service date, not the latest rate", async () => {
    const t = await team();
    const item = await pricedService(t, 5_000_00, { from: day(-300) });
    const later = await proposePrice(t.finance, {
      serviceItemId: item.id,
      amountKobo: 7_500_00,
      effectiveFrom: day(30),
      reason: "Annual review",
    });
    await expect(decidePrice(t.finance, { id: later.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decidePrice(t.owner, { id: later.id, decision: "APPROVE" });
    const { enc } = await cashVisit(t);
    const today = await charge(enc, item.id, t.finance.userId);
    const future = await charge(enc, item.id, t.finance.userId, day(45));
    expect(today.unitPriceKobo).toBe(5_000_00n);
    expect(future.unitPriceKobo).toBe(7_500_00n);
    // The old price was closed exactly where the new one starts; approved rows are immutable.
    const old = await prisma.servicePrice.findFirstOrThrow({
      where: { serviceItemId: item.id, amountKobo: 5_000_00n },
    });
    expect(old.effectiveTo?.toISOString().slice(0, 10)).toBe(day(30));
    await expect(
      prisma.servicePrice.update({ where: { id: old.id }, data: { amountKobo: 1n } }),
    ).rejects.toThrow(/immutable/);
  });

  it("overlapping approved prices are refused", async () => {
    const t = await team();
    const item = await pricedService(t, 1_000_00, { from: day(-10) });
    const clash = await proposePrice(t.finance, {
      serviceItemId: item.id,
      amountKobo: 2_000_00,
      effectiveFrom: day(-20),
      reason: "Backdated",
    });
    await expect(decidePrice(t.owner, { id: clash.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("services without a price are never charged at zero", async () => {
    const t = await team();
    const item = await saveServiceItem(t.finance, {
      code: code("NP"),
      name: "Unpriced",
      category: "PROCEDURE",
      active: true,
    });
    const { enc } = await cashVisit(t);
    const c = await charge(enc, item.id, t.finance.userId);
    expect(c.decision).toBe("NO_CASH_PRICE");
    expect(c.totalKobo).toBeNull();
    expect(c.needsResolution).toBe(true);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: c.invoiceId! } });
    await expect(
      finaliseInvoice(t.finance, { invoiceId: inv.id, version: inv.version }),
    ).rejects.toMatchObject({ code: "UNRESOLVED" });
  });
});

describe("HMO coverage decisions", () => {
  it("covered service splits payer and co-pay by the payer tariff", async () => {
    const t = await team();
    const item = await pricedService(t, 10_000_00);
    const { payer, plan } = await activePlan(t, 1000);
    await tariff(t, { payerId: payer.id, serviceItemId: item.id, coverage: "COVERED", amountKobo: 8_000_00 });
    const { enc } = await insuredVisit(t, plan.id);
    const c = await charge(enc, item.id, t.hmo.userId);
    expect(c.decision).toBe("PAYER_TARIFF");
    expect(c.totalKobo).toBe(8_000_00n);
    expect(c.patientPortionKobo).toBe(800_00n);
    expect(c.payerPortionKobo).toBe(7_200_00n);
  });

  it("AC12: a service outside the policy shows an explicit patient-pay amount", async () => {
    const t = await team();
    const item = await pricedService(t, 12_500_00);
    const { payer, plan } = await activePlan(t);
    await tariff(t, { payerId: payer.id, serviceItemId: item.id, coverage: "EXCLUDED" });
    const { enc } = await insuredVisit(t, plan.id);
    const c = await charge(enc, item.id, t.hmo.userId);
    expect(c.decision).toBe("EXCLUDED_BY_PLAN");
    expect(c.payerPortionKobo).toBe(0n);
    expect(c.patientPortionKobo).toBe(12_500_00n);
    expect(c.decisionNote).toMatch(/patient pays/i);

    // Cover that has lapsed by the service date is also patient pay, with the reason.
    const lapsed = await insuredVisit(t, plan.id, { validTo: day(-1) });
    const c2 = await charge(lapsed.enc, item.id, t.hmo.userId);
    expect(c2.decision).toBe("COVERAGE_NOT_VALID");
    expect(c2.patientPortionKobo).toBe(12_500_00n);
  });

  it("unmapped tariffs are held for human resolution, never defaulted", async () => {
    const t = await team();
    const item = await pricedService(t, 3_000_00);
    const { plan } = await activePlan(t);
    const { enc } = await insuredVisit(t, plan.id);
    const c = await charge(enc, item.id, t.hmo.userId);
    expect(c.decision).toBe("TARIFF_NOT_MAPPED");
    expect(c.needsResolution).toBe(true);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: c.invoiceId! } });
    await expect(
      finaliseInvoice(t.finance, { invoiceId: inv.id, version: inv.version }),
    ).rejects.toMatchObject({ code: "UNRESOLVED" });
    await resolveAsPatientPay(t.hmo, { chargeId: c.id, note: "Patient informed; not on HMO list" });
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    await finaliseInvoice(t.finance, { invoiceId: inv.id, version: fresh.version });
    expect((await invoiceTotals(prisma, inv.id)).patientTotal).toBe(3_000_00n);
  });

  it("payers listed in directories stay inactive until activated with contract evidence", async () => {
    const t = await team();
    const payer = await savePayer(t.hmo, {
      code: code("D"),
      name: uniq("Listed HMO "),
      scheme: "PRIVATE_HMO",
    });
    await expect(setPayerStatus(t.hmo, { id: payer.id, contractEvidence: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      setPayerStatus(t.finance, { id: payer.id, contractEvidence: "Signed" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const plan = await savePlan(t.hmo, {
      payerId: payer.id,
      code: "BASIC",
      name: "Basic",
      billingModel: "FEE_FOR_SERVICE",
      copayBasisPoints: 0,
    });
    await expect(setPlanStatus(t.finance, { id: plan.id, status: "ACTIVE" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const item = await pricedService(t, 2_000_00);
    const { enc } = await insuredVisit(t, plan.id);
    const c = await charge(enc, item.id, t.hmo.userId);
    expect(c.decision).toBe("PAYER_NOT_ACTIVE");
    expect(c.patientPortionKobo).toBe(2_000_00n);
  });
});

describe("eligibility (AC23)", () => {
  it("broken or missing connectors never mark eligibility verified", async () => {
    const t = await team();
    const { payer, plan } = await activePlan(t);
    const p = await newPatient(t.reception);
    const cover = await enrolCoverage(t.hmo, {
      patientId: p.patientId,
      planId: plan.id,
      memberNumber: uniq("M"),
      relationship: "PRINCIPAL",
      validFrom: day(-10),
    });

    const none = await runConnectorEligibility(t.hmo, cover.id);
    expect(none.outcome).toBe("ERROR");
    expect(none.errorCode).toBe("CONNECTOR_NOT_CONFIGURED");
    expect(
      (await prisma.patientCoverage.findUniqueOrThrow({ where: { id: cover.id } })).eligibilityStatus,
    ).toBe("CHECK_FAILED");

    eligibilityConnectors.set(payer.code, {
      name: "broken",
      check: async () => {
        throw new Error("401 invalid credentials");
      },
    });
    const broken = await runConnectorEligibility(t.hmo, cover.id);
    expect(broken.errorCode).toBe("AUTH_FAILED");
    expect(
      (await prisma.patientCoverage.findUniqueOrThrow({ where: { id: cover.id } })).eligibilityStatus,
    ).toBe("CHECK_FAILED");

    eligibilityConnectors.set(payer.code, { name: "garbled", check: async () => ({}) as never });
    expect((await runConnectorEligibility(t.hmo, cover.id)).errorCode).toBe("MALFORMED_RESPONSE");

    eligibilityConnectors.set(payer.code, {
      name: "sandbox",
      check: async () => ({ eligible: true, reference: "ELIG-1" }),
    });
    await runConnectorEligibility(t.hmo, cover.id);
    expect(
      (await prisma.patientCoverage.findUniqueOrThrow({ where: { id: cover.id } })).eligibilityStatus,
    ).toBe("VERIFIED_ONLINE");
    eligibilityConnectors.delete(payer.code);

    // Manual confirmation is distinguished from online validation and needs the payer's reference.
    await expect(
      recordManualEligibility(t.hmo, {
        coverageId: cover.id,
        method: "MANUAL_PHONE",
        outcome: "ELIGIBLE",
        evidence: "Call centre agent",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordManualEligibility(t.hmo, {
      coverageId: cover.id,
      method: "MANUAL_PHONE",
      outcome: "ELIGIBLE",
      reference: "CALL-778",
      evidence: "Agent Bimpe",
    });
    expect(
      (await prisma.patientCoverage.findUniqueOrThrow({ where: { id: cover.id } })).eligibilityStatus,
    ).toBe("VERIFIED_MANUAL");
    const checks = await prisma.eligibilityCheck.findMany({ where: { coverageId: cover.id } });
    expect(checks).toHaveLength(5);
    await expect(prisma.eligibilityCheck.deleteMany({ where: { coverageId: cover.id } })).rejects.toThrow();
  });
});

describe("billing events (AC17)", () => {
  it("orders create charges; cancelled orders void them and leave nothing chargeable", async () => {
    const t = await team();
    const { test, item } = await labTestWithService(t, 4_000_00);
    const { enc } = await cashVisit(t);
    const revenueBefore = await accountBalance(prisma, ACCOUNTS.SERVICE_REVENUE);
    const { orders } = await placeOrders(t.doctor, {
      encounterId: enc.id,
      requestGroupId: crypto.randomUUID(),
      priority: "ROUTINE",
      clinicalIndication: "Check",
      items: [{ kind: "LAB", labTestId: test.id }],
    });
    const c = await prisma.charge.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "ORDER", sourceId: orders[0]!.id } },
    });
    expect(c.serviceItemId).toBe(item.id);
    expect(c.totalKobo).toBe(4_000_00n);
    expect((await invoiceTotals(prisma, c.invoiceId!)).outstanding).toBe(
      4_000_00n + (await visitCharge(enc.id)),
    );
    await cancelOrder(t.doctor, {
      orderId: orders[0]!.id,
      version: orders[0]!.version,
      reason: "Not needed",
    });
    const after = await prisma.charge.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("VOID");
    expect(await accountBalance(prisma, ACCOUNTS.SERVICE_REVENUE)).toBe(
      revenueBefore - (await visitCharge(enc.id)),
    );
  });

  it("a charge already on a finalised invoice cannot be silently voided by cancelling", async () => {
    const t = await team();
    const { test } = await labTestWithService(t, 1_500_00);
    const { enc } = await cashVisit(t);
    const { orders } = await placeOrders(t.doctor, {
      encounterId: enc.id,
      requestGroupId: crypto.randomUUID(),
      priority: "ROUTINE",
      clinicalIndication: "Check",
      items: [{ kind: "LAB", labTestId: test.id }],
    });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { encounterId: enc.id } });
    await finaliseInvoice(t.finance, { invoiceId: inv.id, version: inv.version });
    await expect(
      cancelOrder(t.doctor, { orderId: orders[0]!.id, version: orders[0]!.version, reason: "x" }),
    ).rejects.toMatchObject({
      code: "CHARGE_FINALISED",
    });
    expect((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orders[0]!.id } })).status).toBe(
      "ORDERED",
    );
  });
});

/** Visit charges exist only when the visit type is mapped; tests tolerate either. */
async function visitCharge(encounterId: string) {
  const c = await prisma.charge.findFirst({ where: { encounterId, sourceType: "VISIT", status: "ACTIVE" } });
  return c?.totalKobo ?? 0n;
}

describe("payments", () => {
  it("cash needs a shift; overpayment becomes credit, never a negative invoice; retries record once", async () => {
    const t = await team();
    const item = await pricedService(t, 2_500_00);
    const { enc, patientId } = await cashVisit(t);
    const c = await charge(enc, item.id, t.finance.userId);
    const key = crypto.randomUUID();
    const input = {
      patientId,
      invoiceId: c.invoiceId!,
      method: "CASH" as const,
      amountKobo: 4_000_00,
      idempotencyKey: key,
    };
    await expect(recordPayment({ ...t.cashier, activeBranchId: enc.branchId }, input)).rejects.toMatchObject({
      code: "NO_SHIFT",
    });
    const cashier = { ...t.cashier, activeBranchId: enc.branchId };
    const shift = await openShift(cashier, { openingFloatKobo: 10_000_00 });
    const due = (await invoiceTotals(prisma, c.invoiceId!)).outstanding;
    const first = await recordPayment(cashier, input);
    const again = await recordPayment(cashier, input);
    expect(again.duplicate).toBe(true);
    expect(first.allocated).toBe(due);
    expect((await invoiceTotals(prisma, c.invoiceId!)).outstanding).toBe(0n);
    expect(await patientCredit(prisma, patientId)).toBe(4_000_00n - due);

    // Refund the credit: requested by the cashier, approved by someone else, then paid out.
    const refund = await requestRefund(cashier, {
      paymentId: first.payment.id,
      amountKobo: Number(4_000_00n - due),
      method: "CASH",
      reason: "Overpaid",
    });
    await expect(decideRefund(cashier, { id: refund.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideRefund(t.finance, { id: refund.id, decision: "APPROVE" });
    await markRefundPaid(cashier, { id: refund.id });
    expect(await patientCredit(prisma, patientId)).toBe(0n);

    // Shift close computes expected cash; approval by someone else, variance must be explained.
    const closed = await closeShift(cashier, {
      shiftId: shift.id,
      countedCashKobo: Number(10_000_00n + due - 1_00n),
    });
    expect(closed.variance).toBe(-1_00n);
    await expect(approveShift(t.finance, { id: shift.id })).rejects.toBeInstanceOf(ValidationError);
    await approveShift(t.finance, { id: shift.id, note: "₦1 short, counted twice" });
  });

  it("deposits are applied later as credit; discounts need a second approver", async () => {
    const t = await team();
    const item = await pricedService(t, 6_000_00);
    const { enc, patientId } = await cashVisit(t);
    const cashier = { ...t.cashier, activeBranchId: enc.branchId };
    await recordPayment(cashier, {
      patientId,
      method: "POS",
      reference: "POS-123",
      amountKobo: 3_000_00,
      idempotencyKey: crypto.randomUUID(),
    });
    const c = await charge(enc, item.id, t.finance.userId);
    await applyCredit(cashier, { patientId, invoiceId: c.invoiceId! });
    const totals = await invoiceTotals(prisma, c.invoiceId!);
    expect(totals.paid).toBe(3_000_00n);
    const adj = await requestAdjustment(cashier, {
      invoiceId: c.invoiceId!,
      type: "DISCOUNT",
      amountKobo: 500_00,
      reason: "Staff family",
    });
    await expect(
      requestAdjustment(cashier, {
        invoiceId: c.invoiceId!,
        type: "DISCOUNT",
        amountKobo: Number(totals.outstanding),
        reason: "Too much",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(decideAdjustment(cashier, { id: adj.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideAdjustment(t.finance, { id: adj.id, decision: "APPROVE" });
    expect((await invoiceTotals(prisma, c.invoiceId!)).outstanding).toBe(totals.outstanding - 500_00n);
  });

  it("AC6: an identical successful provider callback delivered twice posts once", async () => {
    const t = await team();
    const { patientId, enc } = await cashVisit(t);
    const config = { provider: "paystack", secret: "test-webhook-secret-123456" };
    const cashier = { ...t.cashier, activeBranchId: enc.branchId };
    const pending = await createPendingOnlinePayment(
      cashier,
      { patientId, amountKobo: 2_000_00, idempotencyKey: crypto.randomUUID() },
      prisma,
      config,
    );
    await expect(
      createPendingOnlinePayment(
        cashier,
        { patientId, amountKobo: 1, idempotencyKey: crypto.randomUUID() },
        prisma,
        null,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_DISABLED",
    });
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: Date.now(), reference: pending.providerRef, amount: 2_000_00 },
    });
    const sig = createHmac("sha512", config.secret).update(body).digest("hex");
    const before = await accountBalance(prisma, ACCOUNTS.ONLINE_CLEARING);
    const results = await Promise.all([
      handleProviderCallback(body, sig, config),
      handleProviderCallback(body, sig, config),
    ]);
    const third = await handleProviderCallback(body, sig, config);
    expect(results.map((r) => r.outcome).sort()).toEqual(["confirmed", "duplicate"]);
    expect(third.outcome).toBe("duplicate");
    expect(await accountBalance(prisma, ACCOUNTS.ONLINE_CLEARING)).toBe(before + 2_000_00n);
    expect(await prisma.journalEntry.count({ where: { sourceType: "Payment", sourceId: pending.id } })).toBe(
      1,
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("CONFIRMED");

    expect((await handleProviderCallback(body, "bad", config)).status).toBe(401);
    expect((await handleProviderCallback(body, sig, null)).status).toBe(503);
    const other = await createPendingOnlinePayment(
      cashier,
      { patientId, amountKobo: 5_000_00, idempotencyKey: crypto.randomUUID() },
      prisma,
      config,
    );
    const wrong = JSON.stringify({
      event: "charge.success",
      data: { id: Date.now() + 1, reference: other.providerRef, amount: 100 },
    });
    const r = await handleProviderCallback(
      wrong,
      createHmac("sha512", config.secret).update(wrong).digest("hex"),
      config,
    );
    expect(r.outcome).toBe("amount_mismatch");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PENDING");
  });

  it("the ledger refuses unbalanced or edited entries", async () => {
    const b = await prisma.branch.findFirstOrThrow();
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({
          data: {
            branchId: b.id,
            sourceType: "Test",
            sourceId: crypto.randomUUID(),
            kind: "x",
            description: "bad",
          },
        });
        await tx.journalLine.create({ data: { entryId: e.id, accountCode: ACCOUNTS.CASH, debitKobo: 100n } });
      }),
    ).rejects.toThrow(/not balanced/);
    const line = await prisma.journalLine.findFirst();
    if (line)
      await expect(
        prisma.journalLine.update({ where: { id: line.id }, data: { debitKobo: 1n } }),
      ).rejects.toThrow();
  });
});

describe("pre-authorisation and claims", () => {
  async function insuredLabVisit(t: Team, opts: { requiresPreauth?: boolean } = {}) {
    const { test, item } = await labTestWithService(t, 9_000_00);
    const { payer, plan } = await activePlan(t);
    await tariff(t, {
      payerId: payer.id,
      serviceItemId: item.id,
      coverage: "COVERED",
      amountKobo: 6_000_00,
      requiresPreauth: opts.requiresPreauth,
    });
    const v = await insuredVisit(t, plan.id);
    const { orders } = await placeOrders(t.doctor, {
      encounterId: v.enc.id,
      requestGroupId: crypto.randomUUID(),
      priority: "ROUTINE",
      clinicalIndication: "Fever",
      items: [{ kind: "LAB", labTestId: test.id }],
    });
    await addDiagnosis(t.doctor, {
      encounterId: v.enc.id,
      description: "Malaria",
      code: "B54",
      certainty: "CONFIRMED",
      isPrimary: true,
      onProblemList: false,
    });
    return { ...v, payer, plan, item, order: orders[0]! };
  }

  it("AC13: an approved pre-authorisation or claim approval never marks a claim paid", async () => {
    const t = await team();
    const v = await insuredLabVisit(t, { requiresPreauth: true });
    const pre = await prisma.charge.findFirstOrThrow({
      where: { encounterId: v.enc.id, sourceType: "ORDER" },
    });
    expect(pre.preauthRequired).toBe(true);
    expect(pre.preauthId).toBeNull();
    const claim = await createClaimForEncounter(t.hmo, v.enc.id);
    await expect(validateClaim(t.hmo, { id: claim.id, version: claim.version })).rejects.toThrow(
      /pre-authorisation/,
    );
    await transitionClaim(t.hmo, {
      id: claim.id,
      version: claim.version,
      to: "CLOSED",
      note: "Redo after pre-auth",
    });

    const pa = await createPreauth(t.hmo, {
      encounterId: v.enc.id,
      medicalNecessity: "Febrile, needs test",
      items: [{ serviceItemId: v.item.id, quantity: 1 }],
    });
    await transitionPreauth(t.hmo, { id: pa.id, version: pa.version, to: "SUBMITTED" });
    await expect(
      transitionPreauth(t.hmo, {
        id: pa.id,
        version: pa.version + 1,
        to: "APPROVED",
        approvedKobo: 6_000_00,
      }),
    ).rejects.toThrow();
    await transitionPreauth(t.hmo, {
      id: pa.id,
      version: pa.version + 1,
      to: "APPROVED",
      approvedKobo: 6_000_00,
      authCode: "AUTH-55",
    });
    const linked = await prisma.charge.findUniqueOrThrow({ where: { id: pre.id } });
    expect(linked.preauthId).toBe(pa.id);

    const c2 = await createClaimForEncounter(t.hmo, v.enc.id);
    await validateClaim(t.hmo, { id: c2.id, version: c2.version });
    await transitionClaim(t.hmo, { id: c2.id, version: c2.version + 1, to: "SUBMITTED" });
    await transitionClaim(t.hmo, { id: c2.id, version: c2.version + 2, to: "APPROVED" });
    const approved = await prisma.claim.findUniqueOrThrow({ where: { id: c2.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.paidKobo).toBe(0n);
    // No manual route to PAID exists.
    expect(
      claimTransitionSchema.safeParse({ id: c2.id, version: approved.version, to: "PAID" }).success,
    ).toBe(false);
    await expect(
      transitionClaim(t.hmo, { id: c2.id, version: approved.version, to: "PAID" as never }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    await importRemittance(t.hmo, {
      payerId: v.payer.id,
      payerReference: uniq("RA"),
      receivedDate: todayLocal(),
      totalKobo: 6_000_00,
      lines: [{ claimRef: c2.ref, paidKobo: 6_000_00, deniedKobo: 0 }],
    });
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe("PAID");
  });

  it("AC14: duplicate items and multiple remittances reconcile without overstating revenue", async () => {
    const t = await team();
    const v = await insuredLabVisit(t);
    await expect(
      createClaimForEncounter(t.hmo, v.enc.id).then(() => createClaimForEncounter(t.hmo, v.enc.id)),
    ).rejects.toBeInstanceOf(ConflictError);
    const claim = await prisma.claim.findFirstOrThrow({ where: { encounterId: v.enc.id } });
    const lineCharge = await prisma.claimLine.findFirstOrThrow({ where: { claimId: claim.id } });
    // The database also refuses a second live line for the same charge.
    await expect(
      prisma.claimLine.create({
        data: { ...lineCharge, id: undefined, paidKobo: 0n },
      }),
    ).rejects.toThrow();

    await validateClaim(t.hmo, { id: claim.id, version: claim.version });
    const batch = await createBatch(t.hmo, { payerId: v.payer.id, claimIds: [claim.id] });
    const csv = await exportBatchCsv(t.hmo, batch.id);
    expect(csv.csv).toContain(claim.ref);
    expect(csv.csv).toContain("B54 Malaria");

    const revenue = await accountBalance(prisma, ACCOUNTS.SERVICE_REVENUE);
    const receivable = await accountBalance(prisma, ACCOUNTS.PAYER_RECEIVABLE, { payerId: v.payer.id });
    expect(receivable).toBe(6_000_00n);
    const ref1 = uniq("RA");
    await importRemittance(t.hmo, {
      payerId: v.payer.id,
      payerReference: ref1,
      receivedDate: todayLocal(),
      totalKobo: 4_000_00,
      lines: [{ claimRef: claim.ref, paidKobo: 4_000_00, deniedKobo: 0 }],
    });
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("PARTLY_PAID");
    await expect(
      importRemittance(t.hmo, {
        payerId: v.payer.id,
        payerReference: ref1,
        receivedDate: todayLocal(),
        totalKobo: 2_000_00,
        lines: [{ claimRef: claim.ref, paidKobo: 2_000_00, deniedKobo: 0 }],
      }),
    ).rejects.toThrow(/already been imported/);
    await expect(
      importRemittance(t.hmo, {
        payerId: v.payer.id,
        payerReference: uniq("RA"),
        receivedDate: todayLocal(),
        totalKobo: 3_000_00,
        lines: [{ claimRef: claim.ref, paidKobo: 3_000_00, deniedKobo: 0 }],
      }),
    ).rejects.toThrow(/exceeds the unpaid/);
    await expect(
      importRemittance(t.hmo, {
        payerId: v.payer.id,
        payerReference: uniq("RA"),
        receivedDate: todayLocal(),
        totalKobo: 9_999,
        lines: [{ claimRef: claim.ref, paidKobo: 2_000_00, deniedKobo: 0 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await importRemittance(t.hmo, {
      payerId: v.payer.id,
      payerReference: uniq("RA"),
      receivedDate: todayLocal(),
      totalKobo: 2_000_00,
      lines: [{ claimRef: claim.ref, paidKobo: 2_000_00, deniedKobo: 0 }],
    });
    const paid = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id }, include: { lines: true } });
    expect(paid.status).toBe("PAID");
    expect(paid.paidKobo).toBe(6_000_00n);
    expect(paid.lines[0]!.paidKobo).toBe(6_000_00n);
    expect(await accountBalance(prisma, ACCOUNTS.PAYER_RECEIVABLE, { payerId: v.payer.id })).toBe(0n);
    expect(await accountBalance(prisma, ACCOUNTS.SERVICE_REVENUE)).toBe(revenue);
  });

  it("closing a part-paid claim writes off the balance only with finance approval", async () => {
    const t = await team();
    const v = await insuredLabVisit(t);
    const claim = await createClaimForEncounter(t.hmo, v.enc.id);
    await validateClaim(t.hmo, { id: claim.id, version: claim.version });
    await transitionClaim(t.hmo, { id: claim.id, version: claim.version + 1, to: "SUBMITTED" });
    await transitionClaim(t.hmo, {
      id: claim.id,
      version: claim.version + 2,
      to: "PARTLY_APPROVED",
      approvedKobo: 5_000_00,
    });
    await importRemittance(t.hmo, {
      payerId: v.payer.id,
      payerReference: uniq("RA"),
      receivedDate: todayLocal(),
      totalKobo: 5_000_00,
      lines: [{ claimRef: claim.ref, paidKobo: 5_000_00, deniedKobo: 1_000_00, reason: "Tariff cap" }],
    });
    const c = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(c.status).toBe("PAID");
    await expect(
      transitionClaim(t.hmo, { id: c.id, version: c.version, to: "CLOSED", note: "Accept cap" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const both: AuthContext = (await userCtx(["HMO_OFFICER", "FINANCE"])).ctx;
    await transitionClaim(both, { id: c.id, version: c.version, to: "CLOSED", note: "Accept cap" });
    expect(await accountBalance(prisma, ACCOUNTS.PAYER_RECEIVABLE, { payerId: v.payer.id })).toBe(0n);
  });
});
