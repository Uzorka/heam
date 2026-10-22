import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registerPatientSchema } from "@/lib/schemas/patient";
import { registerPatient, revealIdentifier, updatePatient, getPatientDetail, searchPatients } from "@/server/domains/patients/service";
import { approveMerge, requestMerge } from "@/server/domains/patients/merge";
import { recordAllergy } from "@/server/domains/patients/records";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { newPatient, uniq, uniquePhone, userCtx } from "./helpers";

describe("patient registry", () => {
  it("registers with a check-digit MRN, consents and an audit entry", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const r = await newPatient(ctx);
    expect(r.mrn).toMatch(/^ADK\d{7}$/);
    const consents = await prisma.consentRecord.findMany({ where: { patientId: r.patientId } });
    expect(consents.map((c) => c.type).sort()).toEqual(["DATA_PROCESSING_NOTICE", "SMS_REMINDERS"]);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "patient.create", resourceId: r.patientId } });
    expect(audit?.actorUserId).toBe(ctx.userId);
    expect(JSON.stringify(audit?.details)).not.toContain("Given"); // no names in audit details
  });

  it("allocates unique MRNs under concurrency", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const results = await Promise.all(Array.from({ length: 15 }, () => newPatient(ctx)));
    expect(new Set(results.map((r) => r.mrn)).size).toBe(15);
  });

  it("(5) warns about likely duplicates and never merges silently", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const phone = uniquePhone();
    const family = uniq("Okon");
    const given = uniq("Ime");
    const first = await newPatient(ctx, { givenName: given, familyName: family, phone, dateOfBirth: "1985-02-02" });
    const input = registerPatientSchema.parse({
      givenName: `${given}h`,
      familyName: family,
      dateOfBirth: "1985-02-02",
      dobProvenance: "STATED",
      sexAtBirth: "FEMALE",
      phone,
      privacyNoticeGiven: true,
    });
    const warn = await registerPatient(ctx, input);
    expect(warn.status).toBe("DUPLICATES_FOUND");
    if (warn.status !== "DUPLICATES_FOUND") return;
    expect(warn.candidates[0]!.id).toBe(first.patientId);
    expect(warn.candidates[0]!.maskedPhone).toContain("***");
    // Staff confirm it is a different person: a second record is created AND a review is queued.
    const created = await registerPatient(ctx, { ...input, acknowledgedDuplicateIds: [first.patientId] });
    expect(created.status).toBe("CREATED");
    if (created.status !== "CREATED") return;
    const review = await prisma.duplicatePatientReview.findFirst({
      where: { OR: [{ patientAId: created.patientId }, { patientBId: created.patientId }] },
    });
    expect(review?.status).toBe("OPEN");
    const both = await prisma.patient.findMany({ where: { id: { in: [first.patientId, created.patientId] } } });
    expect(both.every((p) => p.status === "ACTIVE")).toBe(true);
  });

  it("merging needs a different approver and keeps the losing record", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: records1 } = await userCtx(["MEDICAL_RECORDS"]);
    const { ctx: records2 } = await userCtx(["MEDICAL_RECORDS"]);
    const phone = uniquePhone();
    const family = uniq("Ade");
    const given = uniq("Bayo");
    const a = await newPatient(reception, { givenName: given, familyName: family, phone });
    const input = registerPatientSchema.parse({ givenName: given, familyName: family, dateOfBirth: "1990-05-05", dobProvenance: "STATED", sexAtBirth: "FEMALE", phone, privacyNoticeGiven: true, acknowledgedDuplicateIds: [a.patientId] });
    const b = await registerPatient(reception, input);
    if (b.status !== "CREATED") throw new Error("expected create");
    await recordAllergy(reception, { patientId: b.patientId, substance: "Aspirin", category: "DRUG", severity: "MODERATE", source: "PATIENT_REPORTED" });
    const review = await prisma.duplicatePatientReview.findFirstOrThrow({ where: { OR: [{ patientAId: b.patientId }, { patientBId: b.patientId }] } });

    await expect(requestMerge(reception, { reviewId: review.id, survivorId: a.patientId, notes: "same" })).resolves.toBeUndefined();
    await expect(approveMerge(reception, review.id)).rejects.toBeInstanceOf(ForbiddenError); // reception cannot approve
    // reset to test the records officers' two-person rule
    await prisma.duplicatePatientReview.update({ where: { id: review.id }, data: { status: "OPEN", mergeRequestedById: null } });
    await requestMerge(records1, { reviewId: review.id, survivorId: a.patientId, notes: "Confirmed with patient" });
    await expect(approveMerge(records1, review.id)).rejects.toThrow(/different person/);
    const res = await approveMerge(records2, review.id);
    expect(res.moved.allergies).toBe(1);
    const loser = await prisma.patient.findUniqueOrThrow({ where: { id: b.patientId } });
    expect(loser.status).toBe("MERGED");
    expect(loser.mergedIntoId).toBe(a.patientId);
    const survivor = await prisma.patient.findUniqueOrThrow({ where: { id: a.patientId } });
    expect(survivor.allergyReviewStatus).toBe("HAS_ALLERGIES");
  });

  it("optimistic locking rejects stale edits", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const p = await newPatient(ctx);
    const current = await prisma.patient.findUniqueOrThrow({ where: { id: p.patientId } });
    const base = {
      id: p.patientId,
      version: current.version,
      givenName: current.givenName,
      familyName: current.familyName,
      dateOfBirth: "1990-05-05",
      dobProvenance: "STATED" as const,
      sexAtBirth: "FEMALE" as const,
      phone: current.phoneE164 ?? undefined,
    };
    await updatePatient(ctx, { ...base, city: "Ikorodu" });
    await expect(updatePatient(ctx, { ...base, city: "Epe" })).rejects.toBeInstanceOf(ConflictError);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "patient.update", resourceId: p.patientId } });
    expect((audit?.details as { fields: string[] }).fields).toEqual(["city"]);
  });

  it("identifiers are encrypted at rest, masked by default, and revealing is permissioned and audited", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const nin = String(Math.floor(1e10 + Math.random() * 9e10));
    const p = await newPatient(reception, { identifier: { type: "NIN", value: nin } });
    const row = await prisma.patientIdentifier.findFirstOrThrow({ where: { patientId: p.patientId } });
    expect(row.valueEnc).not.toContain(nin);
    const detail = await getPatientDetail(reception, p.patientId);
    expect(detail.identifiers[0]!.masked).toBe(`••••${nin.slice(-4)}`);
    await expect(revealIdentifier(reception, row.id)).rejects.toBeInstanceOf(ForbiddenError);
    const { ctx: records } = await userCtx(["MEDICAL_RECORDS"]);
    expect((await revealIdentifier(records, row.id)).value).toBe(nin);
    expect(await prisma.auditEvent.count({ where: { action: "patient.identifier.reveal", resourceId: row.id } })).toBe(1);
  });

  it("search finds by MRN, phone and name tokens with masked phones", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const phone = uniquePhone();
    const family = uniq("Searchable");
    const given = uniq("Adaobi");
    const p = await newPatient(ctx, { givenName: given, familyName: family, phone });
    const byMrn = await searchPatients(ctx, { q: p.mrn, page: 1, pageSize: 20, includeInactive: false, provisionalOnly: false });
    expect(byMrn.rows[0]!.id).toBe(p.patientId);
    const byPhone = await searchPatients(ctx, { q: phone, page: 1, pageSize: 20, includeInactive: false, provisionalOnly: false });
    expect(byPhone.rows.map((r) => r.id)).toContain(p.patientId);
    expect(byPhone.rows[0]!.maskedPhone).toContain("***");
    const byName = await searchPatients(ctx, { q: `${given.toLowerCase()} ${family.toLowerCase()}`, page: 1, pageSize: 20, includeInactive: false, provisionalOnly: false });
    expect(byName.rows.map((r) => r.id)).toEqual([p.patientId]);
  });

  it("viewing a patient record is audited", async () => {
    const { ctx } = await userCtx(["RECEPTION"]);
    const p = await newPatient(ctx);
    await getPatientDetail(ctx, p.patientId);
    expect(await prisma.auditEvent.count({ where: { action: "patient.view", patientId: p.patientId, actorUserId: ctx.userId } })).toBe(1);
  });

  it("only clinicians can record a clinician-verified allergy", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const p = await newPatient(reception);
    await expect(
      recordAllergy(reception, { patientId: p.patientId, substance: "Latex", category: "ENVIRONMENT", severity: "MILD", source: "CLINICIAN_VERIFIED" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
