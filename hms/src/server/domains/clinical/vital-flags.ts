import type { VitalParameter } from "@prisma/client";
import { flagNumeric, type RangeLike } from "../lab/flags";

export interface ThresholdLike {
  parameter: VitalParameter;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
}

export const VITAL_FIELDS: Record<VitalParameter, { field: string; label: string; unit: string }> = {
  TEMPERATURE_C: { field: "temperatureC", label: "Temperature", unit: "°C" },
  PULSE_BPM: { field: "pulseBpm", label: "Pulse", unit: "bpm" },
  RESP_RATE: { field: "respRatePerMin", label: "Respiratory rate", unit: "/min" },
  SYSTOLIC: { field: "systolicMmHg", label: "Systolic BP", unit: "mmHg" },
  DIASTOLIC: { field: "diastolicMmHg", label: "Diastolic BP", unit: "mmHg" },
  SPO2: { field: "spo2Pct", label: "SpO₂", unit: "%" },
};

/**
 * Display flags for a vital-sign set using APPROVED adult thresholds only. A flag means "outside the
 * hospital's configured range" - it is not a diagnosis and never changes priority automatically.
 */
export function flagVitals(values: Record<string, number | null | undefined>, thresholds: ThresholdLike[]) {
  const out: Partial<Record<string, ReturnType<typeof flagNumeric>>> = {};
  for (const t of thresholds) {
    const field = VITAL_FIELDS[t.parameter].field;
    const v = values[field];
    if (v === null || v === undefined) continue;
    const range: RangeLike = { sex: "ANY", ageMinDays: 0, ageMaxDays: null, normalText: null, ...t };
    out[field] = flagNumeric(v, range);
  }
  return out;
}

/** BMI only when both inputs are present and plausible; rounded to one decimal. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm || heightCm < 50 || weightKg < 2) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
