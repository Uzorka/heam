import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { placeOrders, reviewOrderResult } from "@/server/domains/clinical/orders";
import {
  acknowledgeCritical,
  amendResult,
  collectSpecimen,
  enterResults,
  receiveSpecimen,
  rejectSpecimen,
  verifyResults,
} from "@/server/domains/lab/service";
import { decideReferenceRange, proposeReferenceRange } from "@/server/domains/catalogue/service";
import { amendImagingReport, saveImagingReport, signImagingReport, startImaging } from "@/server/domains/imaging/service";
import { authorizeDownload, uploadDocument } from "@/server/domains/documents/service";
import type { StorageDriver } from "@/server/domains/documents/storage";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { TEST_PASSWORD, labTest, newPatient, userCtx, visitInConsultation } from "./helpers";

async function labOrder(code: "T-HB" | "T-MP" = "T-HB") {
  const { ctx: reception } = await userCtx(["RECEPTION"]);
  const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
  const p = await newPatient(reception, { sexAtBirth: "FEMALE", dateOfBirth: "1990-01-01" });
  const enc = await visitInConsultation(reception, doctor, p.patientId);
  const test = await labTest(code);
  const { orders } = await placeOrders(doctor, { encounterId: enc.id, requestGroupId: crypto.randomUUID(), priority: "URGENT", clinicalIndication: "Fatigue", items: [{ kind: "LAB", labTestId: test.id }] });
  return { reception, doctor, p, enc, test, order: orders[0]! };
}

async function toInProgress(lab: Awaited<ReturnType<typeof userCtx>>["ctx"], orderId: string) {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId } });
  const s = await collectSpecimen(lab, { orderId, version: o.version });
  await receiveSpecimen(lab, s.id);
  return s;
}

/** Approved Hb range for adult females, created and approved by two different people. */
async function approvedHbRange() {
  const test = await labTest("T-HB");
  const comp = test.components[0]!;
  const existing = await prisma.labReferenceRange.findFirst({ where: { componentId: comp.id, status: "APPROVED", sex: "FEMALE" } });
  if (existing) return existing;
  const { ctx: author } = await userCtx(["LAB_SCIENTIST", "MEDICAL_DIRECTOR"]);
  const { ctx: approver } = await userCtx(["MEDICAL_DIRECTOR"]);
  const r = await proposeReferenceRange(author, { componentId: comp.id, sex: "FEMALE", ageMinDays: 6570, low: 12, high: 15.5, criticalLow: 7, criticalHigh: 20, source: "Test fixture" });
  await expect(decideReferenceRange(author, { id: r.id, decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
  await decideReferenceRange(approver, { id: r.id, decision: "APPROVE" });
  return r;
}

describe("laboratory", () => {
  it("visit -> lab order -> specimen -> result -> independent verification -> clinician review", async () => {
    await approvedHbRange();
    const { doctor, order, test } = await labOrder();
    const { ctx: sci1 } = await userCtx(["LAB_SCIENTIST"]);
    const { ctx: sci2 } = await userCtx(["LAB_SCIENTIST"]);
    const specimen = await toInProgress(sci1, order.id);
    expect(specimen.accession).toMatch(/^ACC-\d{4}-\d{6}$/);
    await expect(enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "11,2" }], submit: false })).rejects.toBeInstanceOf(ValidationError);
    await enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "11.2" }], submit: true });
    // the same person cannot verify their own results
    await expect(verifyResults(sci1, { orderId: order.id, password: TEST_PASSWORD })).rejects.toBeInstanceOf(ForbiddenError);
    await verifyResults(sci2, { orderId: order.id, password: TEST_PASSWORD });
    const result = await prisma.labResult.findFirstOrThrow({ where: { orderId: order.id } });
    expect(result.status).toBe("FINAL");
    expect(result.flag).toBe("LOW");
    expect(result.referenceText).toBe("12–15.5 g/dL");
    expect(await prisma.notification.count({ where: { userId: doctor.userId, template: "lab.results_ready" } })).toBe(1);
    await reviewOrderResult(doctor, order.id);
    const done = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id }, include: { events: { orderBy: { changedAt: "asc" } } } });
    expect(done.reviewedById).toBe(doctor.userId);
    expect(done.events.map((e) => e.toStatus)).toEqual(["ORDERED", "SPECIMEN_COLLECTED", "IN_PROGRESS", "RESULTED", "VERIFIED"]);
  });

  it("without an approved range, no flag is guessed", async () => {
    const { order, test } = await labOrder("T-MP");
    const { ctx: sci1 } = await userCtx(["LAB_SCIENTIST"]);
    await toInProgress(sci1, order.id);
    await expect(enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "Positive" }], submit: false })).rejects.toThrow(/choose one of/);
    await enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "Seen (+)" }], submit: false });
    const r = await prisma.labResult.findFirstOrThrow({ where: { orderId: order.id } });
    expect(r.flag).toBe("NONE");
  });

  it("(10) verified results are immutable; amendments are new, attributed and supersede the original", async () => {
    await approvedHbRange();
    const { doctor, order, test } = await labOrder();
    const { ctx: sci1 } = await userCtx(["LAB_SCIENTIST"]);
    const { ctx: sci2 } = await userCtx(["LAB_SCIENTIST"]);
    await toInProgress(sci1, order.id);
    await enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "13.0" }], submit: true });
    await verifyResults(sci2, { orderId: order.id, password: TEST_PASSWORD });
    await reviewOrderResult(doctor, order.id);
    const original = await prisma.labResult.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(prisma.labResult.update({ where: { id: original.id }, data: { valueText: "9.9" } })).rejects.toThrow(/immutable/);
    await expect(prisma.labResult.delete({ where: { id: original.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "9.9" }], submit: false })).rejects.toBeInstanceOf(ConflictError);
    const amended = await amendResult(sci2, { resultId: original.id, value: "10.3", reason: "Transcription error", password: TEST_PASSWORD });
    const old = await prisma.labResult.findUniqueOrThrow({ where: { id: original.id } });
    expect(old.valueText).toBe("13.0");
    expect(old.supersededById).toBe(sci2.userId);
    expect(amended.amendsResultId).toBe(original.id);
    expect(amended.flag).toBe("LOW");
    await expect(amendResult(sci2, { resultId: original.id, value: "11", reason: "again", password: TEST_PASSWORD })).rejects.toBeInstanceOf(ConflictError);
    // clinician must review again after an amendment
    expect((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } })).reviewedAt).toBeNull();
  });

  it("(18) critical results raise an alert whose acknowledgement is attributed and timestamped", async () => {
    await approvedHbRange();
    const { doctor, order, test } = await labOrder();
    const { ctx: sci1 } = await userCtx(["LAB_SCIENTIST"]);
    const { ctx: sci2 } = await userCtx(["LAB_SCIENTIST"]);
    await toInProgress(sci1, order.id);
    await enterResults(sci1, { orderId: order.id, results: [{ componentId: test.components[0]!.id, value: "5.8" }], submit: true });
    const { criticalAlertId } = await verifyResults(sci2, { orderId: order.id, password: TEST_PASSWORD });
    expect(criticalAlertId).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: doctor.userId, template: "lab.critical_result" } })).toBe(1);
    const { ctx: stranger } = await userCtx(["PHYSICIAN"], { branch: "T-OTHER" });
    await expect(acknowledgeCritical(stranger, { alertId: criticalAlertId!, communicatedTo: "x", communicationMethod: "PHONE" })).rejects.toBeInstanceOf(ForbiddenError);
    await acknowledgeCritical(doctor, { alertId: criticalAlertId!, communicatedTo: "Dr on call (self)", communicationMethod: "IN_PERSON", notes: "Patient reviewed" });
    const alert = await prisma.criticalResultAlert.findUniqueOrThrow({ where: { id: criticalAlertId! } });
    expect(alert.acknowledgedById).toBe(doctor.userId);
    expect(alert.acknowledgedAt).toBeInstanceOf(Date);
    await expect(acknowledgeCritical(doctor, { alertId: criticalAlertId!, communicatedTo: "x", communicationMethod: "PHONE" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejected specimens send the order back for recollection and notify the orderer", async () => {
    const { doctor, order } = await labOrder();
    const { ctx: sci } = await userCtx(["LAB_SCIENTIST"]);
    const s = await toInProgress(sci, order.id);
    await rejectSpecimen(sci, { specimenId: s.id, reason: "Haemolysed" });
    const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("ORDERED");
    expect(await prisma.notification.count({ where: { userId: doctor.userId, template: "lab.specimen_rejected" } })).toBe(1);
  });
});

describe("imaging", () => {
  it("signed reports are immutable; amendments are new signed reports", async () => {
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    const { ctx: doctor } = await userCtx(["PHYSICIAN"]);
    const { ctx: rad } = await userCtx(["IMAGING"]);
    const p = await newPatient(reception);
    const enc = await visitInConsultation(reception, doctor, p.patientId);
    const cxr = await prisma.imagingStudyDefinition.findUniqueOrThrow({ where: { code: "T-CXR" } });
    const { orders } = await placeOrders(doctor, { encounterId: enc.id, requestGroupId: crypto.randomUUID(), priority: "ROUTINE", clinicalIndication: "Cough", items: [{ kind: "IMAGING", imagingStudyId: cxr.id }] });
    await startImaging(rad, orders[0]!.id);
    const report = await saveImagingReport(rad, { orderId: orders[0]!.id, findings: "Clear lung fields.", impression: "Normal study." });
    await signImagingReport(rad, { reportId: report.id, password: TEST_PASSWORD });
    await expect(prisma.imagingReport.update({ where: { id: report.id }, data: { impression: "x" } })).rejects.toThrow(/immutable/);
    await expect(amendImagingReport(rad, { reportId: report.id, findings: "f", impression: "i", reason: "r", password: "bad" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.imagingReport.count({ where: { orderId: orders[0]!.id } })).toBe(1);
    const amended = await amendImagingReport(rad, { reportId: report.id, findings: "Small right effusion.", impression: "Right pleural effusion.", reason: "Second read", password: TEST_PASSWORD });
    expect(amended.status).toBe("SIGNED");
    expect(amended.amendsReportId).toBe(report.id);
  });
});

describe("documents", () => {
  const memory = new Map<string, Buffer>();
  const store: StorageDriver = { put: async (k, b) => void memory.set(k, b), get: async (k) => memory.get(k)! };
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

  it("(21) only permitted users can download; every attempt is logged; type is checked by content", async () => {
    const { order } = await labOrder();
    const { ctx: sci } = await userCtx(["LAB_SCIENTIST"]);
    await expect(
      uploadDocument(sci, { bytes: Buffer.from("MZ executable"), filename: "report.pdf", title: "x", kind: "LAB_REPORT", orderId: order.id, source: "INTERNAL" }, store),
    ).rejects.toThrow(/Only PDF, PNG and JPEG/);
    await expect(
      uploadDocument(sci, { bytes: pdf, filename: "ext.pdf", title: "External", kind: "LAB_REPORT", orderId: order.id, source: "EXTERNAL" }, store),
    ).rejects.toThrow(/where an external document came from/);
    const doc = await uploadDocument(sci, { bytes: pdf, filename: "../../etc/passwd.pdf", title: "Analyser printout", kind: "LAB_REPORT", orderId: order.id, source: "INTERNAL" }, store);
    expect(doc.filename).toBe("etcpasswd.pdf");
    expect(doc.mimeType).toBe("application/pdf");
    const { ctx: hr } = await userCtx(["HR_PAYROLL"]);
    const { ctx: reception } = await userCtx(["RECEPTION"]);
    await expect(authorizeDownload(hr, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(authorizeDownload(reception, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await authorizeDownload(sci, doc.id)).id).toBe(doc.id);
    expect(await prisma.auditEvent.count({ where: { resourceId: doc.id, action: "denied.document.download" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { resourceId: doc.id, action: "document.download" } })).toBe(1);
    await expect(prisma.document.delete({ where: { id: doc.id } })).rejects.toThrow(/append-only/);
  });
});
