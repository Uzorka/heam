import { z } from "zod";
import { requiredText, uuid } from "./common";

export const createPortalAccountSchema = z.object({
  patientId: uuid,
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
});

export const revokePortalAccountSchema = z.object({ patientId: uuid, reason: requiredText("Reason", 300) });

export const resultReleaseSchema = z.object({ orderId: uuid, release: z.boolean() });

export const documentReleaseSchema = z.object({ documentId: uuid, release: z.boolean() });
