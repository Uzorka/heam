import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { isConstraintViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { localDateTimeToUtc, localDayRange, todayLocal } from "@/lib/time";
import type {
  bookAppointmentSchema,
  cancelAppointmentSchema,
  listAppointmentsSchema,
  rescheduleAppointmentSchema,
} from "@/lib/schemas/scheduling";
import { loadScopedPatient } from "../patients/service";
import { isClinicianInBranch } from "../staff/clinicians";

const OVERLAP_CONSTRAINT = "Appointment_no_clinician_overlap";
/** Allow back-entry of appointments that started within the last hour (e.g. late data entry). */
const PAST_TOLERANCE_MS = 60 * 60_000;

interface SlotInput {
  patientId: string;
  clinicianId?: string;
  date: string;
  time: string;
  durationMin?: number;
  visitTypeId: string;
  override?: { reason: string };
}

async function validateSlot(ctx: AuthContext, db: DbClient, branchId: string, input: SlotInput, excludeAppointmentId?: string) {
  const visitType = await db.visitType.findUnique({ where: { id: input.visitTypeId } });
  if (!visitType || !visitType.active) throw new ValidationError("Choose an active visit type.", { visitTypeId: "Invalid" });
  const startAt = localDateTimeToUtc(input.date, input.time);
  const endAt = new Date(startAt.getTime() + (input.durationMin ?? visitType.defaultDurationMin) * 60_000);
  if (startAt.getTime() < Date.now() - PAST_TOLERANCE_MS) {
    throw new ValidationError("Appointments cannot be booked in the past.", { time: "In the past" });
  }
  if (input.clinicianId && !(await isClinicianInBranch(input.clinicianId, branchId, db))) {
    throw new ValidationError("The selected clinician is not available in this branch.", { clinicianId: "Not available" });
  }
  if (input.override) requirePermission(ctx, "appointment.override", { branchId });

  if (!input.override) {
    const patientClash = await db.appointment.findFirst({
      where: {
        patientId: input.patientId,
        status: { in: ["BOOKED", "CHECKED_IN"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { ref: true },
    });
    if (patientClash) {
      throw new ConflictError(`This patient already has appointment ${patientClash.ref} at an overlapping time.`, "PATIENT_CONFLICT");
    }
  }
  return { visitType, startAt, endAt };
}

function slotConflictError() {
  return new ConflictError(
    "The clinician already has an appointment at an overlapping time. Choose another slot, or use an authorised override.",
    "SLOT_CONFLICT",
  );
}

async function createAppointment(
  tx: Tx,
  ctx: AuthContext,
  branchId: string,
  data: {
    patientId: string;
    visitTypeId: string;
    clinicianId?: string;
    departmentId?: string | null;
    startAt: Date;
    endAt: Date;
    source: z.output<typeof bookAppointmentSchema>["source"];
    reason?: string | null;
    override?: { reason: string };
    rescheduledFromId?: string;
  },
) {
  const year = Number(todayLocal(data.startAt).slice(0, 4));
  const ref = await nextYearlyRef(tx, "APT", year);
  return tx.appointment.create({
    data: {
      ref,
      patientId: data.patientId,
      branchId,
      departmentId: data.departmentId ?? null,
      clinicianId: data.clinicianId ?? null,
      visitTypeId: data.visitTypeId,
      startAt: data.startAt,
      endAt: data.endAt,
      source: data.source,
      reason: data.reason ?? null,
      allowOverlap: !!data.override,
      overrideReason: data.override?.reason ?? null,
      overrideById: data.override ? ctx.userId : null,
      rescheduledFromId: data.rescheduledFromId ?? null,
      createdById: ctx.userId,
    },
  });
}

export async function bookAppointment(
  ctx: AuthContext,
  input: z.output<typeof bookAppointmentSchema>,
  db: DbClient = prisma,
) {
  const branchId = requireActingBranch(ctx, "appointment.manage");
  const patient = await loadScopedPatient(ctx, input.patientId, "patient.search", db);
  if (patient.status !== "ACTIVE") throw new ConflictError(`Cannot book: patient record is ${patient.status.toLowerCase()}.`);
  const { startAt, endAt, visitType } = await validateSlot(ctx, db, branchId, input);
  try {
    return await withTx(db, async (tx) => {
      const appt = await createAppointment(tx, ctx, branchId, {
        ...input,
        departmentId: input.departmentId ?? visitType.departmentId,
        startAt,
        endAt,
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: input.override ? "appointment.book_override" : "appointment.book",
        resourceType: "Appointment",
        resourceId: appt.id,
        patientId: patient.id,
        branchId,
        details: { ref: appt.ref, clinicianId: appt.clinicianId, override: !!input.override },
        meta: ctx.meta,
      });
      return appt;
    });
  } catch (e) {
    if (isConstraintViolation(e, OVERLAP_CONSTRAINT)) throw slotConflictError();
    throw e;
  }
}

async function loadScopedAppointment(ctx: AuthContext, appointmentId: string, db: DbClient) {
  const appt = await db.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) throw new NotFoundError("Appointment not found.");
  requirePermission(ctx, "appointment.manage", { branchId: appt.branchId });
  return appt;
}

export async function rescheduleAppointment(
  ctx: AuthContext,
  input: z.output<typeof rescheduleAppointmentSchema>,
  db: DbClient = prisma,
) {
  const old = await loadScopedAppointment(ctx, input.appointmentId, db);
  if (old.status !== "BOOKED") throw new ConflictError("Only booked appointments can be rescheduled.");
  if (old.version !== input.version) throw new ConflictError("This appointment changed since you opened it. Reload and retry.", "STALE");
  const clinicianId = input.clinicianId ?? old.clinicianId ?? undefined;
  const { startAt, endAt } = await validateSlot(
    ctx,
    db,
    old.branchId,
    { ...input, patientId: old.patientId, clinicianId, visitTypeId: old.visitTypeId },
    old.id,
  );
  try {
    return await withTx(db, async (tx) => {
      const r = await tx.appointment.updateMany({
        where: { id: old.id, version: input.version, status: "BOOKED" },
        data: { status: "RESCHEDULED", version: { increment: 1 } },
      });
      if (r.count !== 1) throw new ConflictError("This appointment changed since you opened it. Reload and retry.", "STALE");
      const appt = await createAppointment(tx, ctx, old.branchId, {
        patientId: old.patientId,
        visitTypeId: old.visitTypeId,
        clinicianId,
        departmentId: old.departmentId,
        startAt,
        endAt,
        source: old.source,
        reason: old.reason,
        override: input.override,
        rescheduledFromId: old.id,
      });
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "appointment.reschedule",
        resourceType: "Appointment",
        resourceId: appt.id,
        patientId: old.patientId,
        branchId: old.branchId,
        details: { fromRef: old.ref, toRef: appt.ref, override: !!input.override },
        meta: ctx.meta,
      });
      return appt;
    });
  } catch (e) {
    if (isConstraintViolation(e, OVERLAP_CONSTRAINT)) throw slotConflictError();
    throw e;
  }
}

export async function cancelAppointment(
  ctx: AuthContext,
  input: z.output<typeof cancelAppointmentSchema>,
  db: DbClient = prisma,
) {
  const appt = await loadScopedAppointment(ctx, input.appointmentId, db);
  if (appt.status !== "BOOKED") throw new ConflictError("Only booked appointments can be cancelled.");
  await withTx(db, async (tx) => {
    const r = await tx.appointment.updateMany({
      where: { id: appt.id, status: "BOOKED" },
      data: { status: "CANCELLED", cancelReason: input.reason, version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictError("This appointment has already changed.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "appointment.cancel",
      resourceType: "Appointment",
      resourceId: appt.id,
      patientId: appt.patientId,
      branchId: appt.branchId,
      meta: ctx.meta,
    });
  });
}

export async function markNoShow(ctx: AuthContext, appointmentId: string, db: DbClient = prisma) {
  const appt = await loadScopedAppointment(ctx, appointmentId, db);
  if (appt.status !== "BOOKED") throw new ConflictError("Only booked appointments can be marked as no-show.");
  if (appt.startAt > new Date()) throw new ConflictError("An appointment cannot be a no-show before its start time.");
  await withTx(db, async (tx) => {
    const r = await tx.appointment.updateMany({
      where: { id: appt.id, status: "BOOKED" },
      data: { status: "NO_SHOW", version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictError("This appointment has already changed.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "appointment.no_show",
      resourceType: "Appointment",
      resourceId: appt.id,
      patientId: appt.patientId,
      branchId: appt.branchId,
      meta: ctx.meta,
    });
  });
}

export async function listAppointmentsForDay(
  ctx: AuthContext,
  input: z.output<typeof listAppointmentsSchema>,
  db: DbClient = prisma,
) {
  const branchId = requireActingBranch(ctx, "appointment.read");
  const { start, end } = localDayRange(input.date);
  return db.appointment.findMany({
    where: {
      branchId,
      startAt: { gte: start, lt: end },
      ...(input.clinicianId ? { clinicianId: input.clinicianId } : {}),
    },
    orderBy: [{ startAt: "asc" }],
    take: 500,
    include: {
      patient: {
        select: { id: true, mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true, phoneE164: true },
      },
      clinician: { select: { id: true, displayName: true } },
      visitType: { select: { id: true, name: true } },
      encounter: { select: { id: true, ref: true, queueStage: true } },
    },
  });
}

export async function listPatientAppointments(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  requirePermission(ctx, "appointment.read");
  await loadScopedPatient(ctx, patientId, "patient.read", db);
  return db.appointment.findMany({
    where: { patientId },
    orderBy: { startAt: "desc" },
    take: 100,
    include: {
      clinician: { select: { displayName: true } },
      visitType: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });
}
