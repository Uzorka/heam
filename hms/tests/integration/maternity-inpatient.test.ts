import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { todayLocal } from "@/lib/time";
import { eddFromLmp } from "@/lib/obstetrics";
import {
  addDating,
  adoptDating,
  familyLinks,
  getPregnancy,
  markAncError,
  openPregnancy,
  recordAncVisit,
  recordDelivery,
  recordPostnatal,
} from "@/server/domains/maternity/service";
import {
  admit,
  authoriseDischarge,
  completeDischarge,
  financialClearance,
  markBedReady,
  moveBed,
  recordAdministration,
} from "@/server/domains/inpatient/service";
import { createPrescription } from "@/server/domains/pharmacy/prescribing";
import { createFrequency, setFrequencyStatus } from "@/server/domains/pharmacy/prescribing";
import { saveServiceItem, proposePrice, decidePrice } from "@/server/domains/billing/catalogue";
import { invoiceTotals } from "@/server/domains/billing/charges";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { TEST_PASSWORD, branch, createUser, newPatient, uniq, userCtx, visitInConsultation } from "./helpers";

const day = (offset: number) => {
  const d = new Date(`${todayLocal()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function ward(kind: "MATERNITY" | "GENERAL" = "MATERNITY", beds = 2) {
  const b = await branch();
  const w = await prisma.ward.create({
    data: { branchId: b.id, code: uniq("W").slice(0, 20).toUpperCase(), name: `Test ${kind} ward`, kind },
  });
  const created = [];
  for (let i = 1; i <= beds; i++)
    created.push(await prisma.bed.create({ data: { wardId: w.id, code: `B${i}`, label: `Bed ${i}` } }));
  return { ward: w, beds: created };
}

async function mother() {
  const { ctx: reception } = await userCtx(["RECEPTION"]);
  const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
  const { ctx: midwife } = await userCtx(["MIDWIFE"]);
  const p = await newPatient(reception, { sexAtBirth: "FEMALE", dateOfBirth: "1994-04-04" });
  const enc = await visitInConsultation(reception, doctor, p.patientId);
  return { reception, doctor, midwife, patientId: p.patientId, enc };
}

describe("pregnancy record", () => {
  it("dating is proposed, then adopted by a clinician; ANC gestation follows the adopted EDD", async () => {
    const m = await mother();
    const ep = await openPregnancy(m.doctor, {
      patientId: m.patientId,
      gravida: 2,
      para: 1,
      bookingDate: day(-60),
    });
    await expect(
      openPregnancy(m.doctor, { patientId: m.patientId, gravida: 2, para: 1, bookingDate: day(-60) }),
    ).rejects.toBeInstanceOf(ConflictError);
    const lmp = day(-120);
    await addDating(m.midwife, { episodeId: ep.id, method: "LMP", lmp, adopt: false });
    expect((await prisma.pregnancyEpisode.findUniqueOrThrow({ where: { id: ep.id } })).edd).toBeNull();
    const scan = await addDating(m.doctor, {
      episodeId: ep.id,
      method: "ULTRASOUND",
      scanDate: day(-60),
      gaWeeks: 9,
      gaExtraDays: 0,
      adopt: false,
    });
    await adoptDating(m.doctor, scan.id);
    const adopted = await prisma.pregnancyEpisode.findUniqueOrThrow({ where: { id: ep.id } });
    expect(adopted.edd?.toISOString().slice(0, 10)).toBe(scan.edd.toISOString().slice(0, 10));
    expect(adopted.edd?.toISOString().slice(0, 10)).not.toBe(eddFromLmp(lmp));
    const v = await recordAncVisit(m.midwife, {
      episodeId: ep.id,
      visitDate: todayLocal(),
      systolicMmHg: 150,
      diastolicMmHg: 95,
      fetalHeartRate: 140,
    });
    expect(v.gestationDays).toBe(63 + 60);
    await expect(
      prisma.antenatalVisit.update({ where: { id: v.id }, data: { systolicMmHg: 120 } }),
    ).rejects.toThrow(/permanent/);
    await markAncError(m.midwife, { id: v.id, reason: "Wrong patient" });
    await expect(
      prisma.pregnancyDatingEvent.update({ where: { id: scan.id }, data: { gaAtScanDays: 1 } }),
    ).rejects.toThrow(/permanent/);
    const full = await getPregnancy(m.doctor, ep.id);
    expect(full.dating).toHaveLength(2);
  });

  it("refuses implausible counts and male patients", async () => {
    const m = await mother();
    await expect(
      openPregnancy(m.doctor, { patientId: m.patientId, gravida: 1, para: 1, bookingDate: todayLocal() }),
    ).rejects.toBeInstanceOf(ValidationError);
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const man = await newPatient(reception, { sexAtBirth: "MALE" });
    await visitInConsultation(reception, m.doctor, man.patientId);
    await expect(
      openPregnancy(m.doctor, { patientId: man.patientId, gravida: 1, para: 0, bookingDate: todayLocal() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delivery and newborns (AC16)", () => {
  it("twins: one pregnancy, one delivery, two newborn records and two distinct baby patients linked to the mother", async () => {
    const m = await mother();
    const { ward: w, beds } = await ward("MATERNITY");
    const adm = await admit(m.doctor, {
      encounterId: m.enc.id,
      wardId: w.id,
      bedId: beds[0]!.id,
      reason: "Labour",
    });
    const ep = await openPregnancy(m.doctor, {
      patientId: m.patientId,
      gravida: 3,
      para: 2,
      bookingDate: day(-200),
    });
    await addDating(m.doctor, { episodeId: ep.id, method: "LMP", lmp: day(-266), adopt: true });
    await expect(
      recordDelivery(m.midwife, {
        episodeId: ep.id,
        deliveryDate: todayLocal(),
        mode: "SVD",
        babies: [{ birthOrder: 1, outcome: "LIVE_BIRTH", sex: "FEMALE", birthTime: "00:01" }],
        admitBabiesWithMother: true,
        password: "wrong",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const r = await recordDelivery(m.midwife, {
      episodeId: ep.id,
      deliveryDate: todayLocal(),
      mode: "SVD",
      bloodLossMl: 300,
      placentaComplete: true,
      babies: [
        {
          birthOrder: 2,
          outcome: "LIVE_BIRTH",
          sex: "MALE",
          birthTime: "00:09",
          birthWeightG: 2400,
          apgar1: 7,
          apgar5: 9,
        },
        {
          birthOrder: 1,
          outcome: "LIVE_BIRTH",
          sex: "FEMALE",
          birthTime: "00:01",
          birthWeightG: 2550,
          apgar1: 8,
          apgar5: 9,
        },
      ],
      admitBabiesWithMother: true,
      password: TEST_PASSWORD,
    });
    const newborns = await prisma.newbornRecord.findMany({
      where: { deliveryId: r.delivery.id },
      orderBy: { birthOrder: "asc" },
      include: { baby: true },
    });
    expect(newborns.map((n) => n.birthOrder)).toEqual([1, 2]);
    const [b1, b2] = newborns.map((n) => n.baby!);
    expect(b1!.id).not.toBe(b2!.id);
    expect(b1!.id).not.toBe(m.patientId);
    expect(b1!.mrn).not.toBe(b2!.mrn);
    expect(b1!.preferredName).toBe("Twin 1");
    expect(b2!.sexAtBirth).toBe("MALE");
    const guardians = await prisma.guardianRelationship.findMany({
      where: { dependentPatientId: { in: [b1!.id, b2!.id] } },
    });
    expect(guardians.every((g) => g.guardianPatientId === m.patientId && g.verified)).toBe(true);
    const links = await familyLinks(m.patientId);
    expect(links.babies).toHaveLength(2);
    expect((await familyLinks(b1!.id)).mother?.id).toBe(m.patientId);
    expect((await prisma.pregnancyEpisode.findUniqueOrThrow({ where: { id: ep.id } })).status).toBe(
      "DELIVERED",
    );
    // Rooming-in: each baby has its own visit and admission.
    const babyAdmissions = await prisma.admission.findMany({
      where: { patientId: { in: [b1!.id, b2!.id] } },
    });
    expect(babyAdmissions).toHaveLength(2);
    expect(babyAdmissions.every((a) => a.encounterId !== adm.encounterId)).toBe(true);
    // Signed records are immutable.
    await expect(
      prisma.deliveryRecord.update({ where: { id: r.delivery.id }, data: { bloodLossMl: 100 } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.newbornRecord.update({ where: { id: newborns[0]!.id }, data: { birthWeightG: 3000 } }),
    ).rejects.toThrow(/immutable/);
    await recordPostnatal(m.midwife, {
      episodeId: ep.id,
      subject: "BABY",
      babyPatientId: b1!.id,
      visitDate: todayLocal(),
      findings: "Feeding well",
      weightG: 2500,
    });
    await expect(
      recordPostnatal(m.midwife, {
        episodeId: ep.id,
        subject: "BABY",
        babyPatientId: m.patientId,
        visitDate: todayLocal(),
        findings: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("stillbirths are recorded without creating a patient record", async () => {
    const m = await mother();
    const ep = await openPregnancy(m.doctor, {
      patientId: m.patientId,
      gravida: 1,
      para: 0,
      bookingDate: day(-200),
    });
    const r = await recordDelivery(m.doctor, {
      episodeId: ep.id,
      deliveryDate: todayLocal(),
      mode: "CAESAREAN_EMERGENCY",
      babies: [{ birthOrder: 1, outcome: "FRESH_STILLBIRTH", sex: "UNKNOWN", birthTime: "00:05" }],
      admitBabiesWithMother: false,
      password: TEST_PASSWORD,
    });
    expect(r.babies[0]!.babyPatientId).toBeNull();
  });

  it("nurses without delivery-signing rights cannot sign", async () => {
    const m = await mother();
    const { ctx: nurse } = await userCtx(["NURSE"]);
    const ep = await openPregnancy(m.doctor, {
      patientId: m.patientId,
      gravida: 1,
      para: 0,
      bookingDate: day(-200),
    });
    await expect(
      recordDelivery(nurse, {
        episodeId: ep.id,
        deliveryDate: todayLocal(),
        mode: "SVD",
        babies: [{ birthOrder: 1, outcome: "LIVE_BIRTH", sex: "FEMALE", birthTime: "00:05" }],
        admitBabiesWithMother: false,
        password: TEST_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admissions and beds (AC7)", () => {
  it("two staff assigning the same bed at the same time: exactly one succeeds", async () => {
    const { ward: w, beds } = await ward("GENERAL", 1);
    const a = await mother();
    const b = await mother();
    const [admA, admB] = await Promise.all([
      admit(a.doctor, { encounterId: a.enc.id, wardId: w.id, reason: "Observation" }),
      admit(b.doctor, { encounterId: b.enc.id, wardId: w.id, reason: "Observation" }),
    ]);
    const { ctx: sup } = await userCtx(["NURSING_SUPERVISOR"], { allBranches: false });
    const results = await Promise.allSettled([
      moveBed(sup, { admissionId: admA.id, bedId: beds[0]!.id }),
      moveBed(sup, { admissionId: admB.id, bedId: beds[0]!.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "BED_UNAVAILABLE" });
    expect(await prisma.bedAssignment.count({ where: { bedId: beds[0]!.id, endAt: null } })).toBe(1);
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: beds[0]!.id } })).status).toBe("OCCUPIED");
    // The database itself refuses an overlapping assignment.
    await expect(
      prisma.bedAssignment.create({
        data: {
          admissionId: (results[0]!.status === "fulfilled" ? admB : admA).id,
          bedId: beds[0]!.id,
          assignedById: sup.userId,
        },
      }),
    ).rejects.toThrow();
  });

  it("ward move frees the old bed for cleaning; discharge needs clinician sign-off then finance then completion", async () => {
    const m = await mother();
    const { ward: w1, beds: b1 } = await ward("GENERAL", 1);
    const { ward: w2, beds: b2 } = await ward("MATERNITY", 1);
    const { ctx: finance } = await userCtx(["FINANCE"]);
    const { ctx: owner } = await userCtx(["OWNER"]);
    const item = await saveServiceItem(finance, {
      code: uniq("BED").toUpperCase().slice(0, 20),
      name: "Ward bed-day",
      category: "ADMISSION",
      active: true,
    });
    await prisma.serviceItem.update({ where: { id: item.id }, data: { wardId: w2.id } });
    const price = await proposePrice(finance, {
      serviceItemId: item.id,
      amountKobo: 15_000_00,
      effectiveFrom: day(-30),
      reason: "Test",
    });
    await decidePrice(owner, { id: price.id, decision: "APPROVE" });

    const adm = await admit(m.doctor, {
      encounterId: m.enc.id,
      wardId: w1.id,
      bedId: b1[0]!.id,
      reason: "Observation",
    });
    expect((await prisma.encounter.findUniqueOrThrow({ where: { id: m.enc.id } })).queueStage).toBe(
      "ADMITTED",
    );
    await moveBed(m.doctor, { admissionId: adm.id, bedId: b2[0]!.id, reason: "To maternity" });
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: b1[0]!.id } })).status).toBe("CLEANING");
    await markBedReady(m.doctor, b1[0]!.id);
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: b1[0]!.id } })).status).toBe("FREE");

    await expect(
      financialClearance(finance, { admissionId: adm.id, override: false }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(completeDischarge(m.doctor, adm.id)).rejects.toBeInstanceOf(ConflictError);
    await authoriseDischarge(m.doctor, {
      admissionId: adm.id,
      summary: "Stable",
      destination: "Home",
      password: TEST_PASSWORD,
    });
    await expect(financialClearance(finance, { admissionId: adm.id, override: false })).rejects.toMatchObject(
      { code: "BALANCE_OUTSTANDING" },
    );
    const bedCharge = await prisma.charge.findFirstOrThrow({
      where: { encounterId: m.enc.id, sourceType: "BED" },
    });
    expect(bedCharge.quantity).toBe(1);
    expect(bedCharge.totalKobo).toBe(15_000_00n);
    await expect(completeDischarge(m.doctor, adm.id)).rejects.toMatchObject({ code: "NOT_CLEARED" });
    await expect(financialClearance(finance, { admissionId: adm.id, override: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const r = await financialClearance(finance, {
      admissionId: adm.id,
      override: true,
      note: "Deposit plan agreed with patient",
    });
    expect(r.outstanding).toBe((await invoiceTotals(prisma, bedCharge.invoiceId!)).outstanding);
    await completeDischarge(m.doctor, adm.id);
    const done = await prisma.admission.findUniqueOrThrow({ where: { id: adm.id } });
    expect(done.status).toBe("DISCHARGED");
    expect((await prisma.encounter.findUniqueOrThrow({ where: { id: m.enc.id } })).status).toBe("COMPLETED");
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: b2[0]!.id } })).status).toBe("CLEANING");
    await expect(
      prisma.bedAssignment.updateMany({ where: { admissionId: adm.id }, data: { reason: "x" } }),
    ).rejects.toThrow();
  });

  it("controlled drugs on the MAR need a second nurse as witness", async () => {
    const m = await mother();
    const { ward: w, beds } = await ward("GENERAL", 1);
    await admit(m.doctor, {
      encounterId: m.enc.id,
      wardId: w.id,
      bedId: beds[0]!.id,
      reason: "Pain control",
    });
    const { ctx: md } = await userCtx(["MEDICAL_DIRECTOR"]);
    const { ctx: pharm } = await userCtx(["PHARMACIST", "MEDICAL_DIRECTOR"]);
    const f = await createFrequency(pharm, {
      code: uniq("Q").toUpperCase().slice(0, 20),
      label: "Every 8 hours",
      timesPerDay: 3,
    });
    await setFrequencyStatus(md, { id: f.id, status: "APPROVED" });
    const product = await prisma.inventoryProduct.create({
      data: {
        sku: uniq("CD").toUpperCase().slice(0, 30),
        name: "Test opioid",
        category: "PHARMACY",
        baseUnit: "ampoule",
      },
    });
    const med = await prisma.medicationProduct.create({
      data: {
        inventoryProductId: product.id,
        genericName: "Test opioid",
        strength: "50 mg/mL",
        form: "INJECTION",
        defaultRoute: "IM",
        dispensingUnit: "ampoule",
        controlled: true,
      },
    });
    const rx = await createPrescription(m.doctor, {
      encounterId: m.enc.id,
      items: [{ medicationId: med.id, dose: "1", route: "IM", frequencyId: f.id, prn: true, quantity: 3 }],
      password: TEST_PASSWORD,
      allergiesReviewed: false,
    });
    const item = await prisma.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
    const nurse1 = await createUser(["NURSE"]);
    const nurse2 = await createUser(["NURSE"]);
    const { ctxFor } = await import("./helpers");
    const n1 = await ctxFor(nurse1.id);
    await expect(
      recordAdministration(n1, { prescriptionItemId: item.id, encounterId: m.enc.id, status: "GIVEN" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAdministration(n1, {
        prescriptionItemId: item.id,
        encounterId: m.enc.id,
        status: "GIVEN",
        witnessEmail: nurse1.email,
        witnessPassword: TEST_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const given = await recordAdministration(n1, {
      prescriptionItemId: item.id,
      encounterId: m.enc.id,
      status: "GIVEN",
      witnessEmail: nurse2.email,
      witnessPassword: TEST_PASSWORD,
    });
    expect(given.witnessedById).toBe(nurse2.id);
    expect(given.doseGiven).toBe("1");
    await expect(
      recordAdministration(n1, { prescriptionItemId: item.id, encounterId: m.enc.id, status: "HELD" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      prisma.medicationAdministration.update({ where: { id: given.id }, data: { doseGiven: "2" } }),
    ).rejects.toThrow(/permanent/);
  });
});
