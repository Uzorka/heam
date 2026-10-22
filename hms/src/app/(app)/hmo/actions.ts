"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  decideTariff,
  proposeTariff,
  savePayer,
  savePlan,
  setPayerStatus,
  setPlanStatus,
} from "@/server/domains/hmo/payers";
import {
  endCoverage,
  enrolCoverage,
  recordManualEligibility,
  runConnectorEligibility,
  setEncounterPayer,
} from "@/server/domains/hmo/coverage";
import { createPreauth, transitionPreauth } from "@/server/domains/hmo/preauth";
import {
  createBatch,
  createClaimForEncounter,
  importRemittance,
  removeClaimLine,
  transitionClaim,
  validateClaim,
} from "@/server/domains/hmo/claims";
import {
  activatePayerSchema,
  claimTransitionSchema,
  coverageSchema,
  encounterPayerSchema,
  endCoverageSchema,
  manualEligibilitySchema,
  payerSchema,
  planSchema,
  preauthDecisionSchema,
  preauthSchema,
  remittanceSchema,
  tariffSchema,
} from "@/lib/schemas/hmo";
import { decisionSchema } from "@/lib/schemas/billing";
import { requiredText, uuid } from "@/lib/schemas/common";

export const savePayerAction = defineAction(
  "hmo.payer.save",
  payerSchema,
  async (ctx, i) => (await savePayer(ctx, i)).id,
);
export const setPayerStatusAction = defineAction(
  "hmo.payer.status",
  activatePayerSchema.extend({ status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]).default("ACTIVE") }),
  setPayerStatus,
);
export const savePlanAction = defineAction(
  "hmo.plan.save",
  planSchema,
  async (ctx, i) => (await savePlan(ctx, i)).id,
);
export const setPlanStatusAction = defineAction(
  "hmo.plan.status",
  z.object({ id: uuid, status: z.enum(["ACTIVE", "SUSPENDED"]) }),
  setPlanStatus,
);
export const proposeTariffAction = defineAction(
  "hmo.tariff.propose",
  tariffSchema,
  async (ctx, i) => (await proposeTariff(ctx, i)).id,
);
export const decideTariffAction = defineAction("hmo.tariff.decide", decisionSchema, decideTariff);

export const enrolCoverageAction = defineAction(
  "hmo.coverage.enrol",
  coverageSchema,
  async (ctx, i) => (await enrolCoverage(ctx, i)).id,
);
export const endCoverageAction = defineAction("hmo.coverage.end", endCoverageSchema, endCoverage);
export const manualEligibilityAction = defineAction(
  "hmo.eligibility.manual",
  manualEligibilitySchema,
  async (ctx, i) => {
    await recordManualEligibility(ctx, i);
  },
);
export const connectorEligibilityAction = defineAction(
  "hmo.eligibility.connector",
  z.object({ coverageId: uuid }),
  async (ctx, i) => {
    const c = await runConnectorEligibility(ctx, i.coverageId);
    return { outcome: c.outcome, errorCode: c.errorCode };
  },
);
export const encounterPayerAction = defineAction(
  "hmo.encounter.payer",
  encounterPayerSchema,
  setEncounterPayer,
);

export const createPreauthAction = defineAction(
  "hmo.preauth.create",
  preauthSchema,
  async (ctx, i) => (await createPreauth(ctx, i)).id,
);
export const transitionPreauthAction = defineAction(
  "hmo.preauth.transition",
  preauthDecisionSchema,
  transitionPreauth,
);

export const createClaimAction = defineAction(
  "hmo.claim.create",
  z.object({ encounterId: uuid }),
  async (ctx, i) => (await createClaimForEncounter(ctx, i.encounterId)).id,
);
export const validateClaimAction = defineAction(
  "hmo.claim.validate",
  z.object({ id: uuid, version: z.number().int().min(0) }),
  validateClaim,
);
export const transitionClaimAction = defineAction(
  "hmo.claim.transition",
  claimTransitionSchema,
  transitionClaim,
);
export const removeClaimLineAction = defineAction(
  "hmo.claim.line.remove",
  z.object({ lineId: uuid, reason: requiredText("Reason", 300) }),
  removeClaimLine,
);
export const createBatchAction = defineAction(
  "hmo.claim.batch",
  z.object({ payerId: uuid, claimIds: z.array(uuid).min(1, "Choose at least one claim") }),
  async (ctx, i) => (await createBatch(ctx, i)).id,
);
export const importRemittanceAction = defineAction(
  "hmo.remittance.import",
  remittanceSchema,
  async (ctx, i) => (await importRemittance(ctx, i)).ref,
);

/** Form-friendly variant: tick the services; one of each is requested. */
export const requestPreauthAction = defineAction(
  "hmo.preauth.create",
  z.object({
    encounterId: uuid,
    medicalNecessity: requiredText("Medical necessity", 2000),
    serviceItemIds: z.array(uuid).min(1, "Choose at least one service"),
  }),
  async (ctx, i) =>
    (
      await createPreauth(ctx, {
        encounterId: i.encounterId,
        medicalNecessity: i.medicalNecessity,
        items: i.serviceItemIds.map((serviceItemId) => ({ serviceItemId, quantity: 1 })),
      })
    ).id,
);
