import type { PaymentMethod } from "@prisma/client";
import type { DbClient, Tx } from "../../db";

/** Chart of accounts used by automatic postings (seeded by the Phase 4 migration). */
export const ACCOUNTS = {
  CASH: "1000",
  POS_CLEARING: "1010",
  BANK: "1020",
  ONLINE_CLEARING: "1030",
  PATIENT_RECEIVABLE: "1100",
  PAYER_RECEIVABLE: "1200",
  PATIENT_DEPOSITS: "2100",
  SERVICE_REVENUE: "4000",
  DISCOUNTS: "4900",
  PAYER_WRITE_OFFS: "5900",
} as const;

export const METHOD_ACCOUNT: Record<PaymentMethod, string> = {
  CASH: ACCOUNTS.CASH,
  POS: ACCOUNTS.POS_CLEARING,
  BANK_TRANSFER: ACCOUNTS.BANK,
  ONLINE: ACCOUNTS.ONLINE_CLEARING,
};

export interface PostingLine {
  account: string;
  debit?: bigint;
  credit?: bigint;
  payerId?: string | null;
  patientId?: string | null;
}

/**
 * Post one balanced journal entry. (sourceType, sourceId, kind) is unique, so posting the same
 * event twice is a no-op - this is what keeps retried callbacks and double clicks from double
 * counting money. Zero-amount lines are dropped; an entry with no lines is not written.
 */
export async function postJournal(
  tx: Tx,
  e: {
    branchId: string;
    sourceType: string;
    sourceId: string;
    kind: string;
    description: string;
    lines: PostingLine[];
    userId?: string | null;
  },
): Promise<boolean> {
  const lines = e.lines.filter((l) => (l.debit ?? 0n) > 0n || (l.credit ?? 0n) > 0n);
  if (!lines.length) return false;
  const debit = lines.reduce((s, l) => s + (l.debit ?? 0n), 0n);
  const credit = lines.reduce((s, l) => s + (l.credit ?? 0n), 0n);
  if (debit !== credit)
    throw new Error(`Unbalanced posting for ${e.sourceType}/${e.kind}: ${debit} vs ${credit}`);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "JournalEntry" ("id", "branchId", "sourceType", "sourceId", "kind", "description", "createdById")
    VALUES (gen_random_uuid(), ${e.branchId}::uuid, ${e.sourceType}, ${e.sourceId}, ${e.kind}, ${e.description}, ${e.userId ?? null}::uuid)
    ON CONFLICT ("sourceType", "sourceId", "kind") DO NOTHING
    RETURNING "id"`;
  const entryId = inserted[0]?.id;
  if (!entryId) return false;
  await tx.journalLine.createMany({
    data: lines.map((l) => ({
      entryId,
      accountCode: l.account,
      debitKobo: l.debit ?? 0n,
      creditKobo: l.credit ?? 0n,
      payerId: l.payerId ?? null,
      patientId: l.patientId ?? null,
    })),
  });
  return true;
}

/** Balance (debits - credits) of an account, optionally for one payer or patient. */
export async function accountBalance(
  db: DbClient,
  account: string,
  filter: { payerId?: string; patientId?: string } = {},
): Promise<bigint> {
  const agg = await db.journalLine.aggregate({
    where: { accountCode: account, ...filter },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (agg._sum.debitKobo ?? 0n) - (agg._sum.creditKobo ?? 0n);
}
