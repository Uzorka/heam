import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import type { approveRuleSchema, labTestSchema, referenceRangeSchema } from "@/lib/schemas/lab";

export async function listLabCatalogue(db: DbClient = prisma) {
  return db.labTestDefinition.findMany({
    orderBy: { name: "asc" },
    include: {
      components: {
        orderBy: { sortOrder: "asc" },
        include: { ranges: { where: { status: { not: "RETIRED" } }, orderBy: [{ status: "asc" }, { sex: "asc" }, { ageMinDays: "asc" }] } },
      },
    },
  });
}

export async function listImagingCatalogue(db: DbClient = prisma) {
  return db.imagingStudyDefinition.findMany({ orderBy: [{ modality: "asc" }, { name: "asc" }] });
}

export async function createLabTest(ctx: AuthContext, input: z.output<typeof labTestSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "lab.catalogue.manage");
  try {
    return await withTx(db, async (tx) => {
      const t = await tx.labTestDefinition.create({
        data: {
          code: input.code,
          name: input.name,
          specimenType: input.specimenType,
          turnaroundHours: input.turnaroundHours,
          components: {
            create: input.components.map((c, i) => ({
              code: c.code,
              name: c.name,
              unit: c.unit,
              resultType: c.resultType,
              decimals: c.resultType === "NUMERIC" ? (c.decimals ?? null) : null,
              allowedValues: c.resultType === "CODED" ? c.allowedValues : [],
              sortOrder: i,
            })),
          },
        },
      });
      await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.catalogue.test_create", resourceType: "LabTestDefinition", resourceId: t.id, details: { code: t.code }, meta: ctx.meta });
      return t;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("A test with that code already exists.");
    throw e;
  }
}

export async function setLabTestActive(ctx: AuthContext, testId: string, active: boolean, db: DbClient = prisma) {
  requirePermission(ctx, "lab.catalogue.manage");
  await withTx(db, async (tx) => {
    await tx.labTestDefinition.update({ where: { id: testId }, data: { active } });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.catalogue.test_active", resourceType: "LabTestDefinition", resourceId: testId, details: { active }, meta: ctx.meta });
  });
}

export async function proposeReferenceRange(ctx: AuthContext, input: z.output<typeof referenceRangeSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "lab.catalogue.manage");
  const comp = await db.labTestComponent.findUnique({ where: { id: input.componentId } });
  if (!comp) throw new NotFoundError();
  return withTx(db, async (tx) => {
    const r = await tx.labReferenceRange.create({
      data: {
        componentId: comp.id,
        sex: input.sex,
        ageMinDays: input.ageMinDays,
        ageMaxDays: input.ageMaxDays,
        low: input.low,
        high: input.high,
        criticalLow: input.criticalLow,
        criticalHigh: input.criticalHigh,
        normalText: input.normalText,
        source: input.source,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, { actorType: "USER", actorUserId: ctx.userId, action: "lab.range.propose", resourceType: "LabReferenceRange", resourceId: r.id, details: { componentId: comp.id }, meta: ctx.meta });
    return r;
  });
}

/** Approving clinical content: a different person, holding clinical.rules.approve. */
export async function decideReferenceRange(ctx: AuthContext, input: z.output<typeof approveRuleSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "clinical.rules.approve");
  const r = await db.labReferenceRange.findUnique({ where: { id: input.id } });
  if (!r) throw new NotFoundError();
  if (input.decision === "APPROVE") {
    if (r.status !== "DRAFT") throw new ConflictError("Only drafts can be approved.");
    if (r.createdById === ctx.userId) throw new ForbiddenError("Clinical content must be approved by someone other than its author.");
  }
  await withTx(db, async (tx) => {
    if (input.decision === "APPROVE") {
      // Retire an overlapping approved range for the same component/sex/age band.
      await tx.labReferenceRange.updateMany({
        where: { componentId: r.componentId, sex: r.sex, ageMinDays: r.ageMinDays, ageMaxDays: r.ageMaxDays, status: "APPROVED" },
        data: { status: "RETIRED" },
      });
      await tx.labReferenceRange.update({ where: { id: r.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    } else {
      await tx.labReferenceRange.update({ where: { id: r.id }, data: { status: "RETIRED" } });
    }
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: input.decision === "APPROVE" ? "lab.range.approve" : "lab.range.retire",
      resourceType: "LabReferenceRange",
      resourceId: r.id,
      meta: ctx.meta,
    });
  });
}
