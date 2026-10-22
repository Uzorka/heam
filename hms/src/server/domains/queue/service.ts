import type { QueueStage } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "../../errors";
import { isConstraintViolation } from "../../db-errors";
import { nextYearlyRef } from "../../sequence";
import { localDayRange, todayLocal } from "@/lib/time";
import type { assignClinicianSchema, checkInSchema, transitionSchema } from "@/lib/schemas/scheduling";
import { loadScopedPatient } from "../patients/service";
import { isClinicianInBranch } from "../staff/clinicians";
import { getSetting } from "../settings/system-settings";
import {
  ACTIVE_STAGES,
  STAGE_ENTRY_PERMISSION,
  STAGES_REQUIRING_NOTE,
  TERMINAL_STAGES,
  canTransition,
} from "./state-machine";

const OPEN_ENCOUNTER_INDEX = "Encounter_one_open_per_patient_branch";

export async function checkIn(ctx: AuthContext, input: z.output<typeof checkInSchema>, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "queue.manage");
  const initialStage = await getSetting(db, "queue.initialStage");

  let patientId = input.patientId;
  let visitTypeId = input.visitTypeId;
  let clinicianId = input.clinicianId;
  let departmentId: string | null = null;
  let appointmentId: string | undefined;
  if (input.appointmentId) {
    const appt = await db.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appt || appt.branchId !== branchId) throw new NotFoundError("Appointment not found in this branch.");
    if (appt.status !== "BOOKED") throw new ConflictError(`This appointment is ${appt.status.toLowerCase().replace("_", " ")}.`);
    const { start, end } = localDayRange(todayLocal());
    if (appt.startAt < start || appt.startAt >= end) {
      throw new ConflictError("Only today's appointments can be checked in. Reschedule the appointment first.");
    }
    patientId = appt.patientId;
    visitTypeId = appt.visitTypeId;
    clinicianId = clinicianId ?? appt.clinicianId ?? undefined;
    departmentId = appt.departmentId;
    appointmentId = appt.id;
  }
  if (!patientId || !visitTypeId) throw new ValidationError("Patient and visit type are required.");

  const patient = await loadScopedPatient(ctx, patientId, "patient.search", db);
  if (patient.status !== "ACTIVE") {
    throw new ConflictError(`Cannot check in: patient record is ${patient.status.toLowerCase()}.`);
  }
  const visitType = await db.visitType.findUnique({ where: { id: visitTypeId } });
  if (!visitType?.active) throw new ValidationError("Choose an active visit type.", { visitTypeId: "Invalid" });
  if (clinicianId && !(await isClinicianInBranch(clinicianId, branchId, db))) {
    throw new ValidationError("The selected clinician is not available in this branch.", { clinicianId: "Not available" });
  }

  try {
    return await withTx(db, async (tx) => {
      const ref = await nextYearlyRef(tx, "ENC", Number(todayLocal().slice(0, 4)));
      if (appointmentId) {
        const r = await tx.appointment.updateMany({
          where: { id: appointmentId, status: "BOOKED" },
          data: { status: "CHECKED_IN", version: { increment: 1 } },
        });
        if (r.count !== 1) throw new ConflictError("This appointment was just checked in by someone else.", "STALE");
      }
      const encounter = await tx.encounter.create({
        data: {
          ref,
          patientId: patient.id,
          branchId,
          departmentId: departmentId ?? visitType.departmentId,
          appointmentId,
          visitTypeId: visitType.id,
          attendingClinicianId: clinicianId ?? null,
          payerClass: input.payerClass,
          priority: input.priority,
          queueStage: initialStage,
          reason: input.reason,
          referralSource: input.referralSource,
          financialTermsAcknowledged: input.financialTermsAcknowledged,
          createdById: ctx.userId,
        },
      });
      await tx.visitQueueEvent.create({
        data: { encounterId: encounter.id, fromStage: null, toStage: initialStage, changedById: ctx.userId },
      });
      if (clinicianId) {
        await tx.careTeamAssignment.create({
          data: {
            encounterId: encounter.id,
            patientId: patient.id,
            userId: clinicianId,
            role: "ATTENDING",
            assignedById: ctx.userId,
          },
        });
      }
      await recordAudit(tx, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "encounter.check_in",
        resourceType: "Encounter",
        resourceId: encounter.id,
        patientId: patient.id,
        branchId,
        details: { ref, appointmentId: appointmentId ?? null, priority: input.priority, payerClass: input.payerClass },
        meta: ctx.meta,
      });
      return encounter;
    });
  } catch (e) {
    if (isConstraintViolation(e, OPEN_ENCOUNTER_INDEX)) {
      throw new ConflictError("This patient already has an open visit in this branch.", "OPEN_VISIT_EXISTS");
    }
    throw e;
  }
}

export async function transitionStage(ctx: AuthContext, input: z.output<typeof transitionSchema>, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "queue.read", { branchId: enc.branchId });
  const to = input.toStage as QueueStage;
  if (enc.status !== "OPEN") throw new ConflictError("This visit is already closed.");
  if (!canTransition(enc.queueStage, to)) throw new InvalidTransitionError(enc.queueStage, to, "visit");
  const needed = STAGE_ENTRY_PERMISSION[to];
  if (!can(ctx, needed, { branchId: enc.branchId })) {
    throw new ForbiddenError("Your role cannot move a patient into this stage.", needed);
  }
  if (STAGES_REQUIRING_NOTE.includes(to) && !input.note) {
    throw new ValidationError("A reason is required.", { note: "Required" });
  }
  const terminal = TERMINAL_STAGES.includes(to);

  return withTx(db, async (tx) => {
    const r = await tx.encounter.updateMany({
      where: { id: enc.id, version: input.version, queueStage: enc.queueStage, status: "OPEN" },
      data: {
        queueStage: to,
        version: { increment: 1 },
        ...(terminal ? { status: to === "COMPLETED" ? "COMPLETED" : "CANCELLED", completedAt: new Date() } : {}),
        ...(to === "IN_CONSULTATION" && !enc.attendingClinicianId ? { attendingClinicianId: ctx.userId } : {}),
      },
    });
    if (r.count !== 1) throw new ConflictError("This visit was updated by someone else. Refresh the queue.", "STALE");
    await tx.visitQueueEvent.create({
      data: { encounterId: enc.id, fromStage: enc.queueStage, toStage: to, note: input.note, changedById: ctx.userId },
    });
    if (to === "IN_CONSULTATION") {
      // Taking a patient into consultation establishes the care relationship.
      const existing = await tx.careTeamAssignment.findFirst({
        where: { encounterId: enc.id, userId: ctx.userId, endedAt: null },
      });
      if (!existing) {
        await tx.careTeamAssignment.create({
          data: {
            encounterId: enc.id,
            patientId: enc.patientId,
            userId: ctx.userId,
            role: enc.attendingClinicianId && enc.attendingClinicianId !== ctx.userId ? "CONSULTING" : "ATTENDING",
            assignedById: ctx.userId,
          },
        });
      }
    }
    if (terminal && enc.appointmentId) {
      await tx.appointment.update({
        where: { id: enc.appointmentId },
        data:
          to === "COMPLETED"
            ? { status: "COMPLETED", version: { increment: 1 } }
            : { status: "CANCELLED", cancelReason: input.note ?? "Visit cancelled", version: { increment: 1 } },
      });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "encounter.stage_change",
      resourceType: "Encounter",
      resourceId: enc.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
      details: { from: enc.queueStage, to },
      meta: ctx.meta,
    });
    return { version: input.version + 1, stage: to };
  });
}

export async function assignAttending(ctx: AuthContext, input: z.output<typeof assignClinicianSchema>, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "queue.manage", { branchId: enc.branchId });
  if (enc.status !== "OPEN") throw new ConflictError("This visit is closed.");
  if (!(await isClinicianInBranch(input.clinicianId, enc.branchId, db))) {
    throw new ValidationError("The selected clinician is not available in this branch.");
  }
  await withTx(db, async (tx) => {
    await tx.careTeamAssignment.updateMany({
      where: { encounterId: enc.id, role: "ATTENDING", endedAt: null, userId: { not: input.clinicianId } },
      data: { endedAt: new Date() },
    });
    await tx.encounter.update({
      where: { id: enc.id },
      data: { attendingClinicianId: input.clinicianId, version: { increment: 1 } },
    });
    const existing = await tx.careTeamAssignment.findFirst({
      where: { encounterId: enc.id, userId: input.clinicianId, endedAt: null },
    });
    if (!existing) {
      await tx.careTeamAssignment.create({
        data: { encounterId: enc.id, patientId: enc.patientId, userId: input.clinicianId, role: "ATTENDING", assignedById: ctx.userId },
      });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "encounter.assign_attending",
      resourceType: "Encounter",
      resourceId: enc.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
      details: { clinicianId: input.clinicianId },
      meta: ctx.meta,
    });
  });
}

export interface QueueRow {
  id: string;
  ref: string;
  version: number;
  stage: QueueStage;
  priority: "ROUTINE" | "URGENT" | "EMERGENCY";
  payerClass: string;
  arrivedAt: Date;
  stageSince: Date;
  visitType: string;
  attending: { id: string; displayName: string } | null;
  patient: {
    id: string;
    mrn: string;
    name: string;
    sexAtBirth: string;
    dateOfBirth: Date | null;
    allergyReviewStatus: string;
    registrationStatus: string;
  };
}

const PRIORITY_ORDER = { EMERGENCY: 0, URGENT: 1, ROUTINE: 2 } as const;

export async function listQueue(ctx: AuthContext, opts: { stages?: QueueStage[]; mine?: boolean } = {}, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "queue.read");
  const rows = await db.encounter.findMany({
    where: {
      branchId,
      status: "OPEN",
      queueStage: { in: opts.stages ?? ACTIVE_STAGES },
      ...(opts.mine ? { careTeam: { some: { userId: ctx.userId, endedAt: null } } } : {}),
    },
    take: 300,
    orderBy: { arrivedAt: "asc" },
    include: {
      patient: {
        select: {
          id: true,
          mrn: true,
          givenName: true,
          familyName: true,
          sexAtBirth: true,
          dateOfBirth: true,
          allergyReviewStatus: true,
          registrationStatus: true,
        },
      },
      visitType: { select: { name: true } },
      attending: { select: { id: true, displayName: true } },
      queueEvents: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
    },
  });
  const mapped: QueueRow[] = rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    version: r.version,
    stage: r.queueStage,
    priority: r.priority,
    payerClass: r.payerClass,
    arrivedAt: r.arrivedAt,
    stageSince: r.queueEvents[0]?.changedAt ?? r.arrivedAt,
    visitType: r.visitType.name,
    attending: r.attending,
    patient: {
      id: r.patient.id,
      mrn: r.patient.mrn,
      name: `${r.patient.givenName} ${r.patient.familyName}`,
      sexAtBirth: r.patient.sexAtBirth,
      dateOfBirth: r.patient.dateOfBirth,
      allergyReviewStatus: r.patient.allergyReviewStatus,
      registrationStatus: r.patient.registrationStatus,
    },
  }));
  return mapped.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.arrivedAt.getTime() - b.arrivedAt.getTime(),
  );
}

export async function getEncounterForSlip(ctx: AuthContext, encounterId: string, db: DbClient = prisma) {
  const enc = await db.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: { select: { mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true } },
      visitType: { select: { name: true } },
      attending: { select: { displayName: true } },
      branch: { select: { name: true, addressLine: true, phoneE164: true } },
    },
  });
  if (!enc) throw new NotFoundError("Visit not found.");
  requirePermission(ctx, "queue.read", { branchId: enc.branchId });
  return enc;
}

export async function listPatientEncounters(ctx: AuthContext, patientId: string, db: DbClient = prisma) {
  requirePermission(ctx, "queue.read");
  await loadScopedPatient(ctx, patientId, "patient.read", db);
  return db.encounter.findMany({
    where: { patientId },
    orderBy: { arrivedAt: "desc" },
    take: 100,
    include: {
      visitType: { select: { name: true } },
      attending: { select: { displayName: true } },
      branch: { select: { name: true } },
    },
  });
}
