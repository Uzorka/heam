import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, withTx, type DbClient } from "../../db";
import { recordAudit } from "../../audit";
import { requirePermission, type AuthContext } from "../../authz/context";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { isUniqueViolation } from "../../db-errors";
import type {
  bedSchema,
  branchSchema,
  departmentSchema,
  organizationSchema,
  setupFactDecisionSchema,
  visitTypeSchema,
  wardSchema,
} from "@/lib/schemas/settings";
import { SETTING_DEFS, type SettingKey } from "./system-settings";

function audit(ctx: AuthContext, tx: DbClient, action: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  return recordAudit(tx, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action,
    resourceType,
    resourceId,
    details: details ?? null,
    meta: ctx.meta,
  });
}

async function uniqueGuard<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(message);
    throw e;
  }
}

export async function getOrganization(db: DbClient = prisma) {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new NotFoundError("Organisation has not been initialised. Run the seed or setup.");
  return org;
}

export async function updateOrganization(ctx: AuthContext, input: z.output<typeof organizationSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  const org = await getOrganization(db);
  await withTx(db, async (tx) => {
    const r = await tx.organization.updateMany({
      where: { id: org.id, version: input.version },
      data: {
        name: input.name,
        subtitle: input.subtitle ?? null,
        tagline: input.tagline ?? null,
        legalName: input.legalName ?? null,
        website: input.website ?? null,
        email: input.email ?? null,
        phoneE164: input.phone ?? null,
        letterhead: input.letterhead ?? null,
        version: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictError("Settings changed since you opened them. Reload and retry.", "STALE");
    await audit(ctx, tx, "settings.organization.update", "Organization", org.id);
  });
}

export async function listBranches(db: DbClient = prisma) {
  return db.branch.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
}

export async function saveBranch(ctx: AuthContext, input: z.output<typeof branchSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  const before = input.id ? await db.branch.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError("Branch not found.");
  const activating = input.status === "ACTIVE" && before?.status !== "ACTIVE";
  if (activating && input.verificationStatus !== "VERIFIED") {
    throw new ValidationError("A branch can only be made active after its details are verified.", {
      status: "Verify the branch first",
    });
  }
  const org = await getOrganization(db);
  const data = {
    code: input.code,
    name: input.name,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    phoneE164: input.phone ?? null,
    email: input.email ?? null,
    status: input.status,
    verificationStatus: input.verificationStatus,
    verificationNotes: input.verificationNotes ?? null,
  };
  return uniqueGuard(
    () =>
      withTx(db, async (tx) => {
        const b = input.id
          ? await tx.branch.update({ where: { id: input.id }, data: { ...data, version: { increment: 1 } } })
          : await tx.branch.create({ data: { ...data, organizationId: org.id } });
        await audit(ctx, tx, input.id ? "settings.branch.update" : "settings.branch.create", "Branch", b.id, {
          status: b.status,
          verificationStatus: b.verificationStatus,
        });
        return b;
      }),
    "A branch with that code already exists.",
  );
}

export async function listDepartments(branchId?: string, db: DbClient = prisma) {
  return db.department.findMany({
    where: branchId ? { branchId } : undefined,
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
    include: { branch: { select: { name: true } } },
  });
}

export async function saveDepartment(ctx: AuthContext, input: z.output<typeof departmentSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  const data = { branchId: input.branchId, code: input.code, name: input.name, kind: input.kind, active: input.active };
  return uniqueGuard(
    () =>
      withTx(db, async (tx) => {
        const d = input.id
          ? await tx.department.update({ where: { id: input.id }, data })
          : await tx.department.create({ data });
        await audit(ctx, tx, input.id ? "settings.department.update" : "settings.department.create", "Department", d.id);
        return d;
      }),
    "A department with that code already exists in this branch.",
  );
}

export async function listWardsWithBeds(branchId?: string, db: DbClient = prisma) {
  return db.ward.findMany({
    where: branchId ? { branchId } : undefined,
    orderBy: [{ name: "asc" }],
    include: { beds: { orderBy: { code: "asc" } }, branch: { select: { name: true } }, department: { select: { name: true } } },
  });
}

export async function saveWard(ctx: AuthContext, input: z.output<typeof wardSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  const data = {
    branchId: input.branchId,
    departmentId: input.departmentId ?? null,
    code: input.code,
    name: input.name,
    kind: input.kind,
    active: input.active,
  };
  return uniqueGuard(
    () =>
      withTx(db, async (tx) => {
        const w = input.id ? await tx.ward.update({ where: { id: input.id }, data }) : await tx.ward.create({ data });
        await audit(ctx, tx, input.id ? "settings.ward.update" : "settings.ward.create", "Ward", w.id);
        return w;
      }),
    "A ward with that code already exists in this branch.",
  );
}

export async function saveBed(ctx: AuthContext, input: z.output<typeof bedSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  return uniqueGuard(
    () =>
      withTx(db, async (tx) => {
        if (input.id) {
          const existing = await tx.bed.findUnique({ where: { id: input.id } });
          if (!existing) throw new NotFoundError("Bed not found.");
          if (existing.status === "OCCUPIED" || existing.status === "RESERVED") {
            if (input.status || !input.active) {
              throw new ConflictError("An occupied or reserved bed cannot be deactivated or have its status changed here.");
            }
          }
          const b = await tx.bed.update({
            where: { id: input.id },
            data: {
              code: input.code,
              label: input.label,
              category: input.category,
              active: input.active,
              ...(input.status ? { status: input.status } : {}),
              version: { increment: 1 },
            },
          });
          await audit(ctx, tx, "settings.bed.update", "Bed", b.id, { status: b.status, active: b.active });
          return b;
        }
        const b = await tx.bed.create({
          data: { wardId: input.wardId, code: input.code, label: input.label, category: input.category, active: input.active },
        });
        await audit(ctx, tx, "settings.bed.create", "Bed", b.id);
        return b;
      }),
    "A bed with that code already exists in this ward.",
  );
}

export async function listVisitTypes(opts: { activeOnly?: boolean } = {}, db: DbClient = prisma) {
  return db.visitType.findMany({
    where: opts.activeOnly ? { active: true } : undefined,
    orderBy: { name: "asc" },
    include: { department: { select: { name: true } } },
  });
}

export async function saveVisitType(ctx: AuthContext, input: z.output<typeof visitTypeSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  const data = {
    code: input.code,
    name: input.name,
    departmentId: input.departmentId ?? null,
    defaultDurationMin: input.defaultDurationMin,
    active: input.active,
  };
  return uniqueGuard(
    () =>
      withTx(db, async (tx) => {
        const v = input.id ? await tx.visitType.update({ where: { id: input.id }, data }) : await tx.visitType.create({ data });
        await audit(ctx, tx, input.id ? "settings.visit_type.update" : "settings.visit_type.create", "VisitType", v.id);
        return v;
      }),
    "A visit type with that code already exists.",
  );
}

export async function listSetupFacts(db: DbClient = prisma) {
  return db.setupFact.findMany({
    orderBy: [{ category: "asc" }, { label: "asc" }],
    include: { verifiedBy: { select: { displayName: true } } },
  });
}

export async function decideSetupFact(ctx: AuthContext, input: z.output<typeof setupFactDecisionSchema>, db: DbClient = prisma) {
  requirePermission(ctx, "setup.verify");
  const fact = await db.setupFact.findUnique({ where: { id: input.id } });
  if (!fact) throw new NotFoundError();
  await withTx(db, async (tx) => {
    await tx.setupFact.update({
      where: { id: fact.id },
      data: {
        status: input.status,
        value: input.value,
        notes: input.notes ?? null,
        verifiedById: input.status === "VERIFIED" || input.status === "REJECTED" ? ctx.userId : null,
        verifiedAt: input.status === "VERIFIED" || input.status === "REJECTED" ? new Date() : null,
      },
    });
    await audit(ctx, tx, "setup.fact.decide", "SetupFact", fact.id, {
      key: fact.key,
      from: fact.status,
      to: input.status,
      valueChanged: fact.value !== input.value,
    });
  });
}

export async function updateSystemSetting(ctx: AuthContext, key: string, rawValue: unknown, db: DbClient = prisma) {
  requirePermission(ctx, "settings.manage");
  if (!(key in SETTING_DEFS)) throw new ValidationError("Unknown setting.");
  const def = SETTING_DEFS[key as SettingKey];
  const coerced = typeof def.default === "number" && typeof rawValue === "string" ? Number(rawValue) : rawValue;
  const parsed = def.schema.safeParse(coerced);
  if (!parsed.success) throw new ValidationError(`Invalid value for ${def.label}.`);
  await withTx(db, async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key } });
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as Prisma.InputJsonValue, updatedById: ctx.userId },
      update: { value: parsed.data as Prisma.InputJsonValue, updatedById: ctx.userId },
    });
    await audit(ctx, tx, "settings.system.update", "SystemSetting", key, {
      from: (before?.value as Prisma.JsonValue) ?? null,
      to: parsed.data as Prisma.JsonValue,
    });
  });
}
