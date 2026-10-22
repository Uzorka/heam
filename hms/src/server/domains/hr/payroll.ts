import type { PayComponent } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { percentOfKobo } from "@/lib/money";
import { calendarDateToUtcMidnight } from "@/lib/time";
import type { payComponentSchema, payItemSchema, payrollRunSchema } from "@/lib/schemas/hr";

export async function listPayComponents(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "payroll.read");
  return db.payComponent.findMany({
    where: { status: { in: ["DRAFT", "APPROVED"] } },
    orderBy: [{ kind: "asc" }, { code: "asc" }],
  });
}

export async function proposePayComponent(
  ctx: AuthContext,
  input: z.output<typeof payComponentSchema>,
  db: DbClient = prisma,
) {
  requirePermission(ctx, "payroll.run");
  try {
    return await withTx(db, async (tx) => {
      const c = await tx.payComponent.create({
        data: {
          code: input.code,
          name: input.name,
          kind: input.kind,
          calc: input.calc,
          rateBasisPoints: input.calc === "PERCENT_OF_BASIC" ? input.rateBasisPoints! : null,
          isBasic: input.isBasic,
          note: input.note,
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "payroll.component.propose",
        resourceType: "PayComponent",
        resourceId: c.id,
        details: { code: c.code, calc: c.calc, rate: c.rateBasisPoints },
        meta: ctx.meta,
      });
      return c;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A pay component with this code already exists.");
    throw e;
  }
}

/** Pay rules are approved by a payroll approver who did not propose them. */
export async function decidePayComponent(
  ctx: AuthContext,
  input: { id: string; decision: "APPROVE" | "REJECT" },
  db: DbClient = prisma,
) {
  requirePermission(ctx, "payroll.approve");
  const c = await db.payComponent.findUnique({ where: { id: input.id } });
  if (!c) throw new NotFoundError("Pay component not found.");
  if (c.status !== "DRAFT") throw new ConflictError("Already decided.");
  if (c.createdById === ctx.userId)
    throw new ForbiddenError("Pay rules are approved by someone other than the proposer.", "payroll.approve");
  try {
    await withTx(db, async (tx) => {
      await tx.payComponent.update({
        where: { id: c.id },
        data: {
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedById: ctx.userId,
          decidedAt: new Date(),
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: input.decision === "APPROVE" ? "payroll.component.approve" : "payroll.component.reject",
        resourceType: "PayComponent",
        resourceId: c.id,
        meta: ctx.meta,
      });
    });
  } catch (e) {
    if (String(e).includes("PayComponent_one_basic") || isUniqueViolation(e))
      throw new ConflictError("Only one approved basic pay component may exist.");
    throw e;
  }
}

export async function addPayItem(
  ctx: AuthContext,
  input: z.output<typeof payItemSchema>,
  db: DbClient = prisma,
) {
  const [e, c] = await Promise.all([
    db.employee.findUnique({ where: { id: input.employeeId } }),
    db.payComponent.findUnique({ where: { id: input.componentId } }),
  ]);
  if (!e) throw new NotFoundError("Employee not found.");
  requirePermission(ctx, "payroll.run", { branchId: e.branchId });
  if (!c || c.status !== "APPROVED") throw new ValidationError("Choose an approved pay component.");
  if (c.calc === "FIXED" && input.amountKobo === undefined)
    throw new ValidationError("Enter the amount.", { amountKobo: "Required" });
  const from = calendarDateToUtcMidnight(input.effectiveFrom);
  return withTx(db, async (tx) => {
    // A new amount for the same component ends the previous one.
    await tx.employeePayItem.updateMany({
      where: { employeeId: e.id, componentId: c.id, effectiveTo: null, effectiveFrom: { lt: from } },
      data: { effectiveTo: from },
    });
    const item = await tx.employeePayItem.create({
      data: {
        employeeId: e.id,
        componentId: c.id,
        amountKobo: c.calc === "FIXED" ? BigInt(input.amountKobo!) : null,
        effectiveFrom: from,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "payroll.item.set",
      resourceType: "Employee",
      resourceId: e.id,
      details: {
        component: c.code,
        amountKobo: input.amountKobo !== undefined ? String(input.amountKobo) : null,
        effectiveFrom: input.effectiveFrom,
      },
      meta: ctx.meta,
    });
    return item;
  });
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: "EARNING" | "DEDUCTION";
  amountKobo: string;
}

/**
 * Deterministic payslip from configured, approved components: fixed amounts as assigned, percentage
 * components as a share of the employee's basic pay. Nothing else is calculated.
 */
export function computePayslip(items: { component: PayComponent; amountKobo: bigint | null }[]) {
  const basic = items.find((i) => i.component.isBasic)?.amountKobo ?? 0n;
  const lines: PayslipLine[] = items
    .map((i) => {
      const amount =
        i.component.calc === "FIXED"
          ? (i.amountKobo ?? 0n)
          : percentOfKobo(basic, i.component.rateBasisPoints ?? 0);
      return {
        code: i.component.code,
        name: i.component.name,
        kind: i.component.kind,
        amountKobo: amount.toString(),
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === "EARNING" ? -1 : 1));
  const gross = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + BigInt(l.amountKobo), 0n);
  const deductions = lines
    .filter((l) => l.kind === "DEDUCTION")
    .reduce((s, l) => s + BigInt(l.amountKobo), 0n);
  return { lines, gross, deductions, net: gross - deductions };
}

function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  return { start, end };
}

/** Prepare (or re-prepare) a draft payroll run for the acting branch and month. */
export async function preparePayroll(
  ctx: AuthContext,
  input: z.output<typeof payrollRunSchema>,
  db: DbClient = prisma,
) {
  const branchId = requireActingBranch(ctx, "payroll.run");
  const { start, end } = periodBounds(input.period);
  const employees = await db.employee.findMany({
    where: {
      branchId,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      status: { not: "EXITED" },
    },
    include: {
      payItems: {
        where: {
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
          component: { status: "APPROVED" },
        },
        include: { component: true },
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });
  const slips = employees.map((e) => {
    // Latest item per component within the month.
    const latest = new Map<string, (typeof e.payItems)[number]>();
    for (const i of e.payItems) if (!latest.has(i.componentId)) latest.set(i.componentId, i);
    return {
      employee: e,
      ...computePayslip(
        [...latest.values()].map((i) => ({ component: i.component, amountKobo: i.amountKobo })),
      ),
    };
  });
  const negative = slips.filter((s) => s.net < 0n);
  if (negative.length)
    throw new ValidationError(
      `Deductions exceed pay for: ${negative.map((s) => s.employee.staffNumber).join(", ")}. Review their pay items.`,
    );
  try {
    return await withTx(db, async (tx) => {
      let run = await tx.payrollRun.findFirst({ where: { branchId, period: input.period, status: "DRAFT" } });
      if (run) {
        await tx.payslip.deleteMany({ where: { runId: run.id } });
      } else {
        run = await tx.payrollRun.create({
          data: {
            ref: await nextYearlyRef(tx, "PAY", Number(input.period.slice(0, 4))),
            branchId,
            period: input.period,
            preparedById: ctx.userId,
            note: input.note ?? null,
          },
        });
      }
      for (const s of slips)
        await tx.payslip.create({
          data: {
            runId: run.id,
            employeeId: s.employee.id,
            grossKobo: s.gross,
            deductionsKobo: s.deductions,
            netKobo: s.net,
            lines: s.lines as never,
          },
        });
      const totals = slips.reduce((t, s) => ({ g: t.g + s.gross, d: t.d + s.deductions, n: t.n + s.net }), {
        g: 0n,
        d: 0n,
        n: 0n,
      });
      run = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          grossKobo: totals.g,
          deductionsKobo: totals.d,
          netKobo: totals.n,
          preparedById: ctx.userId,
          preparedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "payroll.run.prepare",
        resourceType: "PayrollRun",
        resourceId: run.id,
        details: { period: input.period, employees: slips.length, netKobo: totals.n.toString() },
        meta: ctx.meta,
      });
      return run;
    });
  } catch (e) {
    if (String(e).includes("PayrollRun_one_per_period") || isUniqueViolation(e))
      throw new ConflictError("A payroll run for that month is already approved.");
    throw e;
  }
}

/** Approval locks the run and its payslips (database trigger). Approver ≠ preparer. */
export async function approvePayroll(
  ctx: AuthContext,
  input: { id: string; version: number },
  db: DbClient = prisma,
) {
  const run = await db.payrollRun.findUnique({ where: { id: input.id } });
  if (!run) throw new NotFoundError("Payroll run not found.");
  requirePermission(ctx, "payroll.approve", { branchId: run.branchId });
  if (run.status !== "DRAFT") throw new ConflictError("This run is not a draft.");
  if (run.preparedById === ctx.userId)
    throw new ForbiddenError("Payroll is approved by someone other than the preparer.", "payroll.approve");
  await withTx(db, async (tx) => {
    const r = await tx.payrollRun.updateMany({
      where: { id: run.id, version: input.version, status: "DRAFT" },
      data: {
        status: "APPROVED",
        approvedById: ctx.userId,
        approvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("The run changed. Review it again before approving.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "payroll.run.approve",
      resourceType: "PayrollRun",
      resourceId: run.id,
      details: { period: run.period, netKobo: run.netKobo.toString() },
      meta: ctx.meta,
    });
  });
}

export async function listPayrollRuns(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "payroll.read");
  return db.payrollRun.findMany({
    where: { branchId },
    orderBy: { period: "desc" },
    take: 36,
    include: { _count: { select: { payslips: true } } },
  });
}

export async function getPayrollRun(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: {
      payslips: {
        include: {
          employee: {
            select: {
              staffNumber: true,
              givenName: true,
              familyName: true,
              jobTitle: true,
              bankName: true,
              bankAccountLast4: true,
            },
          },
        },
      },
    },
  });
  if (!run || !can(ctx, "payroll.read", { branchId: run.branchId }))
    throw new NotFoundError("Payroll run not found.");
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "payroll.run.view",
    resourceType: "PayrollRun",
    resourceId: run.id,
    meta: ctx.meta,
  });
  return run;
}

/** Self-service: the signed-in member of staff's own approved payslips (no payroll permission needed). */
export async function myPayslips(ctx: AuthContext, db: DbClient = prisma) {
  const e = await db.employee.findUnique({ where: { userId: ctx.userId } });
  if (!e) return [];
  return db.payslip.findMany({
    where: { employeeId: e.id, run: { status: "APPROVED" } },
    orderBy: { run: { period: "desc" } },
    include: { run: { select: { period: true, ref: true } } },
  });
}

/** Current and past pay items for one employee (payroll staff only). */
export async function employeePayItems(ctx: AuthContext, employeeId: string, db: DbClient = prisma) {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { branchId: true } });
  if (!e || !can(ctx, "payroll.read", { branchId: e.branchId }))
    throw new NotFoundError("Employee not found.");
  return db.employeePayItem.findMany({
    where: { employeeId },
    orderBy: [{ effectiveTo: { sort: "asc", nulls: "first" } }, { effectiveFrom: "desc" }],
    include: {
      component: { select: { code: true, name: true, kind: true, calc: true, rateBasisPoints: true } },
    },
  });
}
