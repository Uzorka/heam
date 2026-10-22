import type { UserKind } from "@prisma/client";
import type { DbClient } from "../db";
import { ForbiddenError, UnauthenticatedError } from "../errors";
import { SYSTEM_META, type RequestMeta } from "../request-meta";
import type { PermissionCode } from "./permissions";

export interface Grant {
  userRoleId: string;
  roleCode: string;
  roleName: string;
  /** null = all branches */
  branchId: string | null;
  departmentId: string | null;
  isDelegation: boolean;
  effectiveTo: Date | null;
  permissions: ReadonlySet<string>;
}

export interface AuthContext {
  userId: string;
  sessionId: string | null;
  kind: UserKind;
  displayName: string;
  email: string;
  jobTitle: string | null;
  activeBranchId: string | null;
  mfaEnabled: boolean;
  grants: Grant[];
  /** Grants withheld until the user enrols in MFA (privileged roles under MFA enforcement). */
  suspendedGrants: Grant[];
  meta: RequestMeta;
}

export interface LoadContextOptions {
  sessionId?: string | null;
  activeBranchId?: string | null;
  mfaVerified?: boolean;
  enforceMfa?: boolean;
  meta?: RequestMeta;
  now?: Date;
}

/**
 * Build the effective permissions for a user from the database. Called on every request so that a
 * revoked role, expired delegation or suspended account loses access immediately.
 */
export async function loadAuthContext(db: DbClient, userId: string, opts: LoadContextOptions = {}): Promise<AuthContext> {
  const now = opts.now ?? new Date();
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        where: {
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          role: { active: true },
        },
        include: { role: { include: { permissions: { select: { permissionCode: true } } } } },
      },
    },
  });
  if (!user || user.status !== "ACTIVE") throw new UnauthenticatedError("Your account is not active.");

  const grants: Grant[] = [];
  const suspendedGrants: Grant[] = [];
  const mfaSatisfied = user.mfaEnabled && (opts.mfaVerified ?? true);
  for (const ur of user.roles) {
    // Portal roles never apply to staff accounts and vice versa.
    if (ur.role.kind !== user.kind) continue;
    const grant: Grant = {
      userRoleId: ur.id,
      roleCode: ur.role.code,
      roleName: ur.role.name,
      branchId: ur.allBranches ? null : ur.branchId,
      departmentId: ur.departmentId,
      isDelegation: ur.isDelegation,
      effectiveTo: ur.effectiveTo,
      permissions: new Set(ur.role.permissions.map((p) => p.permissionCode)),
    };
    // A grant scoped to neither a branch nor all branches is misconfigured: ignore it (fail closed).
    if (!ur.allBranches && !ur.branchId) continue;
    if (opts.enforceMfa && ur.role.requiresMfa && !mfaSatisfied) suspendedGrants.push(grant);
    else grants.push(grant);
  }

  return {
    userId: user.id,
    sessionId: opts.sessionId ?? null,
    kind: user.kind,
    displayName: user.displayName,
    email: user.email,
    jobTitle: user.jobTitle,
    activeBranchId: opts.activeBranchId ?? user.defaultBranchId,
    mfaEnabled: user.mfaEnabled,
    grants,
    suspendedGrants,
    meta: opts.meta ?? SYSTEM_META,
  };
}

export interface Scope {
  branchId?: string | null;
}

/** Does the user hold `permission`, optionally within a specific branch? */
export function can(ctx: AuthContext, permission: PermissionCode, scope: Scope = {}): boolean {
  return ctx.grants.some(
    (g) =>
      g.permissions.has(permission) &&
      (scope.branchId === undefined || g.branchId === null || g.branchId === scope.branchId),
  );
}

export function canAny(ctx: AuthContext, permissions: PermissionCode[], scope: Scope = {}): boolean {
  return permissions.some((p) => can(ctx, p, scope));
}

export function requirePermission(ctx: AuthContext, permission: PermissionCode, scope: Scope = {}): void {
  if (!can(ctx, permission, scope)) throw new ForbiddenError(undefined, permission);
}

/** Branches in which the user holds `permission`: "ALL" or a list of branch ids (possibly empty). */
export function branchesWith(ctx: AuthContext, permission: PermissionCode): "ALL" | string[] {
  const ids = new Set<string>();
  for (const g of ctx.grants) {
    if (!g.permissions.has(permission)) continue;
    if (g.branchId === null) return "ALL";
    ids.add(g.branchId);
  }
  return [...ids];
}

/** Resolve the branch to act in: the active branch, if the user holds `permission` there. */
export function requireActingBranch(ctx: AuthContext, permission: PermissionCode, branchId?: string | null): string {
  const target = branchId ?? ctx.activeBranchId;
  if (!target) throw new ForbiddenError("Select a branch before performing this action.");
  requirePermission(ctx, permission, { branchId: target });
  return target;
}

export function effectivePermissions(ctx: AuthContext): Set<string> {
  const all = new Set<string>();
  for (const g of ctx.grants) for (const p of g.permissions) all.add(p);
  return all;
}
