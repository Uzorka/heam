export const EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "LOCUM", "INTERN", "NYSC", "VOLUNTEER"] as const;
export const SHIFT_KINDS = ["MORNING", "AFTERNOON", "NIGHT", "ON_CALL", "OTHER"] as const;
export const LEAVE_TYPES = [
  "ANNUAL",
  "SICK",
  "MATERNITY",
  "PATERNITY",
  "STUDY",
  "COMPASSIONATE",
  "UNPAID",
  "OTHER",
] as const;

export const label = (s: string) => {
  const t = s.toLowerCase().replace(/_/g, " ");
  return t === "nysc" ? "NYSC" : t.charAt(0).toUpperCase() + t.slice(1);
};
export const options = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: label(x) }));
