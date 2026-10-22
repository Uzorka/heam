import "server-only";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { canAny, type AuthContext } from "@/server/authz/context";
import type { PermissionCode } from "@/server/authz/permissions";
import { ForbiddenError, NotFoundError } from "@/server/errors";

export type Loaded<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "forbidden" | "notfound"; message?: string };

/** Run a page loader, converting authorisation and not-found errors into renderable states. */
export async function load<T>(ctx: AuthContext, page: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      await recordAudit(prisma, {
        actorType: "USER",
        actorUserId: ctx.userId,
        action: "denied.page",
        resourceType: "Page",
        resourceId: page,
        outcome: "DENIED",
        details: { permission: e.permission ?? null },
        meta: ctx.meta,
      });
      return { ok: false, kind: "forbidden", message: e.message };
    }
    if (e instanceof NotFoundError) return { ok: false, kind: "notfound", message: e.message };
    throw e;
  }
}

/** Check a page-level permission and record a denial for direct URL access. */
export async function allowed(ctx: AuthContext, page: string, any: PermissionCode[]): Promise<boolean> {
  if (canAny(ctx, any)) return true;
  await recordAudit(prisma, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "denied.page",
    resourceType: "Page",
    resourceId: page,
    outcome: "DENIED",
    details: { needsAnyOf: any },
    meta: ctx.meta,
  });
  return false;
}
