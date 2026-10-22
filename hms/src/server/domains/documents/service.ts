import type { Document, DocumentKind } from "@prisma/client";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { createHash } from "node:crypto";
import { getClinicalAccess } from "../../authz/clinical-access";
import { getEncounterAccess } from "../clinical/access";
import { MAX_UPLOAD_BYTES, safeFilename, scanUpload, sniffType } from "./validate";
import type { StorageDriver } from "./storage";

export interface UploadInput {
  bytes: Buffer;
  filename: string;
  title: string;
  kind: DocumentKind;
  orderId?: string;
  encounterId?: string;
  source: "INTERNAL" | "EXTERNAL";
  sourceDescription?: string;
}

async function authorizeAttach(ctx: AuthContext, input: Pick<UploadInput, "orderId" | "encounterId">, db: DbClient) {
  if (input.orderId) {
    const order = await db.serviceOrder.findUnique({ where: { id: input.orderId }, include: { encounter: true } });
    if (!order) throw new NotFoundError("Order not found.");
    const perm = order.kind === "LAB" ? "lab.result.enter" : order.kind === "IMAGING" ? "imaging.report.write" : "clinical.note.write";
    if (!can(ctx, perm, { branchId: order.branchId })) throw new ForbiddenError(undefined, perm);
    if (perm === "clinical.note.write" && !(await getEncounterAccess(ctx, order.encounter, db))) throw new ForbiddenError();
    return { patientId: order.patientId, encounterId: order.encounterId, orderId: order.id };
  }
  if (input.encounterId) {
    const enc = await db.encounter.findUnique({ where: { id: input.encounterId } });
    if (!enc) throw new NotFoundError("Visit not found.");
    if (!can(ctx, "clinical.note.write", { branchId: enc.branchId }) || !(await getEncounterAccess(ctx, enc, db))) throw new ForbiddenError();
    return { patientId: enc.patientId, encounterId: enc.id, orderId: null };
  }
  throw new ValidationError("Attach the document to an order or a visit.");
}

export async function uploadDocument(ctx: AuthContext, input: UploadInput, store: StorageDriver, db: DbClient = prisma) {
  if (input.bytes.length === 0) throw new ValidationError("The file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError("Files must be 10 MB or smaller.");
  const type = sniffType(input.bytes);
  if (!type) throw new ValidationError("Only PDF, PNG and JPEG files are accepted.");
  if (input.source === "EXTERNAL" && !input.sourceDescription) throw new ValidationError("Say where an external document came from.", { sourceDescription: "Required" });
  const links = await authorizeAttach(ctx, input, db);
  const scan = await scanUpload(input.bytes);
  if (scan === "INFECTED") throw new ValidationError("The file failed the security scan and was not stored.");
  const id = crypto.randomUUID();
  const storageKey = `documents/${id}`;
  await store.put(storageKey, input.bytes, type.mime);
  return withTx(db, async (tx) => {
    const doc = await tx.document.create({
      data: {
        id,
        ...links,
        kind: input.kind,
        title: input.title.slice(0, 200),
        filename: safeFilename(input.filename, type.ext),
        mimeType: type.mime,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        storageKey,
        source: input.source,
        sourceDescription: input.sourceDescription,
        scanStatus: scan,
        uploadedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "document.upload",
      resourceType: "Document",
      resourceId: doc.id,
      patientId: doc.patientId,
      details: { kind: doc.kind, sizeBytes: doc.sizeBytes, source: doc.source },
      meta: ctx.meta,
    });
    return doc;
  });
}

/** Per-request authorisation for a download. Every attempt (allowed or denied) is audited. */
export async function authorizeDownload(ctx: AuthContext, documentId: string, db: DbClient = prisma): Promise<Document> {
  const doc = await db.document.findUnique({ where: { id: documentId }, include: { order: { include: { encounter: true } }, encounter: true } });
  if (!doc || doc.voidedAt) throw new NotFoundError("Document not found.");
  let allowed = false;
  if (doc.order) {
    const worklist = doc.order.kind === "LAB" ? "lab.worklist" : doc.order.kind === "IMAGING" ? "imaging.worklist" : null;
    allowed = (!!worklist && can(ctx, worklist, { branchId: doc.order.branchId })) || !!(await getEncounterAccess(ctx, doc.order.encounter, db));
  } else if (doc.encounter) {
    allowed = !!(await getEncounterAccess(ctx, doc.encounter, db));
  } else if (doc.patientId) {
    allowed = (await getClinicalAccess(ctx, doc.patientId, db)).allowed;
  }
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: allowed ? "document.download" : "denied.document.download",
    resourceType: "Document",
    resourceId: doc.id,
    patientId: doc.patientId,
    outcome: allowed ? "SUCCESS" : "DENIED",
    meta: ctx.meta,
  });
  if (!allowed) throw new NotFoundError("Document not found.");
  return doc;
}

export async function voidDocument(ctx: AuthContext, input: { documentId: string; reason: string }, db: DbClient = prisma) {
  const doc = await db.document.findUnique({ where: { id: input.documentId } });
  if (!doc || doc.voidedAt) throw new NotFoundError();
  if (doc.uploadedById !== ctx.userId && !can(ctx, "clinical.read.branch_wide")) throw new ForbiddenError("Only the uploader or a clinical supervisor can void a document.");
  if (input.reason.trim().length < 5) throw new ConflictError("Give a reason.");
  await withTx(db, async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { voidedAt: new Date(), voidedById: ctx.userId, voidReason: input.reason } });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "document.void", resourceType: "Document", resourceId: doc.id, patientId: doc.patientId, meta: ctx.meta });
  });
}
