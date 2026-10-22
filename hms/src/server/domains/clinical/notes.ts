import type { ClinicalNoteType, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { can, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { sha256 } from "../../crypto";
import { confirmSignature } from "../../auth/reauth";
import type { createNoteSchema, saveNoteSchema, signSchema } from "@/lib/schemas/clinical";
import { careRoleFor, getEncounterAccess, joinCareTeam, loadEncounterFor } from "./access";
import { sectionsFor } from "./templates";

type Content = Partial<Record<string, string>>;

function permissionFor(type: ClinicalNoteType) {
  return type === "NURSING" ? ("nursing.notes.write" as const) : ("clinical.note.write" as const);
}

function canSign(ctx: AuthContext, type: ClinicalNoteType, branchId: string) {
  if (type === "NURSING") return can(ctx, "nursing.notes.write", { branchId }) || can(ctx, "clinical.note.sign", { branchId });
  return can(ctx, "clinical.note.sign", { branchId });
}

function emptyContent(type: ClinicalNoteType): Content {
  return Object.fromEntries(sectionsFor(type).map((s) => [s, ""]));
}

export function noteSignatureHash(note: { id: string; encounterId: string; authorId: string; type: string; content: unknown; parentNoteId: string | null }, signedAt: Date) {
  return sha256(JSON.stringify([note.id, note.encounterId, note.authorId, note.type, note.parentNoteId, note.content, signedAt.toISOString()]));
}

export async function createNote(ctx: AuthContext, input: z.output<typeof createNoteSchema>, db: DbClient = prisma) {
  const { enc } = await loadEncounterFor(ctx, input.encounterId, permissionFor(input.type), {}, db);
  if (enc.status !== "OPEN") {
    const access = await getEncounterAccess(ctx, enc, db);
    if (access?.level !== "FULL") throw new ForbiddenError("Late entries on a closed visit need a care relationship.");
  }
  const content = emptyContent(input.type);
  return withTx(db, async (tx) => {
    const note = await tx.clinicalNote.create({
      data: {
        encounterId: enc.id,
        patientId: enc.patientId,
        type: input.type,
        templateKey: input.templateKey ?? input.type,
        content,
        authorId: ctx.userId,
      },
    });
    await tx.clinicalNoteVersion.create({ data: { noteId: note.id, version: 1, content, savedById: ctx.userId } });
    await joinCareTeam(tx, enc, ctx.userId, careRoleFor(ctx));
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.note.create",
      resourceType: "ClinicalNote",
      resourceId: note.id,
      patientId: enc.patientId,
      branchId: enc.branchId,
      details: { type: input.type, encounterId: enc.id },
      meta: ctx.meta,
    });
    return note;
  });
}

async function loadOwnDraft(ctx: AuthContext, noteId: string, db: DbClient) {
  const note = await db.clinicalNote.findUnique({ where: { id: noteId }, include: { encounter: true } });
  if (!note) throw new NotFoundError("Note not found.");
  if (note.authorId !== ctx.userId) throw new ForbiddenError("Only the author can change a draft note.");
  if (note.status !== "DRAFT") throw new ConflictError(note.status === "SIGNED" ? "This note is signed. Add an addendum instead." : "This draft was discarded.");
  const access = await getEncounterAccess(ctx, note.encounter, db);
  if (!access) throw new ForbiddenError("You no longer have access to this patient's record.");
  return note;
}

export async function saveNote(ctx: AuthContext, input: z.output<typeof saveNoteSchema>, db: DbClient = prisma) {
  const note = await loadOwnDraft(ctx, input.noteId, db);
  const allowed = new Set(sectionsFor(note.type));
  const content: Content = {};
  for (const [k, v] of Object.entries(input.content)) {
    if (v === undefined) continue;
    if (!allowed.has(k as never)) throw new ValidationError(`Unexpected section "${k}" for this note type.`);
    content[k] = v;
  }
  return withTx(db, async (tx) => {
    const next = input.version + 1;
    const r = await tx.clinicalNote.updateMany({
      where: { id: note.id, version: input.version, status: "DRAFT" },
      data: { content: content as Prisma.InputJsonValue, version: next },
    });
    if (r.count !== 1) throw new ConflictError("This draft was saved elsewhere (another tab?). Reload to continue.", "STALE");
    await tx.clinicalNoteVersion.create({ data: { noteId: note.id, version: next, content: content as Prisma.InputJsonValue, savedById: ctx.userId } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.note.save",
      resourceType: "ClinicalNote",
      resourceId: note.id,
      patientId: note.patientId,
      details: { version: next },
      meta: ctx.meta,
    });
    return { version: next };
  });
}

export async function discardNote(ctx: AuthContext, noteId: string, db: DbClient = prisma) {
  const note = await loadOwnDraft(ctx, noteId, db);
  await withTx(db, async (tx) => {
    await tx.clinicalNote.update({ where: { id: note.id }, data: { status: "DISCARDED" } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.note.discard",
      resourceType: "ClinicalNote",
      resourceId: note.id,
      patientId: note.patientId,
      meta: ctx.meta,
    });
  });
}

export async function signNote(ctx: AuthContext, input: z.output<typeof signSchema>, db: DbClient = prisma) {
  const note = await loadOwnDraft(ctx, input.id, db);
  if (!canSign(ctx, note.type, note.encounter.branchId)) throw new ForbiddenError("Your role cannot sign this type of note.");
  const content = (note.content ?? {}) as Content;
  if (!Object.values(content).some((v) => v && v.trim().length > 0)) throw new ValidationError("A blank note cannot be signed.");
  await confirmSignature(db, ctx, input.password);
  return withTx(db, async (tx) => {
    const signedAt = new Date();
    const hash = noteSignatureHash(note, signedAt);
    const r = await tx.clinicalNote.updateMany({
      where: { id: note.id, status: "DRAFT", version: note.version },
      data: { status: "SIGNED", signedAt, signedById: ctx.userId, contentHash: hash },
    });
    if (r.count !== 1) throw new ConflictError("The note changed while signing. Review it and sign again.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.note.sign",
      resourceType: "ClinicalNote",
      resourceId: note.id,
      patientId: note.patientId,
      details: { type: note.type, version: note.version, contentHash: hash, addendumTo: note.parentNoteId },
      meta: ctx.meta,
    });
    return { signedAt, contentHash: hash };
  });
}

export async function createAddendum(ctx: AuthContext, parentNoteId: string, db: DbClient = prisma) {
  const parent = await db.clinicalNote.findUnique({ where: { id: parentNoteId } });
  if (!parent) throw new NotFoundError("Note not found.");
  if (parent.status !== "SIGNED") throw new ConflictError("Only signed notes take addenda; edit the draft instead.");
  const { enc } = await loadEncounterFor(ctx, parent.encounterId, parent.type === "NURSING" ? "nursing.notes.write" : "clinical.note.write", {}, db);
  return withTx(db, async (tx) => {
    const content = { body: "" };
    const note = await tx.clinicalNote.create({
      data: { encounterId: enc.id, patientId: enc.patientId, type: "ADDENDUM", parentNoteId: parent.id, content, authorId: ctx.userId },
    });
    await tx.clinicalNoteVersion.create({ data: { noteId: note.id, version: 1, content, savedById: ctx.userId } });
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.note.addendum_create",
      resourceType: "ClinicalNote",
      resourceId: note.id,
      patientId: enc.patientId,
      details: { parentNoteId: parent.id },
      meta: ctx.meta,
    });
    return note;
  });
}

/** Signed notes plus the viewer's own drafts. Other people's drafts are shown only as "in progress". */
export async function listEncounterNotes(ctx: AuthContext, encounterId: string, db: DbClient = prisma) {
  const notes = await db.clinicalNote.findMany({
    where: { encounterId, status: { not: "DISCARDED" } },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { displayName: true, jobTitle: true } }, signedBy: { select: { displayName: true } } },
  });
  return notes.map((n) =>
    n.status === "DRAFT" && n.authorId !== ctx.userId
      ? { ...n, content: null, hiddenDraft: true as const }
      : { ...n, hiddenDraft: false as const },
  );
}
