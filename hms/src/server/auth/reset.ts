import type { DbClient } from "../db";
import { withTx } from "../db";
import { randomToken, sha256 } from "../crypto";
import { recordAudit } from "../audit";
import type { RequestMeta } from "../request-meta";
import { ValidationError } from "../errors";
import { hashPassword, passwordProblems } from "./password";
import { revokeAllSessions } from "./session-store";

export const RESET_TOKEN_MINUTES = 30;

/** Create a single-use reset token. Returns the raw token (only ever shown/sent once). */
export async function issueResetToken(
  db: DbClient,
  userId: string,
  createdById: string | null,
  meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000);
  await withTx(db, async (tx) => {
    // Invalidate older outstanding tokens.
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt, createdById } });
    await recordAudit(tx, {
      actorType: createdById ? "USER" : "SYSTEM",
      actorUserId: createdById,
      action: "auth.reset_token_issued",
      resourceType: "User",
      resourceId: userId,
      meta,
    });
  });
  return { token, expiresAt };
}

export async function consumeResetToken(
  db: DbClient,
  token: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<{ userId: string }> {
  return withTx(db, async (tx) => {
    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw new ValidationError("This reset link is invalid or has expired. Please request a new one.");
    }
    const problems = passwordProblems(newPassword, { email: row.user.email });
    if (problems.length) throw new ValidationError(problems.join(" "), { password: problems.join(" ") });
    // Mark used first; the conditional update guarantees single use under concurrency.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ValidationError("This reset link has already been used.");
    await tx.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        version: { increment: 1 },
      },
    });
    await revokeAllSessions(tx, row.userId, "PASSWORD_RESET");
    await recordAudit(tx, {
      actorType: "USER",
      actorUserId: row.userId,
      action: "auth.password_reset",
      resourceType: "User",
      resourceId: row.userId,
      meta,
    });
    return { userId: row.userId };
  });
}
