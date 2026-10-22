"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db";
import { authenticate, LOGIN_FAILURE_MESSAGE } from "@/server/auth/login";
import { clearSessionCookie, getCurrentSession, startSession } from "@/server/auth/session";
import { revokeSession } from "@/server/auth/session-store";
import { consumeResetToken, issueResetToken } from "@/server/auth/reset";
import { verifyLoginMfa } from "@/server/domains/security/account";
import { recordAudit } from "@/server/audit";
import { getRequestMeta } from "@/server/request-context";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { DomainError } from "@/server/errors";

export interface FormState {
  error?: string;
  message?: string;
}

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const loginSchema = z.object({
  email: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const meta = await getRequestMeta();
  const result = await authenticate(prisma, parsed.data, meta);
  if (result.status === "RATE_LIMITED")
    return { error: "Too many attempts from this network. Wait 15 minutes and try again." };
  if (result.status === "LOCKED") {
    return {
      error:
        "This account is temporarily locked after repeated failed sign-ins. Try again later or contact your administrator.",
    };
  }
  if (result.status !== "OK") return { error: LOGIN_FAILURE_MESSAGE };

  const session = await startSession(result.userId, {
    mfaVerified: !result.mfaRequired,
    activeBranchId: result.defaultBranchId,
  });
  if (result.mfaRequired) redirect(`/login/mfa?next=${encodeURIComponent(safeNext(form.get("next")))}`);
  await recordAudit(prisma, {
    actorType: "USER",
    actorUserId: result.userId,
    action: "auth.login",
    resourceType: "Session",
    resourceId: session.sessionId,
    details: { mfa: false },
    meta,
  });
  redirect(result.mustChangePassword ? "/account/security?required=password" : safeNext(form.get("next")));
}

export async function mfaAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };
  const meta = await getRequestMeta();
  const r = await verifyLoginMfa(session.id, session.userId, code, meta);
  if (!r.ok) {
    if (r.locked) {
      await clearSessionCookie();
      redirect("/login?reason=mfa_locked");
    }
    return { error: "That code is not valid. Codes change every 30 seconds." };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { mustChangePassword: true },
  });
  redirect(user?.mustChangePassword ? "/account/security?required=password" : safeNext(form.get("next")));
}

export async function logoutAction() {
  const session = await getCurrentSession();
  if (session) {
    await revokeSession(prisma, session.id, "LOGOUT");
    await recordAudit(prisma, {
      actorType: "USER",
      actorUserId: session.userId,
      action: "auth.logout",
      resourceType: "Session",
      resourceId: session.id,
      meta: await getRequestMeta(),
    });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const generic = {
    message:
      "If an active account exists for that email, a reset link will be sent. Email delivery is not configured in this installation yet - ask your administrator to issue a reset link from Staff & Access.",
  };
  if (!email) return { error: "Enter your email address." };
  const meta = await getRequestMeta();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === "ACTIVE") {
    const { token } = await issueResetToken(prisma, user.id, null, meta);
    const e = env();
    if (e.EMAIL_PROVIDER === "disabled") {
      await prisma.notification.create({
        data: {
          channel: "EMAIL",
          template: "auth.password_reset",
          recipient: user.id,
          userId: user.id,
          payload: {},
          status: "SKIPPED_NO_PROVIDER",
          lastError: "No email provider configured",
        },
      });
      if (e.NODE_ENV === "development") {
        // Development convenience only: never logged outside development.
        logger.warn("dev_password_reset_link", { url: `${e.APP_URL}/reset-password?t=${token}` });
      }
    }
  }
  return generic;
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "Passwords do not match." };
  try {
    await consumeResetToken(prisma, token, password, await getRequestMeta());
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/login?reason=password_set");
}
