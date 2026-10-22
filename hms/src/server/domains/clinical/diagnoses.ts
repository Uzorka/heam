import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import type { AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import type { diagnosisSchema, updateDiagnosisSchema } from "@/lib/schemas/clinical";
import { careRoleFor, getEncounterAccess, joinCareTeam, loadEncounterFor } from "./access";

export async function addDiagnosis(ctx: AuthContext, input: z.output<typeof diagnosisSchema>, db: DbClient = prisma) {
  const { enc } = await loadEncounterFor(ctx, input.encounterId, "clinical.diagnosis.write", {}, db);
  return withTx(db, async (tx) => {
    if (input.isPrimary) {
      await tx.diagnosis.updateMany({ where: { encounterId: enc.id, isPrimary: true }, data: { isPrimary: false, version: { increment: 1 } } });
    }
    const d = await tx.diagnosis.create({
      data: {
        encounterId: enc.id,
        patientId: enc.patientId,
        description: input.description,
        code: input.code,
        codeSystem: input.code ? "ICD-10" : null,
        certainty: input.certainty,
        isPrimary: input.isPrimary,
        onProblemList: input.onProblemList,
        recordedById: ctx.userId,
      },
    });
    await joinCareTeam(tx, enc, ctx.userId, careRoleFor(ctx));
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.diagnosis.add",
      resourceType: "Diagnosis",
      resourceId: d.id,
      patientId: enc.patientId,
      details: { certainty: d.certainty, coded: !!d.code },
      meta: ctx.meta,
    });
    return d;
  });
}

export async function updateDiagnosis(ctx: AuthContext, input: z.output<typeof updateDiagnosisSchema>, db: DbClient = prisma) {
  const d = await db.diagnosis.findUnique({ where: { id: input.id }, include: { encounter: true } });
  if (!d) throw new NotFoundError();
  await loadEncounterFor(ctx, d.encounterId, "clinical.diagnosis.write", {}, db);
  const access = await getEncounterAccess(ctx, d.encounter, db);
  if (!access) throw new ForbiddenError();
  if (d.status === "ENTERED_IN_ERROR") throw new ConflictError("This entry was marked as entered in error.");
  if ((input.status === "ENTERED_IN_ERROR" || input.certainty === "REFUTED") && !input.reason) {
    throw new ValidationError("A reason is required.", { reason: "Required" });
  }
  return withTx(db, async (tx) => {
    const r = await tx.diagnosis.updateMany({
      where: { id: d.id, version: input.version },
      data: {
        ...(input.certainty ? { certainty: input.certainty } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.onProblemList !== undefined ? { onProblemList: input.onProblemList } : {}),
        ...(input.reason ? { statusReason: input.reason } : {}),
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("This diagnosis changed since you opened it.", "STALE");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "clinical.diagnosis.update",
      resourceType: "Diagnosis",
      resourceId: d.id,
      patientId: d.patientId,
      details: { from: { certainty: d.certainty, status: d.status }, to: { certainty: input.certainty ?? d.certainty, status: input.status ?? d.status } },
      meta: ctx.meta,
    });
  });
}
