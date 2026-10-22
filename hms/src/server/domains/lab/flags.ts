import type { ResultFlag } from "@prisma/client";

/** Plain-number view of a reference range (Prisma Decimals converted by the caller). */
export interface RangeLike {
  sex: "ANY" | "FEMALE" | "MALE";
  ageMinDays: number;
  ageMaxDays: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  normalText: string | null;
}

/**
 * Pick the applicable APPROVED range for a patient: sex-specific beats ANY, then the narrowest age
 * window. Returns null if none applies (then no flag is produced - never a guess).
 */
export function selectRange<T extends RangeLike>(ranges: T[], sex: string, ageDays: number | null): T | null {
  const candidates = ranges.filter(
    (r) =>
      (r.sex === "ANY" || r.sex === sex) &&
      (ageDays === null ? r.ageMinDays === 0 && r.ageMaxDays === null : ageDays >= r.ageMinDays && (r.ageMaxDays === null || ageDays < r.ageMaxDays)),
  );
  candidates.sort((a, b) => {
    if ((a.sex === "ANY") !== (b.sex === "ANY")) return a.sex === "ANY" ? 1 : -1;
    const wa = (a.ageMaxDays ?? 1e9) - a.ageMinDays;
    const wb = (b.ageMaxDays ?? 1e9) - b.ageMinDays;
    return wa - wb;
  });
  return candidates[0] ?? null;
}

export function flagNumeric(value: number, range: RangeLike | null): ResultFlag {
  if (!range) return "NONE";
  if (range.criticalLow !== null && value < range.criticalLow) return "CRITICAL_LOW";
  if (range.criticalHigh !== null && value > range.criticalHigh) return "CRITICAL_HIGH";
  if (range.low !== null && value < range.low) return "LOW";
  if (range.high !== null && value > range.high) return "HIGH";
  return "NORMAL";
}

export function flagCoded(value: string, range: RangeLike | null): ResultFlag {
  if (!range || !range.normalText) return "NONE";
  return value.trim().toLowerCase() === range.normalText.trim().toLowerCase() ? "NORMAL" : "ABNORMAL";
}

export function referenceText(range: RangeLike | null, unit: string | null): string | null {
  if (!range) return null;
  if (range.normalText) return range.normalText;
  const u = unit ? ` ${unit}` : "";
  if (range.low !== null && range.high !== null) return `${range.low}–${range.high}${u}`;
  if (range.low !== null) return `≥ ${range.low}${u}`;
  if (range.high !== null) return `≤ ${range.high}${u}`;
  return null;
}

export const CRITICAL_FLAGS: ResultFlag[] = ["CRITICAL_LOW", "CRITICAL_HIGH"];

/** Parse a numeric result strictly ("12.5", "-3", "0.04"). Returns null when not a plain number. */
export function parseNumericResult(value: string, decimals: number | null): number | null {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  if (decimals !== null && (v.split(".")[1]?.length ?? 0) > decimals) return null;
  return Number(v);
}

export const FLAG_LABEL: Record<ResultFlag, string> = {
  NONE: "",
  NORMAL: "Within range",
  LOW: "Low",
  HIGH: "High",
  CRITICAL_LOW: "Critically low",
  CRITICAL_HIGH: "Critically high",
  ABNORMAL: "Abnormal",
};
