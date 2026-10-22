"use server";
import { getActionContext } from "@/server/auth/session";
import { uploadDocument, voidDocument } from "@/server/domains/documents/service";
import { storage } from "@/server/domains/documents/storage";
import { defineAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { reportError } from "@/server/logger";
import type { ActionResult } from "@/server/action";
import { z } from "zod";
import { requiredText, uuid } from "@/lib/schemas/common";

const KINDS = ["LAB_REPORT", "IMAGING", "REFERRAL", "CONSENT", "CLINICAL_OTHER"] as const;

/** File uploads arrive as FormData; validation and authorisation happen in the document service. */
export async function uploadDocumentAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  let requestId: string | null = null;
  try {
    const ctx = await getActionContext();
    requestId = ctx.meta.requestId;
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, code: "VALIDATION", error: "Choose a file to upload." };
    const kind = String(form.get("kind") ?? "");
    if (!(KINDS as readonly string[]).includes(kind))
      return { ok: false, code: "VALIDATION", error: "Choose a document type." };
    const orderId = String(form.get("orderId") ?? "") || undefined;
    const encounterId = String(form.get("encounterId") ?? "") || undefined;
    const doc = await uploadDocument(
      ctx,
      {
        bytes: Buffer.from(await file.arrayBuffer()),
        filename: file.name,
        title: String(form.get("title") ?? "").trim() || file.name,
        kind: kind as (typeof KINDS)[number],
        orderId,
        encounterId,
        source: form.get("source") === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
        sourceDescription: String(form.get("sourceDescription") ?? "").trim() || undefined,
      },
      storage(),
    );
    return { ok: true, data: { id: doc.id } };
  } catch (e) {
    if (e instanceof DomainError)
      return { ok: false, code: e.code, error: e.message, fieldErrors: e.fieldErrors };
    reportError(e, { action: "document.upload", requestId });
    return { ok: false, code: "INTERNAL", error: `Upload failed. Reference: ${requestId ?? "n/a"}` };
  }
}

export const voidDocumentAction = defineAction(
  "document.void",
  z.object({ documentId: uuid, reason: requiredText("Reason", 300) }),
  voidDocument,
);
