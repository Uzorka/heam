import type { DbClient } from "../db";
import { ForbiddenError, ValidationError } from "../errors";
import type { AuthContext } from "../authz/context";
import { verifyPassword } from "./password";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

/**
 * Re-authenticate before an electronic signature (notes, result verification, reports). The signer
 * must be the signed-in user and re-enter their password. Repeated failures block signing for 15 min.
 */
export async function confirmSignature(db: DbClient, ctx: AuthContext, password: string): Promise<void> {
  const identifier = `sign:${ctx.userId}`;
  const failures = await db.loginAttempt.count({
    where: { identifier, success: false, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
  });
  if (failures >= MAX_FAILURES)
    throw new ForbiddenError("Signing is temporarily blocked after repeated incorrect passwords.");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { passwordHash: true } });
  const ok = await verifyPassword(user.passwordHash, password);
  await db.loginAttempt.create({
    data: { identifier, ip: ctx.meta.ip, success: ok, reason: ok ? null : "BAD_SIGNATURE_PASSWORD" },
  });
  if (!ok) throw new ValidationError("Password incorrect - not signed.", { password: "Incorrect password" });
}
