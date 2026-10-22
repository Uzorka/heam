"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  addIdentifier,
  completeRegistration,
  registerPatient,
  revealIdentifier,
  setPatientStatus,
  updatePatient,
} from "@/server/domains/patients/service";
import {
  addContact,
  addGuardian,
  changeAllergyStatus,
  deactivateContact,
  recordAllergy,
  recordConsent,
  revokeGuardian,
  setNoKnownAllergies,
  verifyGuardian,
} from "@/server/domains/patients/records";
import { approveMerge, dismissDuplicate, requestMerge } from "@/server/domains/patients/merge";
import {
  IDENTIFIER_TYPES,
  allergySchema,
  consentSchema,
  contactSchema,
  guardianSchema,
  registerPatientSchema,
  statusSchema,
  updatePatientSchema,
} from "@/lib/schemas/patient";
import { requiredText, uuid } from "@/lib/schemas/common";

export const registerPatientAction = defineAction("patient.register", registerPatientSchema, registerPatient);
export const updatePatientAction = defineAction("patient.update", updatePatientSchema, updatePatient);
export const completeRegistrationAction = defineAction(
  "patient.complete",
  z.object({ patientId: uuid }),
  async (ctx, i) => completeRegistration(ctx, i.patientId),
);
export const setPatientStatusAction = defineAction("patient.status", statusSchema, setPatientStatus);
export const addIdentifierAction = defineAction(
  "patient.identifier.add",
  z.object({
    patientId: uuid,
    type: z.enum(IDENTIFIER_TYPES),
    value: requiredText("Number", 40),
    issuer: z.string().max(80).optional(),
  }),
  addIdentifier,
);
export const revealIdentifierAction = defineAction(
  "patient.identifier.reveal",
  z.object({ identifierId: uuid }),
  async (ctx, i) => revealIdentifier(ctx, i.identifierId),
);
export const recordAllergyAction = defineAction("patient.allergy.record", allergySchema, recordAllergy);
export const noKnownAllergiesAction = defineAction(
  "patient.allergy.nka",
  z.object({ patientId: uuid }),
  async (ctx, i) => setNoKnownAllergies(ctx, i.patientId),
);
export const changeAllergyStatusAction = defineAction(
  "patient.allergy.status",
  z.object({
    allergyId: uuid,
    action: z.enum(["VERIFY", "INACTIVATE", "ENTERED_IN_ERROR"]),
    reason: z.string().max(300).optional(),
  }),
  changeAllergyStatus,
);
export const recordConsentAction = defineAction("patient.consent", consentSchema, recordConsent);
export const addContactAction = defineAction("patient.contact.add", contactSchema, addContact);
export const deactivateContactAction = defineAction(
  "patient.contact.remove",
  z.object({ contactId: uuid }),
  async (ctx, i) => deactivateContact(ctx, i.contactId),
);
export const addGuardianAction = defineAction("patient.guardian.add", guardianSchema, addGuardian);
export const verifyGuardianAction = defineAction(
  "patient.guardian.verify",
  z.object({ relationshipId: uuid, evidence: requiredText("Evidence", 300) }),
  verifyGuardian,
);
export const revokeGuardianAction = defineAction(
  "patient.guardian.revoke",
  z.object({ relationshipId: uuid, reason: requiredText("Reason", 300) }),
  revokeGuardian,
);
export const requestMergeAction = defineAction(
  "patient.merge.request",
  z.object({ reviewId: uuid, survivorId: uuid, notes: requiredText("Notes", 500) }),
  requestMerge,
);
export const approveMergeAction = defineAction(
  "patient.merge.approve",
  z.object({ reviewId: uuid }),
  async (ctx, i) => approveMerge(ctx, i.reviewId),
);
export const dismissDuplicateAction = defineAction(
  "patient.duplicate.dismiss",
  z.object({ reviewId: uuid, notes: requiredText("Notes", 500) }),
  async (ctx, i) => dismissDuplicate(ctx, i.reviewId, i.notes),
);
