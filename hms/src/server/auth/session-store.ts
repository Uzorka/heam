import type { DbClient } from "../db";
import { randomToken, sha256 } from "../crypto";
import type { RequestMeta } from "../request-meta";

export interface SessionConfig {
  idleMinutes: number;
  absoluteHours: number;
}

export interface ValidSession {
  id: string;
  userId: string;
  mfaVerified: boolean;
  activeBranchId: string | null;
  expiresAt: Date;
}

export async function createSession(
  db: DbClient,
  userId: string,
  cfg: SessionConfig,
  meta: RequestMeta,
  opts: { mfaVerified: boolean; activeBranchId: string | null },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + cfg.absoluteHours * 3_600_000);
  const session = await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      mfaVerified: opts.mfaVerified,
      activeBranchId: opts.activeBranchId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  return { token, sessionId: session.id, expiresAt };
}

/**
 * Validate a raw session token. Enforces absolute expiry, idle timeout, revocation and account status.
 * Touches lastSeenAt at most once a minute to limit writes.
 */
export async function validateSessionToken(
  db: DbClient,
  token: string,
  cfg: SessionConfig,
  now: Date = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { status: true } } },
  });
  if (!session || session.revokedAt) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (session.expiresAt <= now) return null;
  const idleDeadline = new Date(session.lastSeenAt.getTime() + cfg.idleMinutes * 60_000);
  if (idleDeadline <= now) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: now, revokedReason: "IDLE_TIMEOUT" } });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return {
    id: session.id,
    userId: session.userId,
    mfaVerified: session.mfaVerified,
    activeBranchId: session.activeBranchId,
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(db: DbClient, sessionId: string, reason: string): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllSessions(
  db: DbClient,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const r = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}
