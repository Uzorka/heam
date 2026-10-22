import { prisma, type DbClient } from "../../db";
import type { AuthContext } from "../../authz/context";
import { can } from "../../authz/context";
import { loadScopedPatient } from "./service";

export interface TimelineEvent {
  at: Date;
  kind: "registration" | "appointment" | "visit" | "queue" | "allergy" | "consent";
  title: string;
  detail?: string;
  by?: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  REGISTERED: "Registered at desk",
  AWAITING_VITALS: "Awaiting vitals",
  READY_FOR_DOCTOR: "Ready for doctor",
  IN_CONSULTATION: "In consultation",
  AWAITING_SERVICES: "Awaiting services",
  AWAITING_REVIEW: "Awaiting review",
  READY_TO_DISCHARGE: "Ready to discharge",
  COMPLETED: "Visit completed",
  CANCELLED: "Visit cancelled",
  NO_SHOW: "No show",
};

/**
 * Permission-aware, attributed timeline. Phase 1 includes administrative events only; clinical events
 * are added by their modules and only when the viewer holds clinical access.
 */
export async function getPatientTimeline(ctx: AuthContext, patientId: string, db: DbClient = prisma): Promise<TimelineEvent[]> {
  const patient = await loadScopedPatient(ctx, patientId, "patient.read", db);
  const [appointments, encounters, allergies, consents] = await Promise.all([
    can(ctx, "appointment.read")
      ? db.appointment.findMany({
          where: { patientId },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { visitType: { select: { name: true } }, clinician: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    can(ctx, "queue.read")
      ? db.encounter.findMany({
          where: { patientId },
          orderBy: { arrivedAt: "desc" },
          take: 30,
          include: { visitType: { select: { name: true } }, queueEvents: { orderBy: { changedAt: "asc" } } },
        })
      : Promise.resolve([]),
    db.patientAllergy.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: 30 }),
    db.consentRecord.findMany({ where: { patientId }, orderBy: { capturedAt: "desc" }, take: 30 }),
  ]);
  const userIds = new Set<string>();
  encounters.forEach((e) => e.queueEvents.forEach((q) => userIds.add(q.changedById)));
  allergies.forEach((a) => userIds.add(a.recordedById));
  consents.forEach((c) => userIds.add(c.capturedById));
  appointments.forEach((a) => userIds.add(a.createdById));
  if (patient.createdById) userIds.add(patient.createdById);
  const users = await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, displayName: true } });
  const nameOf = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.displayName ?? "Unknown user" : null);

  const events: TimelineEvent[] = [
    { at: patient.createdAt, kind: "registration", title: `Registered (${patient.mrn})`, by: nameOf(patient.createdById) },
  ];
  for (const a of appointments) {
    events.push({
      at: a.createdAt,
      kind: "appointment",
      title: `Appointment ${a.status.toLowerCase().replace("_", " ")} - ${a.visitType.name}`,
      detail: `${a.ref}${a.clinician ? ` with ${a.clinician.displayName}` : ""}`,
      by: nameOf(a.createdById),
    });
  }
  for (const e of encounters) {
    for (const q of e.queueEvents) {
      events.push({
        at: q.changedAt,
        kind: q.fromStage ? "queue" : "visit",
        title: q.fromStage ? STAGE_LABEL[q.toStage] ?? q.toStage : `Checked in - ${e.visitType.name}`,
        detail: e.ref,
        by: nameOf(q.changedById),
      });
    }
  }
  for (const a of allergies) {
    events.push({
      at: a.recordedAt,
      kind: "allergy",
      title: `Allergy recorded: ${a.substance}`,
      detail: `${a.severity.toLowerCase()} · ${a.source.toLowerCase().replace(/_/g, " ")}${a.status !== "ACTIVE" ? ` · ${a.status.toLowerCase()}` : ""}`,
      by: nameOf(a.recordedById),
    });
  }
  for (const c of consents) {
    events.push({
      at: c.capturedAt,
      kind: "consent",
      title: `Consent ${c.status.toLowerCase()}: ${c.type.toLowerCase().replace(/_/g, " ")}`,
      by: nameOf(c.capturedById),
    });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}
