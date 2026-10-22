import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { env } from "../env";
import { getRequestMeta } from "../request-context";
import { loadAuthContext, type AuthContext } from "../authz/context";
import { UnauthenticatedError } from "../errors";
import { createSession, validateSessionToken, type SessionConfig, type ValidSession } from "./session-store";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-hms_session" : "hms_session";

export function sessionConfig(): SessionConfig {
  const e = env();
  return { idleMinutes: e.SESSION_IDLE_MINUTES, absoluteHours: e.SESSION_ABSOLUTE_HOURS };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function startSession(userId: string, opts: { mfaVerified: boolean; activeBranchId: string | null }) {
  const meta = await getRequestMeta();
  const s = await createSession(prisma, userId, sessionConfig(), meta, opts);
  await setSessionCookie(s.token, s.expiresAt);
  return s;
}

/** The current valid session, or null. Cached per request. */
export const getCurrentSession = cache(async (): Promise<ValidSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(prisma, token, sessionConfig());
});

export type SessionState =
  | { state: "anonymous" }
  | { state: "mfa_pending"; session: ValidSession }
  | { state: "authenticated"; session: ValidSession; ctx: AuthContext };

/** Resolve the request's auth state. Cached per request so every component sees one consistent view. */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const session = await getCurrentSession();
  if (!session) return { state: "anonymous" };
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { mfaEnabled: true } });
  if (!user) return { state: "anonymous" };
  if (user.mfaEnabled && !session.mfaVerified) return { state: "mfa_pending", session };
  try {
    const ctx = await loadAuthContext(prisma, session.userId, {
      sessionId: session.id,
      activeBranchId: session.activeBranchId,
      mfaVerified: session.mfaVerified,
      enforceMfa: env().MFA_ENFORCE === "true",
      meta: await getRequestMeta(),
    });
    return { state: "authenticated", session, ctx };
  } catch (e) {
    if (e instanceof UnauthenticatedError) return { state: "anonymous" };
    throw e;
  }
});

/** For pages/layouts: redirect to login when not authenticated. */
export async function requireAuthContext(): Promise<AuthContext> {
  const s = await getSessionState();
  if (s.state === "anonymous") redirect("/login");
  if (s.state === "mfa_pending") redirect("/login/mfa");
  return s.ctx;
}

/** For server actions: throw instead of redirecting. */
export async function getActionContext(): Promise<AuthContext> {
  const s = await getSessionState();
  if (s.state !== "authenticated") throw new UnauthenticatedError();
  return s.ctx;
}
