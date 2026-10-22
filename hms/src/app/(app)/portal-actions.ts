"use server";
import { defineAction } from "@/server/action";
import { env } from "@/server/env";
import {
  createPortalAccount,
  revokePortalAccount,
  setDocumentRelease,
  setResultRelease,
} from "@/server/domains/portal/service";
import {
  createPortalAccountSchema,
  documentReleaseSchema,
  resultReleaseSchema,
  revokePortalAccountSchema,
} from "@/lib/schemas/portal";

export const createPortalAccountAction = defineAction(
  "portal.account.create",
  createPortalAccountSchema,
  async (ctx, i) => {
    const r = await createPortalAccount(ctx, i);
    return {
      setupLink: `${env().APP_URL}/reset-password?t=${r.setupToken}`,
      expiresAt: r.expiresAt.toISOString(),
    };
  },
);
export const revokePortalAccountAction = defineAction(
  "portal.account.revoke",
  revokePortalAccountSchema,
  revokePortalAccount,
);
export const setResultReleaseAction = defineAction(
  "portal.result.release",
  resultReleaseSchema,
  setResultRelease,
);
export const setDocumentReleaseAction = defineAction(
  "portal.document.release",
  documentReleaseSchema,
  setDocumentRelease,
);
