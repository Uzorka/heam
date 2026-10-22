import { prisma, type DbClient } from "../../db";
import { branchesWith, can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ForbiddenError } from "../../errors";
import { localDayRange, todayLocal } from "@/lib/time";
import { ACTIVE_STAGES } from "../queue/state-machine";

/**
 * Metric definitions (shown to users alongside the numbers):
 *  - Checked-in visits: encounters whose arrival time falls in the range.
 *  - New patients: patients registered in the range. Repeat visits: visits in the range by patients
 *    registered before the range started.
 *  - Waiting now: open encounters in an active queue stage.
 *  - Median wait to consultation: arrival -> first IN_CONSULTATION queue event, for visits arriving
 *    in the range that reached consultation.
 *  - Missed appointments: appointments in the range marked NO_SHOW.
 */
export const METRIC_DEFINITIONS = {
  checkedIn: "Visits whose check-in time falls within the selected dates.",
  newPatients: "Patients registered within the selected dates.",
  repeatVisits: "Visits within the dates by patients registered before the start date.",
  waitingNow: "Open visits currently in a waiting or active queue stage.",
  medianWait: "Median minutes from check-in to first 'In consultation', for visits in range that reached consultation.",
  missed: "Appointments in range marked as no-show.",
  beds: "Configured beds by current status. Demo beds are labelled.",
};

export function rangeFromLocalDates(from: string, to: string) {
  const start = localDayRange(from).start;
  const end = localDayRange(to).end;
  if (end <= start) throw new ForbiddenError("Invalid date range.");
  return { start, end };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export async function executiveSummary(ctx: AuthContext, from: string, to: string, db: DbClient = prisma) {
  requirePermission(ctx, "report.executive");
  const scope = branchesWith(ctx, "report.executive");
  const branchFilter = scope === "ALL" ? {} : { branchId: { in: scope } };
  const { start, end } = rangeFromLocalDates(from, to);

  const [checkedIn, newPatients, repeatVisits, waitingNow, missed, completed, beds, consultEvents, stageCounts] = await Promise.all([
    db.encounter.count({ where: { ...branchFilter, arrivedAt: { gte: start, lt: end } } }),
    db.patient.count({
      where: {
        createdAt: { gte: start, lt: end },
        status: { not: "MERGED" },
        ...(scope === "ALL" ? {} : { registeredBranchId: { in: scope } }),
      },
    }),
    db.encounter.count({ where: { ...branchFilter, arrivedAt: { gte: start, lt: end }, patient: { createdAt: { lt: start } } } }),
    db.encounter.count({ where: { ...branchFilter, status: "OPEN", queueStage: { in: ACTIVE_STAGES } } }),
    db.appointment.count({ where: { ...branchFilter, startAt: { gte: start, lt: end }, status: "NO_SHOW" } }),
    db.encounter.count({ where: { ...branchFilter, arrivedAt: { gte: start, lt: end }, status: "COMPLETED" } }),
    db.bed.groupBy({
      by: ["status", "isDemo"],
      where: { active: true, ward: scope === "ALL" ? { active: true } : { active: true, branchId: { in: scope } } },
      _count: { _all: true },
    }),
    db.visitQueueEvent.findMany({
      where: { toStage: "IN_CONSULTATION", encounter: { ...branchFilter, arrivedAt: { gte: start, lt: end } } },
      orderBy: { changedAt: "asc" },
      select: { encounterId: true, changedAt: true, encounter: { select: { arrivedAt: true } } },
      take: 5000,
    }),
    db.encounter.groupBy({
      by: ["queueStage"],
      where: { ...branchFilter, status: "OPEN", queueStage: { in: ACTIVE_STAGES } },
      _count: { _all: true },
    }),
  ]);
  const firstConsult = new Map<string, number>();
  for (const e of consultEvents) {
    if (!firstConsult.has(e.encounterId)) {
      firstConsult.set(e.encounterId, Math.round((e.changedAt.getTime() - e.encounter.arrivedAt.getTime()) / 60_000));
    }
  }
  const bedSummary = { FREE: 0, RESERVED: 0, OCCUPIED: 0, CLEANING: 0, UNAVAILABLE: 0, demo: 0 };
  for (const b of beds) {
    bedSummary[b.status] += b._count._all;
    if (b.isDemo) bedSummary.demo += b._count._all;
  }
  return {
    generatedAt: new Date(),
    checkedIn,
    newPatients,
    repeatVisits,
    waitingNow,
    completed,
    missed,
    medianWaitMinutes: median([...firstConsult.values()]),
    consultationsMeasured: firstConsult.size,
    beds: bedSummary,
    stageCounts: stageCounts.map((s) => ({ stage: s.queueStage, count: s._count._all })),
  };
}

export async function frontDeskSummary(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "queue.read");
  const { start, end } = localDayRange(todayLocal());
  const [expected, checkedIn, noShows, waiting, provisional, duplicates, newToday] = await Promise.all([
    db.appointment.count({ where: { branchId, startAt: { gte: start, lt: end }, status: "BOOKED" } }),
    db.encounter.count({ where: { branchId, arrivedAt: { gte: start, lt: end } } }),
    db.appointment.count({ where: { branchId, startAt: { gte: start, lt: end }, status: "NO_SHOW" } }),
    db.encounter.count({ where: { branchId, status: "OPEN", queueStage: { in: ACTIVE_STAGES } } }),
    can(ctx, "patient.search")
      ? db.patient.count({ where: { registrationStatus: "PROVISIONAL", status: "ACTIVE", registeredBranchId: branchId } })
      : Promise.resolve(null),
    can(ctx, "patient.merge.request")
      ? db.duplicatePatientReview.count({ where: { status: { in: ["OPEN", "MERGE_REQUESTED"] } } })
      : Promise.resolve(null),
    db.patient.count({ where: { registeredBranchId: branchId, createdAt: { gte: start, lt: end } } }),
  ]);
  const overdue = await db.appointment.count({
    where: { branchId, startAt: { gte: start, lt: new Date(Date.now() - 30 * 60_000) }, status: "BOOKED" },
  });
  return { generatedAt: new Date(), expected, checkedIn, noShows, waiting, provisional, duplicates, newToday, overdue };
}

export async function clinicianSummary(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "queue.read");
  const { start, end } = localDayRange(todayLocal());
  const [myOpen, readyForDoctor, myAppointments, awaitingVitals] = await Promise.all([
    db.encounter.count({
      where: { branchId, status: "OPEN", careTeam: { some: { userId: ctx.userId, endedAt: null } } },
    }),
    db.encounter.count({ where: { branchId, status: "OPEN", queueStage: "READY_FOR_DOCTOR" } }),
    db.appointment.count({
      where: { branchId, clinicianId: ctx.userId, startAt: { gte: start, lt: end }, status: { in: ["BOOKED", "CHECKED_IN"] } },
    }),
    db.encounter.count({ where: { branchId, status: "OPEN", queueStage: "AWAITING_VITALS" } }),
  ]);
  return { generatedAt: new Date(), myOpen, readyForDoctor, myAppointments, awaitingVitals };
}
