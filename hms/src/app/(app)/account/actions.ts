"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { env } from "@/server/env";
import { beginMfaEnrollment, changePassword, confirmMfaEnrollment, disableMfa, revokeMySession } from "@/server/domains/security/account";
import { changePasswordSchema, totpCodeSchema } from "@/lib/schemas/staff";
import { uuid } from "@/lib/schemas/common";

export const changePasswordAction = defineAction("account.password", changePasswordSchema, changePassword);
export const beginMfaAction = defineAction("account.mfa.begin", z.object({}), async (ctx) => beginMfaEnrollment(ctx));
export const confirmMfaAction = defineAction("account.mfa.confirm", totpCodeSchema, async (ctx, i) => confirmMfaEnrollment(ctx, i.code));
export const disableMfaAction = defineAction(
  "account.mfa.disable",
  z.object({ password: z.string().min(1, "Enter your password"), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }),
  async (ctx, i) => disableMfa(ctx, i, env().MFA_ENFORCE === "true"),
);
export const revokeMySessionAction = defineAction("account.session.revoke", z.object({ sessionId: uuid }), async (ctx, i) => revokeMySession(ctx, i.sessionId));
