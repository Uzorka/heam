import { describe, expect, it } from "vitest";
import { QUEUE_TRANSITIONS, STAGE_ENTRY_PERMISSION, TERMINAL_STAGES, canTransition, transitionPermission } from "@/server/domains/queue/state-machine";

describe("visit queue state machine", () => {
  it("allows the normal outpatient path", () => {
    const path = ["AWAITING_VITALS", "READY_FOR_DOCTOR", "IN_CONSULTATION", "AWAITING_SERVICES", "AWAITING_REVIEW", "READY_TO_DISCHARGE", "COMPLETED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it("rejects skipping consultation and reopening closed visits", () => {
    expect(canTransition("AWAITING_VITALS", "COMPLETED")).toBe(false);
    expect(canTransition("READY_FOR_DOCTOR", "READY_TO_DISCHARGE")).toBe(false);
    for (const t of TERMINAL_STAGES) expect(QUEUE_TRANSITIONS[t]).toEqual([]);
  });
  it("clinical decision stages require a clinician permission", () => {
    expect(STAGE_ENTRY_PERMISSION.IN_CONSULTATION).toBe("clinical.note.write");
    expect(STAGE_ENTRY_PERMISSION.READY_TO_DISCHARGE).toBe("clinical.note.write");
    expect(STAGE_ENTRY_PERMISSION.AWAITING_VITALS).toBe("queue.manage");
  });
  it("leaving a clinical stage needs a clinician, but closing a discharge-ready visit does not", () => {
    expect(transitionPermission("IN_CONSULTATION", "READY_FOR_DOCTOR")).toBe("clinical.note.write");
    expect(transitionPermission("AWAITING_SERVICES", "AWAITING_REVIEW")).toBe("clinical.note.write");
    expect(transitionPermission("READY_TO_DISCHARGE", "COMPLETED")).toBe("queue.manage");
  });
});
