import { prisma, type DbClient } from "../../db";
import { branchesWith, requirePermission, type AuthContext } from "../../authz/context";
import { ForbiddenError } from "../../errors";
import { calendarDateToUtcMidnight, todayLocal } from "@/lib/time";

const OPEN_CLAIM = [
  "SUBMITTED",
  "ACKNOWLEDGED",
  "QUERIED",
  "RESUBMITTED",
  "APPROVED",
  "PARTLY_APPROVED",
  "PARTLY_PAID",
] as const;

/** HMO desk figures, all computed from records (no estimates). */
export async function hmoDashboard(ctx: AuthContext, db: DbClient = prisma) {
  requirePermission(ctx, "hmo.read");
  const b = branchesWith(ctx, "hmo.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "hmo.read");
  const branch = b === "ALL" ? {} : { branchId: { in: b } };
  const today = calendarDateToUtcMidnight(todayLocal());
  const soon = new Date(today.getTime() + 60 * 86_400_000);
  const [preauthPending, claimsToSend, openClaims, readyVisits, expiring, failedChecks] = await Promise.all([
    db.preauthorization.count({
      where: { status: { in: ["DRAFT", "SUBMITTED", "QUERIED"] }, encounter: branch },
    }),
    db.claim.count({ where: { status: { in: ["DRAFT", "VALIDATED"] }, ...branch } }),
    db.claim.findMany({
      where: { status: { in: [...OPEN_CLAIM] }, ...branch },
      select: {
        payerId: true,
        claimedKobo: true,
        paidKobo: true,
        writtenOffKobo: true,
        submittedAt: true,
        status: true,
      },
    }),
    db.encounter.findMany({
      where: {
        ...branch,
        coverageId: { not: null },
        charges: {
          some: { status: "ACTIVE", payerPortionKobo: { gt: 0 }, claimLines: { none: { removedAt: null } } },
        },
      },
      orderBy: { arrivedAt: "desc" },
      take: 50,
      select: {
        id: true,
        ref: true,
        arrivedAt: true,
        status: true,
        patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
        coverage: { select: { payer: { select: { name: true } } } },
      },
    }),
    db.payer.findMany({
      where: { status: "ACTIVE", contractEnd: { lte: soon } },
      select: { id: true, name: true, contractEnd: true },
    }),
    db.patientCoverage.count({ where: { status: "ACTIVE", eligibilityStatus: "CHECK_FAILED" } }),
  ]);
  const payers = await db.payer.findMany({
    where: { id: { in: [...new Set(openClaims.map((c) => c.payerId))] } },
    select: { id: true, name: true },
  });
  const now = Date.now();
  const buckets = { "0-30": 0n, "31-60": 0n, "61-90": 0n, "90+": 0n } as Record<string, bigint>;
  const byPayer = new Map<string, { name: string; claims: number; outstanding: bigint }>();
  for (const c of openClaims) {
    const outstanding = c.claimedKobo - c.paidKobo - c.writtenOffKobo;
    const age = c.submittedAt ? Math.floor((now - c.submittedAt.getTime()) / 86_400_000) : 0;
    const k = age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
    buckets[k]! += outstanding;
    const p = byPayer.get(c.payerId) ?? {
      name: payers.find((x) => x.id === c.payerId)?.name ?? "",
      claims: 0,
      outstanding: 0n,
    };
    p.claims += 1;
    p.outstanding += outstanding;
    byPayer.set(c.payerId, p);
  }
  return {
    preauthPending,
    claimsToSend,
    openClaims: openClaims.length,
    outstanding: openClaims.reduce((s, c) => s + c.claimedKobo - c.paidKobo - c.writtenOffKobo, 0n),
    aging: buckets,
    byPayer: [...byPayer.values()].sort((a, b) => (b.outstanding > a.outstanding ? 1 : -1)),
    readyVisits,
    expiring,
    failedChecks,
  };
}
