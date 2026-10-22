"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { verifyChain } from "@/server/domains/audit/query";
import { reviewBreakGlass } from "@/server/domains/security/breakglass";
import { breakGlassReviewSchema } from "@/lib/schemas/staff";

export const verifyChainAction = defineAction("audit.verify", z.object({}), async (ctx) => verifyChain(ctx));
export const reviewBreakGlassAction = defineAction("breakglass.review", breakGlassReviewSchema, reviewBreakGlass);
