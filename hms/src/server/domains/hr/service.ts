import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import {
  branchesWith,
  can,
  requireActingBranch,
  requirePermission,
  type AuthContext,
} from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import { encryptField } from "../../crypto";
import { calendarDateToUtcMidnight, localDateTimeToUtc } from "@/lib/time";
import type {
  credentialSchema,
  employeeSchema,
  employeeStatusSchema,
  leaveSchema,
  shiftSchema,
  verifyCredentialSchema,
} from "@/lib/schemas/hr";

const DAY = 86_400_000;

function scope(ctx: AuthContext, permission: "hr.read" | "hr.manage" | "hr.roster.manage" = "hr.read") {
  const b = branchesWith(ctx, permission);
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, permission);
  return b === "ALL" ? {} : { branchId: { in: b } };
}

/** HR staff directory. Contains no patient information; bank numbers are never returned in full. */
export async function listEmployees(
  ctx: AuthContext,
  opts: { q?: string; status?: string } = {},
  db: DbClient = prisma,
) {
  return db.employee.findMany({
    where: {
      ...scope(ctx),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.q
        ? {
            OR: [
              { givenName: { contains: opts.q, mode: "insensitive" } },
              { familyName: { contains: opts.q, mode: "insensitive" } },
              { staffNumber: { contains: opts.q, mode: "insensitive" } },
              { jobTitle: { contains: opts.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    take: 500,
    select: {
      id: true,
      staffNumber: true,
      givenName: true,
      familyName: true,
      jobTitle: true,
      department: true,
      employmentType: true,
      status: true,
      startDate: true,
      credentials: { select: { kind: true, expiresAt: true, verified: true } },
    },
  });
}

export async function getEmployee(ctx: AuthContext, id: string, db: DbClient = prisma) {
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      credentials: { orderBy: { createdAt: "asc" } },
      leave: { orderBy: { requestedAt: "desc" }, take: 20 },
      shifts: {
        where: { cancelledAt: null, endAt: { gt: new Date(Date.now() - 7 * DAY) } },
        orderBy: { startAt: "asc" },
        take: 30,
      },
      attendance: { orderBy: { at: "desc" }, take: 20 },
    },
  });
  if (!e || !can(ctx, "hr.read", { branchId: e.branchId })) throw new NotFoundError("Employee not found.");
  const { bankAccountEnc: _secret, ...safe } = e;
  void _secret;
  return safe;
}

export async function saveEmployee(
  ctx: AuthContext,
  input: z.output<typeof employeeSchema>,
  db: DbClient = prisma,
) {
  const branchId = requireActingBranch(ctx, "hr.manage");
  let userId: string | null | undefined = undefined;
  if (input.userEmail) {
    const u = await db.user.findUnique({ where: { email: input.userEmail } });
    if (!u || u.kind !== "STAFF")
      throw new ValidationError("No staff login with that email.", { userEmail: "Not found" });
    userId = u.id;
  }
  const data = {
    staffNumber: input.staffNumber,
    givenName: input.givenName,
    familyName: input.familyName,
    jobTitle: input.jobTitle,
    department: input.department ?? null,
    employmentType: input.employmentType,
    startDate: calendarDateToUtcMidnight(input.startDate),
    phoneE164: input.phone ?? null,
    email: input.email ?? null,
    bankName: input.bankName ?? null,
    ...(input.bankAccount
      ? { bankAccountEnc: encryptField(input.bankAccount), bankAccountLast4: input.bankAccount.slice(-4) }
      : {}),
    ...(userId !== undefined ? { userId } : {}),
  };
  try {
    return await withTx(db, async (tx) => {
      let e;
      if (input.id) {
        const existing = await tx.employee.findUnique({ where: { id: input.id } });
        if (!existing || !can(ctx, "hr.manage", { branchId: existing.branchId }))
          throw new NotFoundError("Employee not found.");
        e = await tx.employee.update({
          where: { id: input.id },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        e = await tx.employee.create({ data: { ...data, branchId, createdById: ctx.userId } });
      }
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: input.id ? "hr.employee.update" : "hr.employee.create",
        resourceType: "Employee",
        resourceId: e.id,
        details: { staffNumber: e.staffNumber, bankChanged: !!input.bankAccount },
        meta: ctx.meta,
      });
      return e;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError("That staff number or login is already linked to another employee.");
    throw e;
  }
}

export async function setEmployeeStatus(
  ctx: AuthContext,
  input: z.output<typeof employeeStatusSchema>,
  db: DbClient = prisma,
) {
  const e = await db.employee.findUnique({ where: { id: input.id } });
  if (!e) throw new NotFoundError("Employee not found.");
  requirePermission(ctx, "hr.manage", { branchId: e.branchId });
  if (input.status === "EXITED" && !input.endDate) throw new ValidationError("Enter the last working day.");
  await withTx(db, async (tx) => {
    await tx.employee.update({
      where: { id: e.id },
      data: {
        status: input.status,
        endDate: input.endDate ? calendarDateToUtcMidnight(input.endDate) : e.endDate,
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hr.employee.status",
      resourceType: "Employee",
      resourceId: e.id,
      details: { from: e.status, to: input.status, reason: input.reason },
      meta: ctx.meta,
    });
  });
}

export async function addCredential(
  ctx: AuthContext,
  input: z.output<typeof credentialSchema>,
  db: DbClient = prisma,
) {
  const e = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!e) throw new NotFoundError("Employee not found.");
  requirePermission(ctx, "hr.manage", { branchId: e.branchId });
  return withTx(db, async (tx) => {
    const c = await tx.professionalCredential.create({
      data: { ...input, expiresAt: input.expiresAt ? calendarDateToUtcMidnight(input.expiresAt) : null },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hr.credential.add",
      resourceType: "Employee",
      resourceId: e.id,
      details: { kind: input.kind },
      meta: ctx.meta,
    });
    return c;
  });
}

/** Credentials are marked verified only with a record of how (e.g. regulator register checked). */
export async function verifyCredential(
  ctx: AuthContext,
  input: z.output<typeof verifyCredentialSchema>,
  db: DbClient = prisma,
) {
  const c = await db.professionalCredential.findUnique({
    where: { id: input.id },
    include: { employee: true },
  });
  if (!c) throw new NotFoundError("Credential not found.");
  requirePermission(ctx, "hr.manage", { branchId: c.employee.branchId });
  if (c.employee.userId === ctx.userId)
    throw new ForbiddenError("You cannot verify your own credential.", "hr.manage");
  await withTx(db, async (tx) => {
    await tx.professionalCredential.update({
      where: { id: c.id },
      data: { verified: true, verifiedById: ctx.userId, verifiedAt: new Date(), evidence: input.evidence },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hr.credential.verify",
      resourceType: "Employee",
      resourceId: c.employeeId,
      details: { kind: c.kind },
      meta: ctx.meta,
    });
  });
}

// ───────────── Rosters and attendance ─────────────

export async function addShift(ctx: AuthContext, input: z.output<typeof shiftSchema>, db: DbClient = prisma) {
  const e = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!e || e.status === "EXITED") throw new NotFoundError("Employee not found.");
  requirePermission(ctx, "hr.roster.manage", { branchId: e.branchId });
  const startAt = localDateTimeToUtc(input.date, input.startTime);
  let endAt = localDateTimeToUtc(input.date, input.endTime);
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + DAY); // overnight shift
  try {
    return await withTx(db, async (tx) => {
      const s = await tx.rosterShift.create({
        data: {
          employeeId: e.id,
          branchId: e.branchId,
          kind: input.kind,
          location: input.location ?? null,
          note: input.note ?? null,
          startAt,
          endAt,
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "hr.roster.add",
        resourceType: "RosterShift",
        resourceId: s.id,
        details: { employee: e.staffNumber, startAt: startAt.toISOString() },
        meta: ctx.meta,
      });
      return s;
    });
  } catch (err) {
    if (String(err).includes("RosterShift_no_overlap"))
      throw new ConflictError("This person is already rostered at that time.");
    throw err;
  }
}

export async function cancelShift(
  ctx: AuthContext,
  input: { id: string; reason: string },
  db: DbClient = prisma,
) {
  const s = await db.rosterShift.findUnique({ where: { id: input.id } });
  if (!s) throw new NotFoundError("Shift not found.");
  requirePermission(ctx, "hr.roster.manage", { branchId: s.branchId });
  if (s.cancelledAt) throw new ConflictError("Already cancelled.");
  await withTx(db, async (tx) => {
    await tx.rosterShift.update({
      where: { id: s.id },
      data: { cancelledAt: new Date(), note: `${s.note ? `${s.note} · ` : ""}Cancelled: ${input.reason}` },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hr.roster.cancel",
      resourceType: "RosterShift",
      resourceId: s.id,
      details: { reason: input.reason },
      meta: ctx.meta,
    });
  });
}

export async function roster(ctx: AuthContext, from: Date, days: number, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "hr.read");
  return db.rosterShift.findMany({
    where: {
      branchId,
      cancelledAt: null,
      startAt: { lt: new Date(from.getTime() + days * DAY) },
      endAt: { gt: from },
    },
    orderBy: { startAt: "asc" },
    include: {
      employee: {
        select: { id: true, staffNumber: true, givenName: true, familyName: true, jobTitle: true },
      },
    },
  });
}

/** The signed-in user's own employee record (for self-service clock in/out, leave and payslips). */
export async function myEmployee(ctx: AuthContext, db: DbClient = prisma) {
  return db.employee.findUnique({ where: { userId: ctx.userId } });
}

export async function clock(
  ctx: AuthContext,
  input: { kind: "CLOCK_IN" | "CLOCK_OUT"; employeeId?: string; note?: string },
  db: DbClient = prisma,
) {
  const self = await myEmployee(ctx, db);
  const employee = input.employeeId
    ? await db.employee.findUnique({ where: { id: input.employeeId } })
    : self;
  if (!employee) throw new NotFoundError("No employee record is linked to your login.");
  if (employee.id !== self?.id) requirePermission(ctx, "hr.roster.manage", { branchId: employee.branchId });
  const last = await db.attendanceRecord.findFirst({
    where: { employeeId: employee.id },
    orderBy: { at: "desc" },
  });
  if (last?.kind === input.kind)
    throw new ConflictError(input.kind === "CLOCK_IN" ? "Already clocked in." : "Already clocked out.");
  return withTx(db, async (tx) => {
    const r = await tx.attendanceRecord.create({
      data: { employeeId: employee.id, kind: input.kind, recordedById: ctx.userId, note: input.note ?? null },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: `hr.attendance.${input.kind.toLowerCase()}`,
      resourceType: "Employee",
      resourceId: employee.id,
      details: { bySupervisor: employee.id !== self?.id },
      meta: ctx.meta,
    });
    return r;
  });
}

// ───────────── Leave ─────────────

export async function requestLeave(
  ctx: AuthContext,
  input: z.output<typeof leaveSchema>,
  db: DbClient = prisma,
) {
  const self = await myEmployee(ctx, db);
  const employee = input.employeeId
    ? await db.employee.findUnique({ where: { id: input.employeeId } })
    : self;
  if (!employee) throw new NotFoundError("No employee record is linked to your login.");
  if (employee.id !== self?.id) requirePermission(ctx, "hr.manage", { branchId: employee.branchId });
  if (input.endDate < input.startDate) throw new ValidationError("Leave must end on or after it starts.");
  const days = Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / DAY) + 1;
  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: calendarDateToUtcMidnight(input.endDate) },
      endDate: { gte: calendarDateToUtcMidnight(input.startDate) },
    },
  });
  if (overlap) throw new ConflictError("This overlaps another leave request.");
  return withTx(db, async (tx) => {
    const l = await tx.leaveRequest.create({
      data: {
        employeeId: employee.id,
        type: input.type,
        startDate: calendarDateToUtcMidnight(input.startDate),
        endDate: calendarDateToUtcMidnight(input.endDate),
        days,
        reason: input.reason,
        requestedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "hr.leave.request",
      resourceType: "LeaveRequest",
      resourceId: l.id,
      details: { type: input.type, days },
      meta: ctx.meta,
    });
    return l;
  });
}

export async function decideLeave(
  ctx: AuthContext,
  input: { id: string; decision: "APPROVE" | "REJECT"; note?: string },
  db: DbClient = prisma,
) {
  const l = await db.leaveRequest.findUnique({ where: { id: input.id }, include: { employee: true } });
  if (!l) throw new NotFoundError("Leave request not found.");
  requirePermission(ctx, "hr.leave.approve", { branchId: l.employee.branchId });
  if (l.status !== "PENDING") throw new ConflictError("Already decided.");
  if (l.requestedById === ctx.userId || l.employee.userId === ctx.userId)
    throw new ForbiddenError("Leave is approved by someone other than the requester.", "hr.leave.approve");
  await withTx(db, async (tx) => {
    const r = await tx.leaveRequest.updateMany({
      where: { id: l.id, status: "PENDING" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });
    if (r.count !== 1) throw new ConflictError("Already decided.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "hr.leave.approve" : "hr.leave.reject",
      resourceType: "LeaveRequest",
      resourceId: l.id,
      meta: ctx.meta,
    });
  });
}

export async function pendingLeave(ctx: AuthContext, db: DbClient = prisma) {
  return db.leaveRequest.findMany({
    where: { status: "PENDING", employee: scope(ctx, "hr.read") },
    orderBy: { requestedAt: "asc" },
    include: {
      employee: { select: { id: true, staffNumber: true, givenName: true, familyName: true, userId: true } },
    },
  });
}

/** Self-service view: the signed-in member of staff's own shifts, leave and attendance only. */
export async function mySelfService(ctx: AuthContext, db: DbClient = prisma) {
  const e = await myEmployee(ctx, db);
  if (!e) return null;
  const [shifts, leave, lastAttendance] = await Promise.all([
    db.rosterShift.findMany({
      where: { employeeId: e.id, cancelledAt: null, endAt: { gt: new Date() } },
      orderBy: { startAt: "asc" },
      take: 14,
    }),
    db.leaveRequest.findMany({ where: { employeeId: e.id }, orderBy: { requestedAt: "desc" }, take: 10 }),
    db.attendanceRecord.findFirst({ where: { employeeId: e.id }, orderBy: { at: "desc" } }),
  ]);
  return {
    employee: { id: e.id, staffNumber: e.staffNumber, jobTitle: e.jobTitle, givenName: e.givenName },
    shifts,
    leave,
    lastAttendance,
  };
}
