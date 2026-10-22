import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "../../db";
import { branchesWith, requirePermission, type AuthContext } from "../../authz/context";
import { ForbiddenError } from "../../errors";
import { localDayRange } from "@/lib/time";
import { ACCOUNTS } from "../billing/ledger";

/**
 * Finance figures for a Lagos date range, all from the ledger and payment records. Branch scope
 * follows the user's finance.read grants.
 */
export async function financeOverview(ctx: AuthContext, from: string, to: string, db: DbClient = prisma) {
  requirePermission(ctx, "finance.read");
  const b = branchesWith(ctx, "finance.read");
  if (b !== "ALL" && b.length === 0) throw new ForbiddenError(undefined, "finance.read");
  const start = localDayRange(from).start;
  const end = localDayRange(to).end;
  const branchSql =
    b === "ALL"
      ? Prisma.sql`TRUE`
      : Prisma.sql`e."branchId" IN (${Prisma.join(b.map((x) => Prisma.sql`${x}::uuid`))})`;
  const branchWhere = b === "ALL" ? {} : { branchId: { in: b } };

  const movements = await db.$queryRaw<{ accountCode: string; debit: bigint; credit: bigint }[]>`
    SELECT l."accountCode", COALESCE(SUM(l."debitKobo"), 0)::bigint AS debit, COALESCE(SUM(l."creditKobo"), 0)::bigint AS credit
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE e."occurredAt" >= ${start} AND e."occurredAt" < ${end} AND ${branchSql}
    GROUP BY l."accountCode"`;
  const balances = await db.$queryRaw<{ accountCode: string; payerId: string | null; balance: bigint }[]>`
    SELECT l."accountCode", l."payerId", (COALESCE(SUM(l."debitKobo"), 0) - COALESCE(SUM(l."creditKobo"), 0))::bigint AS balance
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE ${branchSql} AND l."accountCode" IN (${ACCOUNTS.PATIENT_RECEIVABLE}, ${ACCOUNTS.PAYER_RECEIVABLE}, ${ACCOUNTS.PATIENT_DEPOSITS})
    GROUP BY l."accountCode", l."payerId"`;
  const [collections, chargeSplit, shiftsPending, recent] = await Promise.all([
    db.payment.groupBy({
      by: ["method"],
      where: { ...branchWhere, status: "CONFIRMED", confirmedAt: { gte: start, lt: end } },
      _sum: { amountKobo: true },
      _count: { _all: true },
    }),
    db.charge.aggregate({
      where: { ...branchWhere, status: "ACTIVE", createdAt: { gte: start, lt: end } },
      _sum: { patientPortionKobo: true, payerPortionKobo: true },
    }),
    db.cashierShift.count({ where: { ...branchWhere, status: "CLOSED" } }),
    db.journalEntry.findMany({
      where: { ...branchWhere, occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { lines: true },
    }),
  ]);
  const net = (code: string, side: "credit" | "debit") => {
    const m = movements.find((x) => x.accountCode === code);
    if (!m) return 0n;
    return side === "credit" ? m.credit - m.debit : m.debit - m.credit;
  };
  const payerIds = [...new Set(balances.filter((x) => x.payerId).map((x) => x.payerId!))];
  const payers = await db.payer.findMany({
    where: { id: { in: payerIds } },
    select: { id: true, name: true },
  });
  return {
    revenue: net(ACCOUNTS.SERVICE_REVENUE, "credit"),
    discounts: net(ACCOUNTS.DISCOUNTS, "debit"),
    writeOffs: net(ACCOUNTS.PAYER_WRITE_OFFS, "debit"),
    patientShare: chargeSplit._sum.patientPortionKobo ?? 0n,
    payerShare: chargeSplit._sum.payerPortionKobo ?? 0n,
    collections: collections.map((c) => ({
      method: c.method,
      count: c._count._all,
      amount: c._sum.amountKobo ?? 0n,
    })),
    patientReceivable: balances
      .filter((x) => x.accountCode === ACCOUNTS.PATIENT_RECEIVABLE)
      .reduce((s, x) => s + x.balance, 0n),
    deposits: -balances
      .filter((x) => x.accountCode === ACCOUNTS.PATIENT_DEPOSITS)
      .reduce((s, x) => s + x.balance, 0n),
    payerReceivables: balances
      .filter((x) => x.accountCode === ACCOUNTS.PAYER_RECEIVABLE && x.balance !== 0n)
      .map((x) => ({
        payer: payers.find((p) => p.id === x.payerId)?.name ?? "Unassigned",
        balance: x.balance,
      })),
    shiftsPending,
    recent,
  };
}
