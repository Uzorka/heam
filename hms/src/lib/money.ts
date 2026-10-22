/**
 * Money is always held as integer kobo (1 NGN = 100 kobo). Never use floating point for money.
 * BigInt is used for arithmetic so totals cannot silently lose precision.
 */
export type Kobo = bigint;

const NAIRA_PATTERN = /^(-)?(\d{1,15})(?:\.(\d{1,2}))?$/;

/** Parse a user-entered naira amount ("1,250.50") into kobo. Throws on invalid input. */
export function parseNairaToKobo(input: string): Kobo {
  const cleaned = input.trim().replace(/[₦,\s]/g, "");
  const match = NAIRA_PATTERN.exec(cleaned);
  if (!match) throw new Error(`Invalid naira amount: "${input}"`);
  const [, sign, whole, frac = ""] = match;
  const kobo = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -kobo : kobo;
}

export function koboToNairaString(kobo: Kobo | number): string {
  const k = BigInt(kobo);
  const negative = k < 0n;
  const abs = negative ? -k : k;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Format kobo for display, e.g. "₦12,500.00". */
export function formatNaira(kobo: Kobo | number): string {
  const k = BigInt(kobo);
  const negative = k < 0n;
  const abs = negative ? -k : k;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₦${whole}.${frac}`;
}

export function sumKobo(values: Iterable<Kobo>): Kobo {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** unitPrice × quantity where quantity may have up to 3 decimals (e.g. 1.5 units). Rounds half-up. */
export function multiplyKobo(unitPrice: Kobo, quantity: string | number): Kobo {
  const q = typeof quantity === "number" ? quantity.toString() : quantity;
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(q);
  if (!m) throw new Error(`Invalid quantity: ${q}`);
  const milli = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"));
  const raw = unitPrice * milli;
  return raw >= 0n ? (raw + 500n) / 1000n : -((-raw + 500n) / 1000n);
}

/**
 * Percentage of an amount expressed in basis points (1% = 100 bp), rounded half-up.
 * Used for copay/discount splits so that part + remainder always equals the whole.
 */
export function percentOfKobo(amount: Kobo, basisPoints: number): Kobo {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new Error("basisPoints must be an integer between 0 and 10000");
  }
  return (amount * BigInt(basisPoints) + 5000n) / 10000n;
}
