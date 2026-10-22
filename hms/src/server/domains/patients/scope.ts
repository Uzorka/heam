import type { Prisma } from "@prisma/client";
import { branchesWith, type AuthContext } from "../../authz/context";
import type { PermissionCode } from "../../authz/permissions";

/**
 * Record-level branch scope for patients. A patient is visible in a branch if they were registered
 * there or have an appointment/encounter there. Users with an all-branches grant see everyone.
 * Returns null if the user has no grant at all for the permission.
 */
export function patientScopeWhere(
  ctx: AuthContext,
  permission: PermissionCode,
): Prisma.PatientWhereInput | null {
  const scope = branchesWith(ctx, permission);
  if (scope === "ALL") return {};
  if (scope.length === 0) return null;
  return {
    OR: [
      { registeredBranchId: { in: scope } },
      { encounters: { some: { branchId: { in: scope } } } },
      { appointments: { some: { branchId: { in: scope } } } },
    ],
  };
}
