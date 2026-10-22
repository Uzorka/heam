/**
 * Suggested quantity = units per dose x times per day x days, only when the dose is a plain number
 * of dispensing units and the frequency has an approved times-per-day. The prescriber always
 * confirms or overrides it; nothing is calculated silently.
 */
export function suggestQuantity(
  dose: string,
  timesPerDay: number | null | undefined,
  durationDays: number | null | undefined,
): number | null {
  const units = Number(dose.trim());
  if (!dose.trim() || !Number.isFinite(units) || units <= 0 || !timesPerDay || !durationDays) return null;
  const q = Math.ceil(units * timesPerDay * durationDays);
  return q > 0 && q <= 10_000 ? q : null;
}
