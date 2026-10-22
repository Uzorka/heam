import type { QueueStage } from "@prisma/client";
import type { PermissionCode } from "../../authz/permissions";

/**
 * Outpatient visit queue state machine. Clinical decision points (taking the patient into
 * consultation, sending for services, discharge readiness) need a clinician permission; front-desk
 * and nursing staff move patients between waiting stages.
 */
export const QUEUE_TRANSITIONS: Record<QueueStage, QueueStage[]> = {
  REGISTERED: ["AWAITING_VITALS", "READY_FOR_DOCTOR", "CANCELLED"],
  AWAITING_VITALS: ["READY_FOR_DOCTOR", "CANCELLED"],
  READY_FOR_DOCTOR: ["IN_CONSULTATION", "AWAITING_VITALS", "CANCELLED"],
  IN_CONSULTATION: ["AWAITING_SERVICES", "AWAITING_REVIEW", "READY_TO_DISCHARGE", "READY_FOR_DOCTOR"],
  AWAITING_SERVICES: ["AWAITING_REVIEW", "READY_TO_DISCHARGE", "IN_CONSULTATION"],
  AWAITING_REVIEW: ["IN_CONSULTATION", "READY_TO_DISCHARGE"],
  READY_TO_DISCHARGE: ["COMPLETED", "IN_CONSULTATION"],
  // Inpatients leave the outpatient queue; only the admission discharge workflow closes the visit.
  ADMITTED: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const TERMINAL_STAGES: QueueStage[] = ["COMPLETED", "CANCELLED", "NO_SHOW"];

/** Permission required to move INTO a stage. */
export const STAGE_ENTRY_PERMISSION: Record<QueueStage, PermissionCode> = {
  REGISTERED: "queue.manage",
  AWAITING_VITALS: "queue.manage",
  READY_FOR_DOCTOR: "queue.manage",
  IN_CONSULTATION: "clinical.note.write",
  AWAITING_SERVICES: "clinical.note.write",
  AWAITING_REVIEW: "clinical.note.write",
  READY_TO_DISCHARGE: "clinical.note.write",
  ADMITTED: "admission.manage",
  COMPLETED: "queue.manage",
  CANCELLED: "queue.manage",
  NO_SHOW: "queue.manage",
};

export const STAGES_REQUIRING_NOTE: QueueStage[] = ["CANCELLED"];

export function canTransition(from: QueueStage, to: QueueStage): boolean {
  return QUEUE_TRANSITIONS[from].includes(to);
}

export const STAGE_LABELS: Record<QueueStage, string> = {
  REGISTERED: "Registered",
  AWAITING_VITALS: "Awaiting vitals",
  READY_FOR_DOCTOR: "Ready for doctor",
  IN_CONSULTATION: "In consultation",
  AWAITING_SERVICES: "Awaiting services",
  AWAITING_REVIEW: "Awaiting review",
  READY_TO_DISCHARGE: "Ready to discharge",
  ADMITTED: "Admitted (inpatient)",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled / left",
  NO_SHOW: "No-show",
};

export const ACTIVE_STAGES: QueueStage[] = [
  "REGISTERED",
  "AWAITING_VITALS",
  "READY_FOR_DOCTOR",
  "IN_CONSULTATION",
  "AWAITING_SERVICES",
  "AWAITING_REVIEW",
  "READY_TO_DISCHARGE",
];

/** Stages in which the patient is under active clinical management. */
export const CLINICAL_STAGES: QueueStage[] = ["IN_CONSULTATION", "AWAITING_SERVICES", "AWAITING_REVIEW"];

/**
 * Permission needed for a specific move. Leaving a clinical stage (e.g. handing a patient back to
 * the waiting list) is a clinical decision, except closing a visit already marked ready to discharge.
 */
export function transitionPermission(from: QueueStage, to: QueueStage): PermissionCode {
  if (CLINICAL_STAGES.includes(from)) return "clinical.note.write";
  return STAGE_ENTRY_PERMISSION[to];
}
