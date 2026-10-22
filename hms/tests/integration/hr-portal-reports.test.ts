import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { todayLocal } from "@/lib/time";
import {
  addShift,
  clock,
  decideLeave,
  requestLeave,
  saveEmployee,
  getEmployee,
} from "@/server/domains/hr/service";
import {
  addPayItem,
  approvePayroll,
  decidePayComponent,
  myPayslips,
  preparePayroll,
  proposePayComponent,
  getPayrollRun,
} from "@/server/domains/hr/payroll";
import {
  authorizePortalDownload,
  createPortalAccount,
  portalHome,
  portalRecord,
  setDocumentRelease,
} from "@/server/domains/portal/service";
import { exportReport, runReport } from "@/server/domains/reports/service";
import { exportPatientFhir } from "@/server/domains/fhir/export";
import { searchPatients } from "@/server/domains/patients/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { branch, createUser, ctxFor, newPatient, uniq, userCtx, visitInConsultation } from "./helpers";

const code = (p: string) =>
  uniq(p)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 20);

async function hrTeam() {
  const b = await branch();
  const hr = await userCtx(["HR_PAYROLL"]);
  const owner = await userCtx(["OWNER"]);
  return {
    hr: { ...hr.ctx, activeBranchId: b.id },
    owner: { ...owner.ctx, activeBranchId: b.id },
    branchId: b.id,
  };
}

async function employee(hr: Awaited<ReturnType<typeof hrTeam>>["hr"], userEmail?: string) {
  return saveEmployee(hr, {
    staffNumber: code("S"),
    givenName: "Test",
    familyName: uniq("Staff"),
    jobTitle: "Staff nurse",
    employmentType: "PERMANENT",
    startDate: "2025-01-01",
    bankAccount: "0123456789",
    userEmail,
  });
}

describe("HR and payroll (AC2)", () => {
  it("HR cannot read patient records and clinicians cannot read payroll", async () => {
    const t = await hrTeam();
    await expect(
      searchPatients(t.hr, { q: "a", page: 1, pageSize: 5, includeInactive: false, provisionalOnly: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const run = await prisma.payrollRun.findFirst();
    if (run) await expect(getPayrollRun(doctor, run.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      proposePayComponent(doctor, {
        code: code("X"),
        name: "x",
        kind: "EARNING",
        calc: "FIXED",
        isBasic: false,
        note: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("bank numbers are encrypted and never returned; rosters cannot overlap; leave needs another approver", async () => {
    const t = await hrTeam();
    const e = await employee(t.hr);
    const raw = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(raw.bankAccountEnc).not.toContain("0123456789");
    expect(raw.bankAccountLast4).toBe("6789");
    const detail = await getEmployee(t.hr, e.id);
    expect(JSON.stringify(detail)).not.toContain("bankAccountEnc");
    await addShift(t.hr, {
      employeeId: e.id,
      date: todayLocal(),
      startTime: "20:00",
      endTime: "08:00",
      kind: "NIGHT",
    });
    await expect(
      addShift(t.hr, {
        employeeId: e.id,
        date: todayLocal(),
        startTime: "22:00",
        endTime: "23:00",
        kind: "OTHER",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const staffUser = await createUser(["NURSE"]);
    const linked = await employee(t.hr, staffUser.email);
    const staffCtx = await ctxFor(staffUser.id);
    await clock(staffCtx, { kind: "CLOCK_IN" });
    await expect(clock(staffCtx, { kind: "CLOCK_IN" })).rejects.toBeInstanceOf(ConflictError);
    const leave = await requestLeave(staffCtx, {
      type: "ANNUAL",
      startDate: "2027-01-04",
      endDate: "2027-01-08",
      reason: "Holiday",
    });
    expect(leave.days).toBe(5);
    expect(leave.employeeId).toBe(linked.id);
    await expect(
      requestLeave(staffCtx, { type: "SICK", startDate: "2027-01-06", endDate: "2027-01-06", reason: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await decideLeave(t.hr, { id: leave.id, decision: "APPROVE" });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe(
      "APPROVED",
    );
  });

  it("payroll uses only approved pay rules, is approved by someone else and then locked", async () => {
    const t = await hrTeam();
    const staffUser = await createUser(["NURSE"]);
    const e = await employee(t.hr, staffUser.email);
    const existingBasic = await prisma.payComponent.findFirst({
      where: { isBasic: true, status: "APPROVED" },
    });
    const basic =
      existingBasic ??
      (await proposePayComponent(t.hr, {
        code: code("BASIC"),
        name: "Basic salary",
        kind: "EARNING",
        calc: "FIXED",
        isBasic: true,
        note: "Contract",
      }));
    if (!existingBasic) {
      await expect(decidePayComponent(t.hr, { id: basic.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await decidePayComponent(t.owner, { id: basic.id, decision: "APPROVE" });
    }
    const pension = await proposePayComponent(t.hr, {
      code: code("PEN"),
      name: "Pension (employee)",
      kind: "DEDUCTION",
      calc: "PERCENT_OF_BASIC",
      rateBasisPoints: 800,
      isBasic: false,
      note: "Policy ref TEST",
    });
    await expect(
      addPayItem(t.hr, { employeeId: e.id, componentId: pension.id, effectiveFrom: "2025-01-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await decidePayComponent(t.owner, { id: pension.id, decision: "APPROVE" });
    await addPayItem(t.hr, {
      employeeId: e.id,
      componentId: basic.id,
      amountKobo: 200_000_00,
      effectiveFrom: "2025-01-01",
    });
    await addPayItem(t.hr, { employeeId: e.id, componentId: pension.id, effectiveFrom: "2025-01-01" });

    // Use a dedicated branch-month so repeated runs do not collide with an approved run.
    const p = `20${String(30 + Math.floor(Math.random() * 60)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
    const run = await preparePayroll(t.hr, { period: p });
    const slip = await prisma.payslip.findUniqueOrThrow({
      where: { runId_employeeId: { runId: run.id, employeeId: e.id } },
    });
    expect(slip.grossKobo).toBe(200_000_00n);
    expect(slip.deductionsKobo).toBe(16_000_00n);
    expect(slip.netKobo).toBe(184_000_00n);
    await expect(approvePayroll(t.hr, { id: run.id, version: run.version })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await approvePayroll(t.owner, { id: run.id, version: run.version });
    await expect(prisma.payslip.update({ where: { id: slip.id }, data: { netKobo: 1n } })).rejects.toThrow(
      /locked/,
    );
    await expect(preparePayroll(t.hr, { period: p })).rejects.toBeInstanceOf(ConflictError);
    const other = await employee(t.hr);
    await expect(
      prisma.payslip.create({
        data: {
          runId: run.id,
          employeeId: other.id,
          grossKobo: 1n,
          deductionsKobo: 0n,
          netKobo: 1n,
          lines: [],
        },
      }),
    ).rejects.toThrow(/locked/);
    // Staff see their own approved payslips without payroll permissions.
    const mine = await myPayslips(await ctxFor(staffUser.id));
    expect(mine.some((s) => s.id === slip.id)).toBe(true);
  });
});

describe("patient portal (AC20)", () => {
  async function family() {
    const { ctx: records } = await userCtx(["MEDICAL_RECORDS"]);
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const mother = await newPatient(reception, { sexAtBirth: "FEMALE" });
    const child = await newPatient(reception, { dateOfBirth: "2018-02-02" });
    const stranger = await newPatient(reception);
    await prisma.guardianRelationship.create({
      data: {
        dependentPatientId: child.patientId,
        guardianPatientId: mother.patientId,
        guardianName: "Mother",
        relationship: "Mother",
        verified: true,
        verifiedById: records.userId,
        verifiedAt: new Date(),
        createdById: records.userId,
      },
    });
    await visitInConsultation(reception, doctor, child.patientId);
    const doc = (patientId: string, title: string) =>
      prisma.document.create({
        data: {
          patientId,
          kind: "CLINICAL_OTHER",
          title,
          filename: "x.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: "0".repeat(64),
          storageKey: uniq("k"),
          uploadedById: doctor.userId,
        },
      });
    const acct = await createPortalAccount(records, {
      patientId: mother.patientId,
      email: `${uniq("p")}@portal.test`,
    });
    const portal = await ctxFor(acct.userId);
    return { records, doctor, mother, child, stranger, portal, doc };
  }

  it("a guardian sees only released documents of a verified dependant, never others", async () => {
    const f = await family();
    expect(f.portal.kind).toBe("PORTAL");
    const released = await f.doc(f.child.patientId, "Discharge letter");
    const unreleased = await f.doc(f.child.patientId, "Internal note");
    const strangerDoc = await f.doc(f.stranger.patientId, "Other patient");
    await setDocumentRelease(f.doctor, { documentId: released.id, release: true });
    await prisma.document.update({ where: { id: strangerDoc.id }, data: { releasedToPortalAt: new Date() } });

    const home = await portalHome(f.portal);
    expect(home.people.map((p) => p.id).sort()).toEqual([f.mother.patientId, f.child.patientId].sort());
    const rec = await portalRecord(f.portal, f.child.patientId);
    expect(rec.documents.map((d) => d.id)).toEqual([released.id]);
    await expect(authorizePortalDownload(f.portal, unreleased.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(authorizePortalDownload(f.portal, strangerDoc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portalRecord(f.portal, f.stranger.patientId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await authorizePortalDownload(f.portal, released.id)).id).toBe(released.id);
    expect(
      await prisma.auditEvent.count({
        where: { actorUserId: f.portal.userId, action: { startsWith: "denied.portal" } },
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it("unverified or revoked guardianship gives no access; portal users cannot use staff functions", async () => {
    const f = await family();
    await prisma.guardianRelationship.updateMany({
      where: { dependentPatientId: f.child.patientId },
      data: { revokedAt: new Date() },
    });
    await expect(portalRecord(f.portal, f.child.patientId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      searchPatients(f.portal, {
        q: "a",
        page: 1,
        pageSize: 5,
        includeInactive: false,
        provisionalOnly: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createPortalAccount(f.records, { patientId: f.mother.patientId, email: `${uniq("q")}@portal.test` }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("reports and exports (AC21)", () => {
  it("exports need export.data and are audited and watermarked; denials are logged", async () => {
    const { ctx: nurse } = await userCtx(["NURSE"]);
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    await expect(runReport(reception, "diagnoses", todayLocal(), todayLocal())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(exportReport(nurse, "visits", todayLocal(), todayLocal())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(
      await prisma.auditEvent.count({ where: { actorUserId: nurse.userId, action: "denied.export.report" } }),
    ).toBe(1);

    const { ctx: md } = await userCtx(["MEDICAL_DIRECTOR"]);
    const r = await runReport(md, "visits", todayLocal(), todayLocal());
    expect(r.columns).toEqual(["Date", "Visit type", "Visits"]);
    const out = await exportReport(md, "diagnoses", "2026-01-01", todayLocal());
    expect(out.csv).toContain(`Exported by ${md.displayName}`);
    expect(out.csv).toContain("CONFIDENTIAL");
    expect(
      await prisma.auditEvent.count({ where: { actorUserId: md.userId, action: "export.report" } }),
    ).toBe(1);
  });
});

describe("FHIR export", () => {
  it("needs export.data and a care relationship, and is audited", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const { ctx: exporter } = await userCtx(["PHYSICIAN", "MEDICAL_DIRECTOR"]);
    const { ctx: finance } = await userCtx(["FINANCE"]);
    const pt = await newPatient(reception);
    await visitInConsultation(reception, exporter, pt.patientId);
    // Clinician without export.data, and exporter without a care relationship, are both denied.
    await expect(exportPatientFhir(doctor, pt.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportPatientFhir(finance, pt.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    for (const who of [doctor, finance])
      expect(
        await prisma.auditEvent.count({ where: { actorUserId: who.userId, action: "denied.export.fhir" } }),
      ).toBe(1);
    const b = await exportPatientFhir(exporter, pt.patientId);
    expect(b.resourceType).toBe("Bundle");
    expect(b.entry.map((e) => (e.resource as { resourceType: string }).resourceType)).toEqual(
      expect.arrayContaining(["Patient", "Encounter"]),
    );
    expect(
      await prisma.auditEvent.count({ where: { actorUserId: exporter.userId, action: "export.fhir" } }),
    ).toBe(1);
  });
});
