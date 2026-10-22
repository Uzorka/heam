import type { DbClient } from "../db";
import { ForbiddenError, ValidationError } from "../errors";
import { can, loadAuthContext, type AuthContext } from "../authz/context";
import type { PermissionCode } from "../authz/permissions";
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

/**
 * A second member of staff co-signs (e.g. controlled-drug administration) by entering their own
 * credentials on the same screen. They must be active, different from the signer and hold the
 * named permission in the branch. Failures count towards the same signing lockout.
 */
export async function confirmWitness(
  db: DbClient,
  ctx: AuthContext,
  email: string,
  password: string,
  permission: PermissionCode,
  branchId: string,
): Promise<string> {
  const witness = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!witness || witness.status !== "ACTIVE")
    throw new ValidationError("Witness not recognised.", { witnessEmail: "Unknown or inactive account" });
  if (witness.id === ctx.userId)
    throw new ValidationError("The witness must be a different person.", {
      witnessEmail: "Must be someone else",
    });
  const identifier = `sign:${witness.id}`;
  const failures = await db.loginAttempt.count({
    where: { identifier, success: false, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
  });
  if (failures >= MAX_FAILURES) throw new ForbiddenError("The witness's signing is temporarily blocked.");
  const ok = await verifyPassword(witness.passwordHash, password);
  await db.loginAttempt.create({
    data: { identifier, ip: ctx.meta.ip, success: ok, reason: ok ? null : "BAD_WITNESS_PASSWORD" },
  });
  if (!ok)
    throw new ValidationError("Witness password incorrect.", { witnessPassword: "Incorrect password" });
  const wctx = await loadAuthContext(db, witness.id, { activeBranchId: branchId, enforceMfa: false });
  if (!can(wctx, permission, { branchId }))
    throw new ForbiddenError("The witness is not authorised for this.", permission);
  return witness.id;
}
