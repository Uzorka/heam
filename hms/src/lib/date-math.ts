/** Add days to a "YYYY-MM-DD" calendar date (no timezone involved). */
export function addDays(local: string, days: number): string {
  const d = new Date(`${local}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
