/**
 * Phase 6 demo content. FICTIONAL. Employee records for some demo staff, DEMO pay components
 * (amounts and rates are placeholders, NOT statutory figures - payroll must enter real rules from
 * an authoritative source before go-live), one approved demo payroll run, a roster for today and a
 * patient portal login for demo patient Ngozi Okafor (who has a verified demo lab result).
 */
import type { PrismaClient } from "@prisma/client";
import { calendarDateToUtcMidnight, localDateTimeToUtc, todayLocal } from "../src/lib/time";
import { encryptField } from "../src/server/crypto";
import { computePayslip } from "../src/server/domains/hr/payroll";

const STAFF: [key: string, staffNo: string, title: string, dept: string, basicNaira: number][] = [
  ["doctor", "DEMO-001", "Medical Officer", "Medicine", 450_000],
  ["nurse", "DEMO-002", "Staff Nurse", "Nursing", 220_000],
  ["midwife", "DEMO-003", "Midwife", "Maternity", 240_000],
  ["reception", "DEMO-004", "Front Desk Officer", "Administration", 120_000],
  ["hr", "DEMO-005", "HR & Payroll Officer", "Administration", 200_000],
];

export async function seedHr(
  prisma: PrismaClient,
  users: Record<string, string>,
  branchId: string,
  passwordHash: string,
) {
  let changed = false;
  const COMPONENTS = [
    {
      code: "DEMO_BASIC",
      name: "Basic salary (DEMO)",
      kind: "EARNING",
      calc: "FIXED",
      isBasic: true,
      rate: null,
    },
    {
      code: "DEMO_HOUSING",
      name: "Housing allowance (DEMO)",
      kind: "EARNING",
      calc: "FIXED",
      isBasic: false,
      rate: null,
    },
    {
      code: "DEMO_PENSION",
      name: "Pension deduction (DEMO rate)",
      kind: "DEDUCTION",
      calc: "PERCENT_OF_BASIC",
      isBasic: false,
      rate: 500,
    },
  ] as const;
  const comp: Record<string, string> = {};
  for (const c of COMPONENTS) {
    const existing = await prisma.payComponent.findUnique({ where: { code: c.code } });
    if (existing) {
      comp[c.code] = existing.id;
      continue;
    }
    const created = await prisma.payComponent.create({
      data: {
        code: c.code,
        name: c.name,
        kind: c.kind,
        calc: c.calc,
        isBasic: c.isBasic,
        rateBasisPoints: c.rate,
        status: "APPROVED",
        note: "DEMO placeholder for local testing - not a statutory rate. Replace from an authoritative source.",
        createdById: users.hr!,
        decidedById: users.owner!,
        decidedAt: new Date(),
      },
    });
    comp[c.code] = created.id;
    changed = true;
  }

  const start = calendarDateToUtcMidnight("2025-01-01");
  for (const [key, staffNumber, jobTitle, department, basic] of STAFF) {
    const userId = users[key];
    if (!userId || (await prisma.employee.findUnique({ where: { staffNumber } }))) continue;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const e = await prisma.employee.create({
      data: {
        staffNumber,
        userId,
        branchId,
        givenName: u.givenName,
        familyName: u.familyName,
        jobTitle,
        department,
        employmentType: "PERMANENT",
        startDate: start,
        bankName: "DEMO Bank",
        bankAccountEnc: encryptField("0000000000"),
        bankAccountLast4: "0000",
        createdById: users.hr!,
      },
    });
    await prisma.employeePayItem.createMany({
      data: [
        {
          employeeId: e.id,
          componentId: comp.DEMO_BASIC!,
          amountKobo: BigInt(basic * 100),
          effectiveFrom: start,
          createdById: users.hr!,
        },
        {
          employeeId: e.id,
          componentId: comp.DEMO_HOUSING!,
          amountKobo: BigInt(Math.round(basic * 0.2) * 100),
          effectiveFrom: start,
          createdById: users.hr!,
        },
        {
          employeeId: e.id,
          componentId: comp.DEMO_PENSION!,
          amountKobo: null,
          effectiveFrom: start,
          createdById: users.hr!,
        },
      ],
    });
    if (key === "doctor" || key === "nurse" || key === "midwife") {
      await prisma.professionalCredential.create({
        data: {
          employeeId: e.id,
          kind: key === "doctor" ? "Medical registration (DEMO)" : "Nursing/midwifery licence (DEMO)",
          number: `DEMO-${staffNumber}`,
          issuer: "DEMO issuing body",
          expiresAt: calendarDateToUtcMidnight(`${Number(todayLocal().slice(0, 4)) + 1}-12-31`),
        },
      });
    }
    changed = true;
  }

  // Today's roster for the clinical demo staff (skips anyone already rostered).
  const today = todayLocal();
  for (const [staffNumber, from, to, kind, location] of [
    ["DEMO-001", "08:00", "16:00", "MORNING", "Outpatients"],
    ["DEMO-002", "08:00", "20:00", "MORNING", "General ward"],
    ["DEMO-003", "20:00", "08:00", "NIGHT", "Maternity"],
  ] as const) {
    const e = await prisma.employee.findUnique({ where: { staffNumber } });
    if (!e) continue;
    const startAt = localDateTimeToUtc(today, from);
    const endAt = new Date(localDateTimeToUtc(today, to).getTime() + (to <= from ? 86_400_000 : 0));
    if (await prisma.rosterShift.findFirst({ where: { employeeId: e.id, startAt } })) continue;
    await prisma.rosterShift.create({
      data: {
        employeeId: e.id,
        branchId: e.branchId,
        kind,
        startAt,
        endAt,
        location,
        createdById: users.hr!,
      },
    });
    changed = true;
  }

  // One approved DEMO payroll run for last month so self-service payslips can be seen.
  const [y, m] = today.split("-").map(Number) as [number, number];
  const period = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  if (!(await prisma.payrollRun.findFirst({ where: { branchId, period, status: { not: "CANCELLED" } } }))) {
    const employees = await prisma.employee.findMany({
      where: { branchId, staffNumber: { startsWith: "DEMO-" } },
      include: { payItems: { where: { effectiveTo: null }, include: { component: true } } },
    });
    await prisma.$transaction(async (tx) => {
      const slips = employees.map((e) => ({ e, ...computePayslip(e.payItems) }));
      const run = await tx.payrollRun.create({
        data: {
          ref: `PAY-DEMO-${period}`,
          branchId,
          period,
          grossKobo: slips.reduce((s, x) => s + x.gross, 0n),
          deductionsKobo: slips.reduce((s, x) => s + x.deductions, 0n),
          netKobo: slips.reduce((s, x) => s + x.net, 0n),
          preparedById: users.hr!,
          note: "DEMO run - fictional amounts",
        },
      });
      await tx.payslip.createMany({
        data: slips.map((s) => ({
          runId: run.id,
          employeeId: s.e.id,
          grossKobo: s.gross,
          deductionsKobo: s.deductions,
          netKobo: s.net,
          lines: s.lines as never,
        })),
      });
      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "APPROVED", approvedById: users.owner!, approvedAt: new Date() },
      });
    });
    changed = true;
  }

  // Patient portal login for demo patient Ngozi Okafor.
  const portalPatient = await prisma.patient.findFirst({
    where: { isDemo: true, givenName: "Ngozi", familyName: "Okafor" },
  });
  const role = await prisma.role.findUnique({ where: { code: "PATIENT" } });
  if (
    portalPatient &&
    role &&
    !(await prisma.portalAccount.findUnique({ where: { patientId: portalPatient.id } }))
  ) {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          kind: "PORTAL",
          email: "patient@demo.aduraking.test",
          givenName: portalPatient.givenName,
          familyName: portalPatient.familyName,
          displayName: `${portalPatient.givenName} ${portalPatient.familyName}`,
          passwordHash,
          isDemo: true,
        },
      });
      await tx.userRole.create({
        data: { userId: user.id, roleId: role.id, allBranches: true, reason: "Demo seed" },
      });
      await tx.portalAccount.create({
        data: { userId: user.id, patientId: portalPatient.id, createdById: users.records! },
      });
      // Release one of her verified results, as a clinician would.
      const order = await tx.serviceOrder.findFirst({
        where: { patientId: portalPatient.id, status: { in: ["VERIFIED", "COMPLETED"] }, kind: "LAB" },
      });
      if (order)
        await tx.serviceOrder.update({
          where: { id: order.id },
          data: { releasedToPortalAt: new Date(), releasedToPortalById: users.doctor! },
        });
    });
    changed = true;
  }
  return changed;
}
