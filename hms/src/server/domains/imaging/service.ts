import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, requireActingBranch, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { sha256 } from "../../crypto";
import { confirmSignature } from "../../auth/reauth";
import { notifyUsers } from "../../notify";
import type { amendImagingSchema, imagingReportSchema } from "@/lib/schemas/lab";
import { transitionOrder } from "../clinical/orders";

export type ImagingTab = "TO_SCHEDULE" | "SCHEDULED" | "IN_PROGRESS" | "TO_SIGN" | "SIGNED_TODAY";
const TAB_STATUS = { TO_SCHEDULE: "ORDERED", SCHEDULED: "SCHEDULED", IN_PROGRESS: "IN_PROGRESS", TO_SIGN: "RESULTED", SIGNED_TODAY: "VERIFIED" } as const;

export async function imagingWorklist(ctx: AuthContext, tab: ImagingTab, db: DbClient = prisma) {
  const branchId = requireActingBranch(ctx, "imaging.worklist");
  return db.serviceOrder.findMany({
    where: {
      branchId,
      kind: "IMAGING",
      status: TAB_STATUS[tab],
      ...(tab === "SIGNED_TODAY" ? { verifiedAt: { gt: new Date(Date.now() - 24 * 3_600_000) } } : {}),
    },
    orderBy: [{ scheduledAt: "asc" }, { orderedAt: "asc" }],
    take: 200,
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true } },
      imagingStudy: true,
      orderedBy: { select: { displayName: true } },
    },
  });
}

async function loadImagingOrder(ctx: AuthContext, orderId: string, permission: "imaging.worklist" | "imaging.report.write" | "imaging.report.sign", db: DbClient) {
  const order = await db.serviceOrder.findUnique({
    where: { id: orderId },
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true, sexAtBirth: true, dateOfBirth: true } },
      imagingStudy: true,
      orderedBy: { select: { id: true, displayName: true } },
      imagingReports: { orderBy: { createdAt: "asc" }, include: { author: { select: { displayName: true } }, signedBy: { select: { displayName: true } } } },
      documents: { where: { voidedAt: null }, orderBy: { uploadedAt: "asc" } },
    },
  });
  if (!order || order.kind !== "IMAGING") throw new NotFoundError("Imaging order not found.");
  if (!can(ctx, permission, { branchId: order.branchId })) throw new ForbiddenError(undefined, permission);
  return order;
}

export const getImagingOrder = (ctx: AuthContext, orderId: string, db: DbClient = prisma) => loadImagingOrder(ctx, orderId, "imaging.worklist", db);

export async function scheduleImaging(ctx: AuthContext, input: { orderId: string; scheduledAt: Date }, db: DbClient = prisma) {
  const order = await loadImagingOrder(ctx, input.orderId, "imaging.report.write", db);
  await withTx(db, async (tx) => {
    if (order.status === "SCHEDULED") {
      await tx.serviceOrder.update({ where: { id: order.id }, data: { scheduledAt: input.scheduledAt, version: { increment: 1 } } });
    } else {
      await transitionOrder(tx, order, "SCHEDULED", ctx.userId, { scheduledAt: input.scheduledAt });
    }
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "imaging.schedule", resourceType: "ServiceOrder", resourceId: order.id, patientId: order.patientId, meta: ctx.meta });
  });
}

export async function startImaging(ctx: AuthContext, orderId: string, db: DbClient = prisma) {
  const order = await loadImagingOrder(ctx, orderId, "imaging.report.write", db);
  await withTx(db, async (tx) => {
    await transitionOrder(tx, order, "IN_PROGRESS", ctx.userId);
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "imaging.start", resourceType: "ServiceOrder", resourceId: order.id, patientId: order.patientId, meta: ctx.meta });
  });
}

/** Save (create or update) the draft report; the first save moves the order to RESULTED. */
export async function saveImagingReport(ctx: AuthContext, input: z.output<typeof imagingReportSchema>, db: DbClient = prisma) {
  const order = await loadImagingOrder(ctx, input.orderId, "imaging.report.write", db);
  if (order.status !== "IN_PROGRESS" && order.status !== "RESULTED") throw new ConflictError("Start the examination before reporting.");
  const draft = order.imagingReports.find((r) => r.status === "DRAFT" && !r.amendsReportId);
  if (draft && draft.authorId !== ctx.userId) throw new ForbiddenError(`A draft by ${draft.author.displayName} is in progress.`);
  return withTx(db, async (tx) => {
    const report = draft
      ? await tx.imagingReport.update({ where: { id: draft.id }, data: { findings: input.findings, impression: input.impression } })
      : await tx.imagingReport.create({ data: { orderId: order.id, findings: input.findings, impression: input.impression, authorId: ctx.userId } });
    if (order.status === "IN_PROGRESS") await transitionOrder(tx, order, "RESULTED", ctx.userId, { resultedAt: new Date() });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "imaging.report.save", resourceType: "ImagingReport", resourceId: report.id, patientId: order.patientId, meta: ctx.meta });
    return report;
  });
}

function reportHash(r: { id: string; orderId: string; findings: string; impression: string; amendsReportId: string | null }, signedAt: Date) {
  return sha256(JSON.stringify([r.id, r.orderId, r.findings, r.impression, r.amendsReportId, signedAt.toISOString()]));
}

export async function signImagingReport(ctx: AuthContext, input: { reportId: string; password: string }, db: DbClient = prisma) {
  const report = await db.imagingReport.findUnique({ where: { id: input.reportId } });
  if (!report) throw new NotFoundError();
  const order = await loadImagingOrder(ctx, report.orderId, "imaging.report.sign", db);
  if (report.status !== "DRAFT") throw new ConflictError("Already signed.");
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const signedAt = new Date();
    await tx.imagingReport.update({ where: { id: report.id }, data: { status: "SIGNED", signedAt, signedById: ctx.userId, contentHash: reportHash(report, signedAt) } });
    if (order.status === "RESULTED") await transitionOrder(tx, order, "VERIFIED", ctx.userId, { verifiedAt: signedAt });
    else await tx.serviceOrder.update({ where: { id: order.id }, data: { reviewedAt: null, reviewedById: null, version: { increment: 1 } } });
    await notifyUsers(tx, [order.orderedById], report.amendsReportId ? "imaging.report_amended" : "imaging.report_ready", { orderId: order.id });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "imaging.report.sign", resourceType: "ImagingReport", resourceId: report.id, patientId: order.patientId, details: { amendment: !!report.amendsReportId }, meta: ctx.meta });
  });
}

/** An amended report is a new signed report that references the original (which stays readable). */
export async function amendImagingReport(ctx: AuthContext, input: z.output<typeof amendImagingSchema>, db: DbClient = prisma) {
  const original = await db.imagingReport.findUnique({ where: { id: input.reportId }, include: { amendedBy: true } });
  if (!original) throw new NotFoundError();
  if (original.status !== "SIGNED") throw new ConflictError("Only signed reports can be amended.");
  if (original.amendedBy) throw new ConflictError("This report has already been amended; amend the latest version.");
  const order = await loadImagingOrder(ctx, original.orderId, "imaging.report.sign", db);
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const signedAt = new Date();
    const id = crypto.randomUUID();
    const content = { id, orderId: original.orderId, findings: input.findings, impression: input.impression, amendsReportId: original.id };
    const r = await tx.imagingReport.create({
      data: {
        ...content,
        authorId: ctx.userId,
        amendmentReason: input.reason,
        status: "SIGNED",
        signedAt,
        signedById: ctx.userId,
        contentHash: reportHash(content, signedAt),
      },
    });
    await tx.serviceOrder.update({ where: { id: order.id }, data: { reviewedAt: null, reviewedById: null, version: { increment: 1 } } });
    await notifyUsers(tx, [order.orderedById], "imaging.report_amended", { orderId: order.id });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "imaging.report.amend",
      resourceType: "ImagingReport",
      resourceId: r.id,
      patientId: order.patientId,
      details: { amends: original.id, reason: input.reason },
      meta: ctx.meta,
    });
    return r;
  });
}
