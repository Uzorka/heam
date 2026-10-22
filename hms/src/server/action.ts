import "server-only";
import { z } from "zod";
import { getActionContext } from "./auth/session";
import type { AuthContext } from "./authz/context";
import { DomainError, ForbiddenError, ValidationError } from "./errors";
import { recordAudit } from "./audit";
import { prisma } from "./db";
import { logger, reportError } from "./logger";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Wrap a server action: authenticate, validate input with zod, run the handler and map errors to a
 * safe result. Authorisation is enforced inside services (never only here), so the same rules apply
 * from every entry point.
 */
export function defineAction<S extends z.ZodTypeAny, T>(
  name: string,
  schema: S,
  handler: (ctx: AuthContext, input: z.output<S>) => Promise<T>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    let ctx: AuthContext | undefined;
    try {
      ctx = await getActionContext();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: "VALIDATION",
          error: "Please correct the highlighted fields.",
          fieldErrors: zodFieldErrors(parsed.error),
        };
      }
      const data = await handler(ctx, parsed.data);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof ForbiddenError && ctx) {
        await recordAudit(prisma, {
          actorType: "USER",
          actorUserId: ctx.userId,
          action: `denied.${name}`,
          resourceType: "Action",
          resourceId: name,
          outcome: "DENIED",
          details: { permission: e.permission ?? null },
          meta: ctx.meta,
        }).catch((err) => logger.error("audit_write_failed", { err }));
      }
      if (e instanceof ValidationError) {
        return { ok: false, code: e.code, error: e.message, fieldErrors: e.fieldErrors };
      }
      if (e instanceof DomainError) return { ok: false, code: e.code, error: e.message };
      reportError(e, { action: name, requestId: ctx?.meta.requestId });
      return {
        ok: false,
        code: "INTERNAL",
        error: `Something went wrong and the action did not complete. Reference: ${ctx?.meta.requestId ?? "n/a"}`,
      };
    }
  };
}
