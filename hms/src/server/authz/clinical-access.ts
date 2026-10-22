import type { DbClient } from "../db";
import { prisma } from "../db";
import { can, type AuthContext } from "./context";
import { activeBreakGlass } from "../domains/security/breakglass";
import { getSetting } from "../domains/settings/system-settings";

export type ClinicalAccessBasis = "CARE_TEAM" | "BRANCH_WIDE" | "BREAK_GLASS";

export interface ClinicalAccess {
  allowed: boolean;
  basis: ClinicalAccessBasis | null;
  breakGlassExpiresAt?: Date;
}

/**
 * Record-level clinical access. Requires `clinical.read` in a branch where the patient has an
 * encounter, plus one of:
 *  - a care-team assignment (current, or ended within the configured window),
 *  - `clinical.read.branch_wide` (e.g. medical director), or
 *  - an active, logged break-glass grant.
 * Holding a role in the hospital is never enough on its own.
 */
export async function getClinicalAccess(ctx: AuthContext, patientId: string, db: DbClient = prisma): Promise<ClinicalAccess> {
  if (!can(ctx, "clinical.read")) return { allowed: false, basis: null };
  const encounterBranches = await db.encounter.findMany({
    where: { patientId },
    distinct: ["branchId"],
    select: { branchId: true },
  });
  const inScope = encounterBranches.some((e) => can(ctx, "clinical.read", { branchId: e.branchId }));

  if (inScope && encounterBranches.some((e) => can(ctx, "clinical.read.branch_wide", { branchId: e.branchId }))) {
    return { allowed: true, basis: "BRANCH_WIDE" };
  }
  if (inScope) {
    const days = await getSetting(db, "clinical.careRelationshipDays");
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rel = await db.careTeamAssignment.findFirst({
      where: {
        patientId,
        userId: ctx.userId,
        OR: [
          // current member of the team on an open visit
          { endedAt: null, encounter: { status: "OPEN" } },
          // visit closed recently: keep access for follow-up within the window
          { endedAt: null, encounter: { completedAt: { gt: cutoff } } },
          // removed from the team recently
          { endedAt: { gt: cutoff } },
        ],
      },
      select: { id: true },
    });
    if (rel) return { allowed: true, basis: "CARE_TEAM" };
  }
  const bg = await activeBreakGlass(db, ctx.userId, patientId);
  if (bg && can(ctx, "clinical.breakglass")) return { allowed: true, basis: "BREAK_GLASS", breakGlassExpiresAt: bg.expiresAt };
  return { allowed: false, basis: null };
}
