/**
 * Calendar arithmetic used for pregnancy dating. These are standard date conventions (EDD = LMP +
 * 280 days; ultrasound EDD = scan date + 280 days - gestation at scan). They produce a proposed
 * date only - a clinician reviews and adopts it.
 */
const DAY = 86_400_000;

function toUtc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, m! - 1, day!);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function eddFromLmp(lmp: string): string {
  return fromUtc(toUtc(lmp) + 280 * DAY);
}

export function eddFromScan(scanDate: string, gaDays: number): string {
  return fromUtc(toUtc(scanDate) + (280 - gaDays) * DAY);
}

/** Gestational age in days on a date, from an adopted EDD. */
export function gestationDays(edd: string, on: string): number {
  return 280 - Math.round((toUtc(edd) - toUtc(on)) / DAY);
}

export function formatGestation(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days < 0) return "before LMP";
  return `${Math.floor(days / 7)}w ${days % 7}d`;
}

/** Number of Lagos calendar nights between two instants (minimum 1 for any stay). */
export function nightsBetween(startLocalDate: string, endLocalDate: string): number {
  return Math.max(1, Math.round((toUtc(endLocalDate) - toUtc(startLocalDate)) / DAY));
}
