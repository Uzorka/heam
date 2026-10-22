export function addDaysLocal(local: string, days: number): string {
  const d = new Date(`${local}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
