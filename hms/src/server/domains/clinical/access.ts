import type { CareTeamRole, Encounter } from "@prisma/client";
import { prisma, type DbClient, type Tx } from "../../db";
import { recordAudit } from "../../audit";
import { can, type AuthContext } from "../../authz/context";
import type { PermissionCode } from "../../authz/permissions";
import { getClinicalAccess, type ClinicalAccessBasis } from "../../authz/clinical-access";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";

export type EncounterAccessLevel = "FULL" | "CURRENT_VISIT";

export interface EncounterAccess {
  level: EncounterAccessLevel;
  basis: ClinicalAccessBasis | "OPEN_VISIT_IN_BRANCH";
}

/**
 * Access to one encounter:
 *  - FULL: the user has record-level clinical access to the patient (care team, branch-wide, break-glass).
 *  - CURRENT_VISIT: the encounter is OPEN in a branch where the user holds clinical.read - enough to
 *    see and document *this* visit (the nurse on duty, the doctor picking the patient up), not history.
 */
export async function getEncounterAccess(
  ctx: AuthContext,
  enc: Pick<Encounter, "patientId" | "branchId" | "status">,
  db: DbClient = prisma,
): Promise<EncounterAccess | null> {
  const access = await getClinicalAccess(ctx, enc.patientId, db);
  if (access.allowed && access.basis) return { level: "FULL", basis: access.basis };
  if (enc.status === "OPEN" && can(ctx, "clinical.read", { branchId: enc.branchId })) {
    return { level: "CURRENT_VISIT", basis: "OPEN_VISIT_IN_BRANCH" };
  }
  return null;
}

export async function loadEncounterFor(
  ctx: AuthContext,
  encounterId: string,
  permission: PermissionCode,
  opts: { requireOpen?: boolean } = {},
  db: DbClient = prisma,
) {
  const enc = await db.encounter.findUnique({ where: { id: encounterId } });
  if (!enc) throw new NotFoundError("Visit not found.");
  if (!can(ctx, permission, { branchId: enc.branchId })) throw new ForbiddenError(undefined, permission);
  const access = await getEncounterAccess(ctx, enc, db);
  if (!access) {
    throw new ForbiddenError(
      "You have no care relationship with this patient. Use emergency access only if clinically necessary.",
      "clinical.read",
    );
  }
  if (opts.requireOpen && enc.status !== "OPEN") throw new ConflictError("This visit is closed.");
  return { enc, access };
}

/** Record-level access to the patient's full clinical history, audited as a chart view. */
export async function requireChartAccess(
  ctx: AuthContext,
  patientId: string,
  purpose: string,
  db: DbClient = prisma,
) {
  const access = await getClinicalAccess(ctx, patientId, db);
  if (!access.allowed) {
    await recordAudit(db, {
      actorType: "USER",
      actorUserId: ctx.userId,
      action: "denied.clinical.chart",
      resourceType: "Patient",
      resourceId: patientId,
      patientId,
      outcome: "DENIED",
      details: { purpose },
      meta: ctx.meta,
    });
    throw new ForbiddenError("Clinical record restricted: no care relationship.", "clinical.read");
  }
  await recordAudit(db, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "clinical.chart.view",
    resourceType: "Patient",
    resourceId: patientId,
    patientId,
    details: { purpose, basis: access.basis },
    meta: ctx.meta,
  });
  return access;
}

/** Documenting care on a visit puts the author on its care team (if not already). */
export async function joinCareTeam(
  tx: Tx,
  enc: Pick<Encounter, "id" | "patientId">,
  userId: string,
  role: CareTeamRole,
) {
  const existing = await tx.careTeamAssignment.findFirst({
    where: { encounterId: enc.id, userId, endedAt: null },
  });
  if (!existing) {
    await tx.careTeamAssignment.create({
      data: { encounterId: enc.id, patientId: enc.patientId, userId, role, assignedById: userId },
    });
  }
}

export function careRoleFor(ctx: AuthContext): CareTeamRole {
  if (can(ctx, "clinical.prescribe")) return "CONSULTING";
  if (can(ctx, "maternity.write")) return "MIDWIFE";
  return "NURSE";
}
