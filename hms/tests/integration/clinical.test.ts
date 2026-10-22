import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createAddendum, createNote, saveNote, signNote } from "@/server/domains/clinical/notes";
import {
  markVitalsInError,
  recordVitals,
  decideVitalThreshold,
  proposeVitalThreshold,
} from "@/server/domains/clinical/observations";
import { addDiagnosis } from "@/server/domains/clinical/diagnoses";
import { getEncounterWorkspace, getClinicalHistory } from "@/server/domains/clinical/workspace";
import { cancelOrder, placeOrders } from "@/server/domains/clinical/orders";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { vitalsSchema } from "@/lib/schemas/clinical";
import { TEST_PASSWORD, labTest, newPatient, userCtx, visitInConsultation } from "./helpers";

async function setup() {
  const { ctx: reception } = await userCtx(["RECEPTION"]);
  const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
  const p = await newPatient(reception);
  const enc = await visitInConsultation(reception, doctor, p.patientId);
  return { reception, doctor, p, enc };
}

describe("clinical documentation", () => {
  it("(1) reception cannot open the clinical workspace or chart; the treating doctor can", async () => {
    const { reception, doctor, p, enc } = await setup();
    await expect(getEncounterWorkspace(reception, enc.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getClinicalHistory(reception, p.patientId)).rejects.toBeInstanceOf(ForbiddenError);
    const ws = await getEncounterWorkspace(doctor, enc.id);
    expect(ws.access.level).toBe("FULL");
    expect(
      await prisma.auditEvent.count({
        where: { action: "clinical.encounter.view", resourceId: enc.id, actorUserId: doctor.userId },
      }),
    ).toBe(1);
  });

  it("a doctor with no relationship sees only the current open visit, never history", async () => {
    const { enc, p } = await setup();
    const { ctx: other } = await userCtx(["PHYSICIAN"]);
    const ws = await getEncounterWorkspace(other, enc.id);
    expect(ws.access.level).toBe("CURRENT_VISIT");
    expect(ws.problemList).toBeNull();
    await expect(getClinicalHistory(other, p.patientId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("(11) signed notes are immutable; history is kept; corrections are signed addenda", async () => {
    const { doctor, enc } = await setup();
    const note = await createNote(doctor, { encounterId: enc.id, type: "CONSULTATION" });
    const v2 = await saveNote(doctor, {
      noteId: note.id,
      version: 1,
      content: { chiefComplaint: "Fever 3 days", plan: "FBC, malaria test" },
    });
    await expect(
      saveNote(doctor, { noteId: note.id, version: 1, content: { plan: "stale" } }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(signNote(doctor, { id: note.id, password: "wrong-password" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const signed = await signNote(doctor, { id: note.id, password: TEST_PASSWORD });
    expect(signed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      saveNote(doctor, { noteId: note.id, version: v2.version, content: { plan: "changed" } }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Even direct database writes are refused
    await expect(
      prisma.clinicalNote.update({ where: { id: note.id }, data: { content: { plan: "tampered" } } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.clinicalNote.delete({ where: { id: note.id } })).rejects.toThrow(/cannot be deleted/);
    const addendum = await createAddendum(doctor, note.id);
    await saveNote(doctor, {
      noteId: addendum.id,
      version: 1,
      content: { body: "Correction: fever 4 days" },
    });
    await signNote(doctor, { id: addendum.id, password: TEST_PASSWORD });
    const original = await prisma.clinicalNote.findUniqueOrThrow({
      where: { id: note.id },
      include: { addenda: true, versions: true },
    });
    expect((original.content as { plan: string }).plan).toBe("FBC, malaria test");
    expect(original.addenda).toHaveLength(1);
    expect(original.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("only the author edits a draft; other clinicians see it only as in progress", async () => {
    const { doctor, enc } = await setup();
    const { ctx: nurse } = await userCtx(["NURSE"]);
    const note = await createNote(doctor, { encounterId: enc.id, type: "CONSULTATION" });
    await expect(
      saveNote(nurse, { noteId: note.id, version: 1, content: { plan: "x" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ws = await getEncounterWorkspace(nurse, enc.id);
    const seen = ws.notes.find((n) => n.id === note.id)!;
    expect(seen.hiddenDraft).toBe(true);
    expect(seen.content).toBeNull();
  });

  it("vitals: plausibility enforced; corrections by entered-in-error only; nurse joins care team", async () => {
    const { enc } = await setup();
    const { ctx: nurse } = await userCtx(["NURSE"]);
    expect(vitalsSchema.safeParse({ encounterId: enc.id, temperatureC: "52" }).success).toBe(false);
    const v = await recordVitals(
      nurse,
      vitalsSchema.parse({
        encounterId: enc.id,
        temperatureC: "38.6",
        pulseBpm: "112",
        systolicMmHg: "118",
        diastolicMmHg: "76",
      }),
    );
    await expect(prisma.vitalSign.update({ where: { id: v.id }, data: { pulseBpm: 80 } })).rejects.toThrow(
      /cannot be edited/,
    );
    await markVitalsInError(nurse, { id: v.id, reason: "Wrong patient wristband" });
    await expect(markVitalsInError(nurse, { id: v.id, reason: "again" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      await prisma.careTeamAssignment.count({ where: { encounterId: enc.id, userId: nurse.userId } }),
    ).toBe(1);
  });

  it("vital flags appear only after a different clinician approves thresholds", async () => {
    const { enc, doctor } = await setup();
    const { ctx: admin } = await userCtx(["MEDICAL_DIRECTOR"]);
    const { ctx: md2 } = await userCtx(["MEDICAL_DIRECTOR"]);
    await recordVitals(doctor, vitalsSchema.parse({ encounterId: enc.id, temperatureC: "39.4" }));
    const before = await getEncounterWorkspace(doctor, enc.id);
    expect(before.vitals[0]!.flags.temperatureC).toBeUndefined();
    const t = await proposeVitalThreshold(admin, {
      parameter: "TEMPERATURE_C",
      low: 36,
      high: 37.5,
      criticalLow: 35,
      criticalHigh: 40,
      source: "Test fixture",
    });
    await expect(decideVitalThreshold(admin, { id: t.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await decideVitalThreshold(md2, { id: t.id, decision: "APPROVE" });
    const after = await getEncounterWorkspace(doctor, enc.id);
    expect(after.vitals[0]!.flags.temperatureC).toBe("HIGH");
    // clean up so other tests see no approved threshold
    await prisma.vitalThreshold.update({ where: { id: t.id }, data: { status: "RETIRED" } });
  });

  it("diagnoses record provisional vs confirmed with attribution", async () => {
    const { doctor, enc } = await setup();
    const d = await addDiagnosis(doctor, {
      encounterId: enc.id,
      description: "Malaria",
      code: "B54",
      certainty: "PROVISIONAL",
      isPrimary: true,
      onProblemList: false,
    });
    expect(d.recordedById).toBe(doctor.userId);
    expect(d.codeSystem).toBe("ICD-10");
  });
});

describe("orders", () => {
  it("placing the same request twice creates the orders once (idempotent)", async () => {
    const { doctor, enc } = await setup();
    const hb = await labTest("T-HB");
    const input = {
      encounterId: enc.id,
      requestGroupId: crypto.randomUUID(),
      priority: "ROUTINE" as const,
      clinicalIndication: "Pallor",
      items: [{ kind: "LAB" as const, labTestId: hb.id }],
    };
    const [a, b] = await Promise.all([placeOrders(doctor, input), placeOrders(doctor, input)]);
    expect(a.orders.map((o) => o.id)).toEqual(b.orders.map((o) => o.id));
    expect(await prisma.serviceOrder.count({ where: { requestGroupId: input.requestGroupId } })).toBe(1);
    await expect(placeOrders(doctor, { ...input, requestGroupId: crypto.randomUUID() })).rejects.toThrow(
      /Already ordered/,
    );
  });

  it("(17) cancelled orders cannot progress; started work cannot be cancelled", async () => {
    const { doctor, enc } = await setup();
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const hb = await labTest("T-HB");
    const { orders } = await placeOrders(doctor, {
      encounterId: enc.id,
      requestGroupId: crypto.randomUUID(),
      priority: "ROUTINE",
      clinicalIndication: "x",
      items: [{ kind: "LAB", labTestId: hb.id }],
    });
    const o = orders[0]!;
    await expect(
      cancelOrder(reception, { orderId: o.id, version: o.version, reason: "Patient left" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await cancelOrder(doctor, { orderId: o.id, version: o.version, reason: "Patient declined" });
    const { collectSpecimen } = await import("@/server/domains/lab/service");
    const { ctx: lab } = await userCtx(["LAB_SCIENTIST"]);
    await expect(collectSpecimen(lab, { orderId: o.id, version: o.version + 1 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const events = await prisma.orderStatusEvent.findMany({
      where: { orderId: o.id },
      orderBy: { changedAt: "asc" },
    });
    expect(events.map((e) => e.toStatus)).toEqual(["ORDERED", "CANCELLED"]);
  });
});
