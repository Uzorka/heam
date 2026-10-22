import type { Tx } from "./db";

/**
 * Atomically allocate the next value of a named counter inside the caller's transaction.
 * Row-level locking via INSERT ... ON CONFLICT DO UPDATE guarantees uniqueness under concurrency.
 */
export async function nextSequence(tx: Tx, scope: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO "Sequence" ("scope", "value") VALUES (${scope}, 1)
    ON CONFLICT ("scope") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`Sequence allocation failed for ${scope}`);
  return value;
}

/** Luhn mod-10 check digit, so mistyped MRNs are usually detected. */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function formatMrn(n: bigint): string {
  const body = n.toString().padStart(6, "0");
  return `ADK${body}${luhnCheckDigit(body)}`;
}

export function isValidMrn(mrn: string): boolean {
  const m = /^ADK(\d{6,})(\d)$/.exec(mrn.toUpperCase());
  return !!m && luhnCheckDigit(m[1]!) === Number(m[2]);
}

export async function nextMrn(tx: Tx): Promise<string> {
  return formatMrn(await nextSequence(tx, "MRN"));
}

/** Year-scoped reference, e.g. ENC-2026-000123. Year is the hospital-local year. */
export async function nextYearlyRef(tx: Tx, prefix: string, localYear: number): Promise<string> {
  const n = await nextSequence(tx, `${prefix}:${localYear}`);
  return `${prefix}-${localYear}-${n.toString().padStart(6, "0")}`;
}
