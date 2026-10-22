import type { LabReferenceRange, LabTestComponent, Prisma, ResultFlag } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { nextYearlyRef } from "../../sequence";
import { confirmSignature } from "../../auth/reauth";
import { notifyUsers } from "../../notify";
import { todayLocal } from "@/lib/time";
import type {
  acknowledgeCriticalSchema,
  amendResultSchema,
  collectSpecimenSchema,
  enterResultsSchema,
  rejectSpecimenSchema,
  returnResultsSchema,
  verifyResultsSchema,
} from "@/lib/schemas/lab";
import { getSetting } from "../settings/system-settings";
import { getEncounterAccess } from "../clinical/access";
import { transitionOrder } from "../clinical/orders";
import { CRITICAL_FLAGS, FLAG_LABEL, flagCoded, flagNumeric, parseNumericResult, referenceText, selectRange, type RangeLike } from "./flags";

const n = (d: Prisma.Decimal | null) => (d === null ? null : Number(d.toString()));
export function toRangeLike(r: LabReferenceRange): RangeLike & { id: string } {
  return { id: r.id, sex: r.sex, ageMinDays: r.ageMinDays, ageMaxDays: r.ageMaxDays, low: n(r.low), high: n(r.high), criticalLow: n(r.criticalLow), criticalHigh: n(r.criticalHigh), normalText: r.normalText };
}

export type LabTab = "TO_COLLECT" | "TO_RECEIVE" | "IN_PROGRESS" | "TO_VERIFY" | "VERIFIED_TODAY";
const TAB_STATUS = {
  TO_COLLECT: "ORDERED",
  TO_RECEIVE: "SPECIMEN_COLLECTED",
  IN_PROGRESS: "IN_PROGRESS",
  TO_VERIFY: "RESULTED",
  VERIFIED_TODAY: "VERIFIED",
} as const;

/** Lab worklist: minimum necessary data (patient identity, test, indication) - no chart content. */
export async function labWorklist(ctx: AuthContext, tab: LabTab, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "lab.worklist");
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.serviceOrder.findMany({
    where: { branchId, kind: "LAB", status: TAB_STATUS[tab], ...(tab === "VERIFIED_TODAY" ? { verifiedAt: { gt: since } } : {}) },
    orderBy: [{ orderedAt: "asc" }],
    take: 200,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true } },
      labTest: { select: { name: true, specimenType: true, turnaroundHours: true } },
      orderedBy: { select: { displayName: true } },
      specimens: { orderBy: { collectedAt: "desc" }, take: 3 },
    },
  });
  const rank = { STAT: 0, URGENT: 1, ROUTINE: 2 } as const;
  return rows.sort((a, b) => rank[a.priority] - rank[b.priority] || a.orderedAt.getTime() - b.orderedAt.getTime());
}

export async function labTabCounts(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "lab.worklist");
  const grouped = await db.serviceOrder.groupBy({ by: ["status"], where: { branchId, kind: "LAB", status: { in: ["ORDERED", "SPECIMEN_COLLECTED", "IN_PROGRESS", "RESULTED"] } }, _count: { _all: true } });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<string, number>>;
}

async function loadLabOrder(ctx: AuthContext, orderId: string, permission: "lab.specimen.collect" | "lab.result.enter" | "lab.result.verify" | "lab.worklist", db: DbClient) {
  const order = await db.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true } },
      labTest: { include: { components: { orderBy: { sortOrder: "asc" }, include: { ranges: { where: { status: "APPROVED" } } } } } },
      specimens: { orderBy: { collectedAt: "desc" } },
      results: { orderBy: { enteredAt: "asc" }, include: { enteredBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } },
      orderedBy: { select: { id: true, displayName: true } },
    },
  });
  if (!order || order.kind !== "LAB" || !order.labTest) throw new NotFoundError("Lab order not found.");
  if (!can(ctx, permission, { branchId: order.branchId })) throw new ForbiddenError(undefined, permission);
  return order;
}

export async function getLabOrder(ctx: AuthContext, orderId: string, db: DbClient = prisma) {
  return loadLabOrder(ctx, orderId, "lab.worklist", db);
}

export async function collectSpecimen(ctx: AuthContext, input: z.output<typeof collectSpecimenSchema>, db: DbClient = prisma) {
  const order = await loadLabOrder(ctx, input.orderId, "lab.specimen.collect", db);
  if (order.status !== "ORDERED") throw new ConflictError("A specimen has already been collected for this order.");
  return withTx(db, async (tx) => {
    await transitionOrder(tx, { ...order, version: input.version }, "SPECIMEN_COLLECTED", ctx.userId);
    const specimen = await tx.labSpecimen.create({
      data: {
        orderId: order.id,
        accession: await nextYearlyRef(tx, "ACC", Number(todayLocal().slice(0, 4))),
        specimenType: order.labTest!.specimenType,
        collectedAt: new Date(),
        collectedById: ctx.userId,
      },
    });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.specimen.collect", resourceType: "LabSpecimen", resourceId: specimen.id, patientId: order.patientId, details: { accession: specimen.accession, orderRef: order.ref }, meta: ctx.meta });
    return specimen;
  });
}

async function loadSpecimen(ctx: AuthContext, specimenId: string, db: DbClient) {
  const s = await db.labSpecimen.findUnique({ where: { id: specimenId }, include: { order: true } });
  if (!s) throw new NotFoundError("Specimen not found.");
  requirePermission(ctx, "lab.specimen.collect", { branchId: s.order.branchId });
  return s;
}

export async function receiveSpecimen(ctx: AuthContext, specimenId: string, db: DbClient = prisma) {
  const s = await loadSpecimen(ctx, specimenId, db);
  if (s.status !== "COLLECTED" || s.order.status !== "SPECIMEN_COLLECTED") throw new ConflictError("This specimen is not awaiting receipt.");
  await withTx(db, async (tx) => {
    await tx.labSpecimen.update({ where: { id: s.id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.userId } });
    await transitionOrder(tx, s.order, "IN_PROGRESS", ctx.userId);
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.specimen.receive", resourceType: "LabSpecimen", resourceId: s.id, patientId: s.order.patientId, meta: ctx.meta });
  });
}

export async function rejectSpecimen(ctx: AuthContext, input: z.output<typeof rejectSpecimenSchema>, db: DbClient = prisma) {
  const s = await loadSpecimen(ctx, input.specimenId, db);
  if (s.status === "REJECTED") throw new ConflictError("Already rejected.");
  if (!["SPECIMEN_COLLECTED", "IN_PROGRESS"].includes(s.order.status)) throw new ConflictError("Results have been entered; the specimen can no longer be rejected.");
  await withTx(db, async (tx) => {
    await tx.labSpecimen.update({ where: { id: s.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: ctx.userId, rejectionReason: input.reason } });
    await tx.labResult.deleteMany({ where: { orderId: s.orderId, status: "DRAFT" } });
    await transitionOrder(tx, s.order, "ORDERED", ctx.userId, {}, `Specimen rejected: ${input.reason}`);
    await notifyUsers(tx, [s.order.orderedById], "lab.specimen_rejected", { orderId: s.orderId });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.specimen.reject", resourceType: "LabSpecimen", resourceId: s.id, patientId: s.order.patientId, details: { reason: input.reason }, meta: ctx.meta });
  });
}

function ageDaysAt(dob: Date | null, at: Date): number | null {
  if (!dob) return null;
  return Math.floor((at.getTime() - dob.getTime()) / 86_400_000);
}

interface Evaluated {
  valueText: string;
  valueNumeric: number | null;
  flag: ResultFlag;
  referenceText: string | null;
}

/** Validate a raw value for a component and compute its flag from APPROVED ranges only. */
export function evaluateResult(
  component: LabTestComponent & { ranges: LabReferenceRange[] },
  raw: string,
  patient: { sexAtBirth: string; dateOfBirth: Date | null },
  at: Date,
): Evaluated {
  const value = raw.trim();
  const range = selectRange(component.ranges.filter((r) => r.status === "APPROVED").map(toRangeLike), patient.sexAtBirth, ageDaysAt(patient.dateOfBirth, at));
  if (component.resultType === "NUMERIC") {
    const num = parseNumericResult(value, component.decimals);
    if (num === null) throw new ValidationError(`${component.name}: enter a number${component.decimals !== null ? ` with at most ${component.decimals} decimal place(s)` : ""}.`, { [component.id]: "Invalid number" });
    return { valueText: value, valueNumeric: num, flag: flagNumeric(num, range), referenceText: referenceText(range, component.unit) };
  }
  if (component.resultType === "CODED") {
    if (!component.allowedValues.includes(value)) throw new ValidationError(`${component.name}: choose one of ${component.allowedValues.join(", ")}.`, { [component.id]: "Invalid option" });
    return { valueText: value, valueNumeric: null, flag: flagCoded(value, range), referenceText: referenceText(range, null) };
  }
  return { valueText: value, valueNumeric: null, flag: "NONE", referenceText: referenceText(range, null) };
}

export async function enterResults(ctx: AuthContext, input: z.output<typeof enterResultsSchema>, db: DbClient = prisma) {
  const order = await loadLabOrder(ctx, input.orderId, "lab.result.enter", db);
  if (order.status !== "IN_PROGRESS") throw new ConflictError(order.status === "RESULTED" ? "Results are awaiting verification." : "Receive the specimen before entering results.");
  const components = order.labTest!.components;
  const at = order.specimens.find((s) => s.status === "RECEIVED")?.collectedAt ?? new Date();
  const entries = input.results.filter((r) => r.value.trim() !== "");
  for (const e of entries) if (!components.some((c) => c.id === e.componentId)) throw new ValidationError("Unknown result component.");
  const evaluated = entries.map((e) => ({ componentId: e.componentId, ...evaluateResult(components.find((c) => c.id === e.componentId)!, e.value, order.patient, at) }));
  return withTx(db, async (tx) => {
    for (const e of evaluated) {
      const comp = components.find((c) => c.id === e.componentId)!;
      const draft = await tx.labResult.findFirst({ where: { orderId: order.id, componentId: e.componentId, status: "DRAFT" } });
      const data = { valueText: e.valueText, valueNumeric: e.valueNumeric, unit: comp.unit, referenceText: e.referenceText, flag: e.flag, enteredById: ctx.userId, enteredAt: new Date() };
      if (draft) await tx.labResult.update({ where: { id: draft.id }, data });
      else await tx.labResult.create({ data: { orderId: order.id, componentId: e.componentId, ...data } });
    }
    let submitted = false;
    if (input.submit) {
      const have = await tx.labResult.count({ where: { orderId: order.id, status: "DRAFT" } });
      if (have < components.length) throw new ValidationError("Enter every component before submitting for verification.");
      await transitionOrder(tx, order, "RESULTED", ctx.userId, { resultedAt: new Date() });
      submitted = true;
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: submitted ? "lab.result.submit" : "lab.result.save",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      details: { components: evaluated.length },
      meta: ctx.meta,
    });
    return { submitted };
  });
}

export async function returnForCorrection(ctx: AuthContext, input: z.output<typeof returnResultsSchema>, db: DbClient = prisma) {
  const order = await loadLabOrder(ctx, input.orderId, "lab.result.verify", db);
  if (order.status !== "RESULTED") throw new ConflictError("Only results awaiting verification can be returned.");
  await withTx(db, async (tx) => {
    await transitionOrder(tx, order, "IN_PROGRESS", ctx.userId, {}, input.reason);
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.result.return", resourceType: "ServiceOrder", resourceId: order.id, patientId: order.patientId, details: { reason: input.reason }, meta: ctx.meta });
  });
}

async function raiseCriticalIfNeeded(tx: Tx, order: { id: string; patientId: string; orderedById: string; encounterId: string; description: string }, flags: { name: string; flag: ResultFlag }[]) {
  const critical = flags.filter((f) => CRITICAL_FLAGS.includes(f.flag));
  if (!critical.length) return null;
  const alert = await tx.criticalResultAlert.create({
    data: { orderId: order.id, patientId: order.patientId, summary: `${order.description}: ${critical.map((c) => `${c.name} ${FLAG_LABEL[c.flag].toLowerCase()}`).join("; ")}` },
  });
  const enc = await tx.encounter.findUnique({ where: { id: order.encounterId }, select: { attendingClinicianId: true } });
  await notifyUsers(tx, [order.orderedById, enc?.attendingClinicianId], "lab.critical_result", { orderId: order.id, alertId: alert.id });
  return alert;
}

export async function verifyResults(ctx: AuthContext, input: z.output<typeof verifyResultsSchema>, db: DbClient = prisma) {
  const order = await loadLabOrder(ctx, input.orderId, "lab.result.verify", db);
  if (order.status !== "RESULTED") throw new ConflictError("There are no submitted results to verify.");
  const drafts = order.results.filter((r) => r.status === "DRAFT");
  if (drafts.length < order.labTest!.components.length) throw new ConflictError("Some components have no result.");
  if ((await getSetting(db, "lab.requireIndependentVerification")) && drafts.some((r) => r.enteredById === ctx.userId)) {
    throw new ForbiddenError("Results must be verified by someone other than the person who entered them.");
  }
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const now = new Date();
    const r = await tx.labResult.updateMany({ where: { orderId: order.id, status: "DRAFT" }, data: { status: "FINAL", verifiedById: ctx.userId, verifiedAt: now } });
    if (r.count !== drafts.length) throw new ConflictError("Results changed during verification. Reload and verify again.", "STALE");
    await transitionOrder(tx, order, "VERIFIED", ctx.userId, { verifiedAt: now });
    const alert = await raiseCriticalIfNeeded(
      tx,
      order,
      drafts.map((d) => ({ name: order.labTest!.components.find((c) => c.id === d.componentId)!.name, flag: d.flag })),
    );
    if (!alert) await notifyUsers(tx, [order.orderedById], "lab.results_ready", { orderId: order.id });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "lab.result.verify",
      resourceType: "ServiceOrder",
      resourceId: order.id,
      patientId: order.patientId,
      details: { results: drafts.length, critical: !!alert },
      meta: ctx.meta,
    });
    return { criticalAlertId: alert?.id ?? null };
  });
}

export async function amendResult(ctx: AuthContext, input: z.output<typeof amendResultSchema>, db: DbClient = prisma) {
  const old = await db.labResult.findUnique({ where: { id: input.resultId } });
  if (!old) throw new NotFoundError("Result not found.");
  const order = await loadLabOrder(ctx, old.orderId, "lab.result.verify", db);
  if (old.status !== "FINAL" || old.supersededAt) throw new ConflictError("Only the current verified result can be amended.");
  const component = order.labTest!.components.find((c) => c.id === old.componentId)!;
  const evaluated = evaluateResult(component, input.value, order.patient, order.specimens[0]?.collectedAt ?? new Date());
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const now = new Date();
    await tx.labResult.update({ where: { id: old.id }, data: { supersededAt: now, supersededById: ctx.userId } });
    const amended = await tx.labResult.create({
      data: {
        orderId: order.id,
        componentId: old.componentId,
        valueText: evaluated.valueText,
        valueNumeric: evaluated.valueNumeric,
        unit: component.unit,
        referenceText: evaluated.referenceText,
        flag: evaluated.flag,
        status: "FINAL",
        enteredById: ctx.userId,
        verifiedById: ctx.userId,
        verifiedAt: now,
        amendsResultId: old.id,
        amendmentReason: input.reason,
      },
    });
    // The clinician must look again.
    await tx.serviceOrder.update({ where: { id: order.id }, data: { reviewedAt: null, reviewedById: null, version: { increment: 1 } } });
    await raiseCriticalIfNeeded(tx, order, [{ name: component.name, flag: evaluated.flag }]);
    await notifyUsers(tx, [order.orderedById], "lab.result_amended", { orderId: order.id });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "lab.result.amend",
      resourceType: "LabResult",
      resourceId: amended.id,
      patientId: order.patientId,
      details: { amends: old.id, reason: input.reason },
      meta: ctx.meta,
    });
    return amended;
  });
}

export async function acknowledgeCritical(ctx: AuthContext, input: z.output<typeof acknowledgeCriticalSchema>, db: DbClient = prisma) {
  const alert = await db.criticalResultAlert.findUnique({ where: { id: input.alertId }, include: { order: { include: { encounter: true } } } });
  if (!alert) throw new NotFoundError();
  requirePermission(ctx, "lab.critical.acknowledge", { branchId: alert.order.branchId });
  const access = await getEncounterAccess(ctx, alert.order.encounter, db);
  if (!access) throw new ForbiddenError("No care relationship with this patient.");
  if (alert.acknowledgedAt) throw new ConflictError("Already acknowledged.");
  await withTx(db, async (tx) => {
    const r = await tx.criticalResultAlert.updateMany({
      where: { id: alert.id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: ctx.userId, communicatedTo: input.communicatedTo, communicationMethod: input.communicationMethod, notes: input.notes },
    });
    if (r.count !== 1) throw new ConflictError("Already acknowledged.");
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.critical.acknowledge", resourceType: "CriticalResultAlert", resourceId: alert.id, patientId: alert.patientId, details: { method: input.communicationMethod }, meta: ctx.meta });
  });
}

export async function unacknowledgedCriticalAlerts(ctx: AuthContext, db: DbClient = prisma) {
  const branchId = ctx.activeBranchId;
  if (!branchId || !can(ctx, "lab.critical.acknowledge", { branchId })) return [];
  return db.criticalResultAlert.findMany({
    where: { acknowledgedAt: null, order: { branchId, OR: [{ orderedById: ctx.userId }, { encounter: { careTeam: { some: { userId: ctx.userId, endedAt: null } } } }] } },
    orderBy: { raisedAt: "asc" },
    include: { patient: { select: { id: true, mrn: true, givenName: true, familyName: true } }, order: { select: { id: true, ref: true, encounterId: true } } },
  });
}
