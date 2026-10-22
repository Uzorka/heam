import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "@/server/domains/appointments/service";
import { checkIn, transitionStage } from "@/server/domains/queue/service";
import { getClinicalAccess } from "@/server/authz/clinical-access";
import { ConflictError, ForbiddenError, InvalidTransitionError } from "@/server/errors";
import { addDaysLocal } from "./time-helpers";
import { createUser, newPatient, userCtx, visitType, ctxFor } from "./helpers";
import { todayLocal } from "@/lib/time";

let slotDay = 30;
function nextSlotDate() {
  slotDay += 1;
  return addDaysLocal(todayLocal(), slotDay);
}

describe("appointments", () => {
  it("prevents double-booking a clinician, including under concurrency", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const doctor = await createUser(["PHYSICIAN"]);
    const vt = await visitType();
    const date = nextSlotDate();
    const p1 = await newPatient(reception);
    const p2 = await newPatient(reception);
    const p3 = await newPatient(reception);
    const base = { visitTypeId: vt.id, clinicianId: doctor.id, date, time: "10:00", source: "PHONE" as const };
    const results = await Promise.allSettled([
      bookAppointment(reception, { ...base, patientId: p1.patientId }),
      bookAppointment(reception, { ...base, patientId: p2.patientId }),
      bookAppointment(reception, { ...base, patientId: p3.patientId, time: "10:05" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
  });

  it("overlap override requires permission and a reason", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const doctor = await createUser(["PHYSICIAN"]);
    const vt = await visitType();
    const date = nextSlotDate();
    const [p1, p2] = [await newPatient(reception), await newPatient(reception)];
    await bookAppointment(reception, { patientId: p1.patientId, visitTypeId: vt.id, clinicianId: doctor.id, date, time: "11:00", source: "PHONE" });
    await expect(
      bookAppointment(reception, { patientId: p2.patientId, visitTypeId: vt.id, clinicianId: doctor.id, date, time: "11:00", source: "PHONE", override: { reason: "Doctor agreed to squeeze in" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // grant a custom role that includes appointment.override
    const role = await prisma.role.create({
      data: { code: `OVR${Date.now()}`, name: "Override", permissions: { create: [{ permissionCode: "appointment.override" }] } },
    });
    await prisma.userRole.create({ data: { userId: reception.userId, roleId: role.id, branchId: reception.activeBranchId } });
    const ctx2 = await ctxFor(reception.userId);
    const appt = await bookAppointment(ctx2, { patientId: p2.patientId, visitTypeId: vt.id, clinicianId: doctor.id, date, time: "11:00", source: "PHONE", override: { reason: "Doctor agreed to squeeze in" } });
    expect(appt.allowOverlap).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "appointment.book_override", resourceId: appt.id } })).toBe(1);
  });

  it("rescheduling frees the old slot and links the records", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const doctor = await createUser(["PHYSICIAN"]);
    const vt = await visitType();
    const date = nextSlotDate();
    const p = await newPatient(reception);
    const other = await newPatient(reception);
    const a = await bookAppointment(reception, { patientId: p.patientId, visitTypeId: vt.id, clinicianId: doctor.id, date, time: "09:00", source: "PHONE" });
    const moved = await rescheduleAppointment(reception, { appointmentId: a.id, version: a.version, date, time: "12:00" });
    expect(moved.rescheduledFromId).toBe(a.id);
    // old slot is free now
    await bookAppointment(reception, { patientId: other.patientId, visitTypeId: vt.id, clinicianId: doctor.id, date, time: "09:00", source: "PHONE" });
    await cancelAppointment(reception, { appointmentId: moved.id, reason: "Patient travelling" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: moved.id } })).status).toBe("CANCELLED");
  });

  it("rejects bookings in the past", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const vt = await visitType();
    const p = await newPatient(reception);
    await expect(
      bookAppointment(reception, { patientId: p.patientId, visitTypeId: vt.id, date: addDaysLocal(todayLocal(), -2), time: "09:00", source: "PHONE" }),
    ).rejects.toThrow(/past/);
  });
});

describe("check-in and queue", () => {
  it("walk-in check-in creates one open visit; a second concurrent check-in is refused", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const vt = await visitType();
    const p = await newPatient(reception);
    const input = { patientId: p.patientId, visitTypeId: vt.id, priority: "ROUTINE" as const, payerClass: "CASH" as const, financialTermsAcknowledged: true };
    const results = await Promise.allSettled([checkIn(reception, input), checkIn(reception, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.encounter.count({ where: { patientId: p.patientId, status: "OPEN" } })).toBe(1);
  });

  it("full journey: registration -> appointment -> check-in -> consultation -> complete", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: nurse } = await userCtx(["NURSE"]);
    const { user: doctorUser, ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const vt = await visitType();
    const p = await newPatient(reception);
    const now = new Date(Date.now() + 5 * 60_000);
    const time = `${String((now.getUTCHours() + 1) % 24).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    const appt = await bookAppointment(reception, {
      patientId: p.patientId,
      visitTypeId: vt.id,
      clinicianId: doctorUser.id,
      date: todayLocal(now),
      time,
      source: "WALK_IN",
    });
    const enc = await checkIn(reception, { appointmentId: appt.id, priority: "ROUTINE", payerClass: "CASH", financialTermsAcknowledged: true });
    expect(enc.queueStage).toBe("AWAITING_VITALS");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("CHECKED_IN");

    // Nurse cannot take the patient into consultation; reception cannot either
    let v = await transitionStage(nurse, { encounterId: enc.id, version: enc.version, toStage: "READY_FOR_DOCTOR" });
    await expect(transitionStage(nurse, { encounterId: enc.id, version: v.version, toStage: "IN_CONSULTATION" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transitionStage(reception, { encounterId: enc.id, version: v.version, toStage: "COMPLETED" })).rejects.toBeInstanceOf(InvalidTransitionError);

    // The booked doctor already has a care relationship from check-in
    expect((await getClinicalAccess(doctor, p.patientId)).basis).toBe("CARE_TEAM");
    v = await transitionStage(doctor, { encounterId: enc.id, version: v.version, toStage: "IN_CONSULTATION" });
    await expect(transitionStage(doctor, { encounterId: enc.id, version: v.version - 1, toStage: "READY_TO_DISCHARGE" })).rejects.toBeInstanceOf(ConflictError);
    v = await transitionStage(doctor, { encounterId: enc.id, version: v.version, toStage: "READY_TO_DISCHARGE" });
    await transitionStage(reception, { encounterId: enc.id, version: v.version, toStage: "COMPLETED" });

    const closed = await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id }, include: { queueEvents: true } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.queueEvents.map((q) => q.toStage)).toEqual(["AWAITING_VITALS", "READY_FOR_DOCTOR", "IN_CONSULTATION", "READY_TO_DISCHARGE", "COMPLETED"]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("COMPLETED");
  });

  it("an unrelated doctor gains clinical access only by taking the patient or via break-glass", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const vt = await visitType();
    const p = await newPatient(reception);
    const enc = await checkIn(reception, { patientId: p.patientId, visitTypeId: vt.id, priority: "URGENT", payerClass: "CASH", financialTermsAcknowledged: true });
    expect((await getClinicalAccess(doctor, p.patientId)).allowed).toBe(false);
    const v = await transitionStage(reception, { encounterId: enc.id, version: enc.version, toStage: "READY_FOR_DOCTOR" });
    await transitionStage(doctor, { encounterId: enc.id, version: v.version, toStage: "IN_CONSULTATION" });
    expect((await getClinicalAccess(doctor, p.patientId)).basis).toBe("CARE_TEAM");
  });

  it("queue history is append-only at the database level", async () => {
    const ev = await prisma.visitQueueEvent.findFirstOrThrow();
    await expect(prisma.visitQueueEvent.update({ where: { id: ev.id }, data: { note: "tamper" } })).rejects.toThrow(/append-only/);
  });

  it("cancelling a visit requires a reason", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const vt = await visitType();
    const p = await newPatient(reception);
    const enc = await checkIn(reception, { patientId: p.patientId, visitTypeId: vt.id, priority: "ROUTINE", payerClass: "CASH", financialTermsAcknowledged: false });
    await expect(transitionStage(reception, { encounterId: enc.id, version: enc.version, toStage: "CANCELLED" })).rejects.toThrow(/reason/i);
    await transitionStage(reception, { encounterId: enc.id, version: enc.version, toStage: "CANCELLED", note: "Left before being seen" });
  });
});
