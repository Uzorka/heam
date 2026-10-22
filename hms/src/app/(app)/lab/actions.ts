"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  amendResult,
  collectSpecimen,
  enterResults,
  receiveSpecimen,
  rejectSpecimen,
  returnForCorrection,
  verifyResults,
} from "@/server/domains/lab/service";
import {
  amendResultSchema,
  collectSpecimenSchema,
  enterResultsSchema,
  rejectSpecimenSchema,
  returnResultsSchema,
  verifyResultsSchema,
} from "@/lib/schemas/lab";
import { uuid } from "@/lib/schemas/common";

export const collectSpecimenAction = defineAction(
  "lab.collect",
  collectSpecimenSchema,
  async (ctx, i) => (await collectSpecimen(ctx, i)).accession,
);
export const receiveSpecimenAction = defineAction(
  "lab.receive",
  z.object({ specimenId: uuid }),
  async (ctx, i) => receiveSpecimen(ctx, i.specimenId),
);
export const rejectSpecimenAction = defineAction("lab.reject", rejectSpecimenSchema, rejectSpecimen);
export const enterResultsAction = defineAction("lab.results.enter", enterResultsSchema, enterResults);
export const verifyResultsAction = defineAction("lab.results.verify", verifyResultsSchema, verifyResults);
export const returnResultsAction = defineAction(
  "lab.results.return",
  returnResultsSchema,
  returnForCorrection,
);
export const amendResultAction = defineAction(
  "lab.results.amend",
  amendResultSchema,
  async (ctx, i) => (await amendResult(ctx, i)).id,
);
