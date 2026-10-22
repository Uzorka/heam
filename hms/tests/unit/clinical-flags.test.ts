import { describe, expect, it } from "vitest";
import {
  flagCoded,
  flagNumeric,
  parseNumericResult,
  referenceText,
  selectRange,
  type RangeLike,
} from "@/server/domains/lab/flags";
import { bmi, flagVitals } from "@/server/domains/clinical/vital-flags";

const r = (o: Partial<RangeLike>): RangeLike => ({
  sex: "ANY",
  ageMinDays: 0,
  ageMaxDays: null,
  low: null,
  high: null,
  criticalLow: null,
  criticalHigh: null,
  normalText: null,
  ...o,
});

describe("lab flags", () => {
  it("picks sex-specific then narrowest age range", () => {
    const any = r({ low: 11 });
    const female = r({ sex: "FEMALE", low: 12 });
    const child = r({ sex: "FEMALE", ageMinDays: 0, ageMaxDays: 365 * 12, low: 11.5 });
    expect(selectRange([any, female, child], "FEMALE", 365 * 30)).toBe(female);
    expect(selectRange([any, female, child], "FEMALE", 365 * 5)).toBe(child);
    expect(selectRange([any, female, child], "MALE", 365 * 30)).toBe(any);
    expect(selectRange([female], "MALE", 365 * 30)).toBeNull();
  });
  it("flags numeric values with critical precedence", () => {
    const range = r({ low: 12, high: 16, criticalLow: 7, criticalHigh: 20 });
    expect(flagNumeric(6.9, range)).toBe("CRITICAL_LOW");
    expect(flagNumeric(11, range)).toBe("LOW");
    expect(flagNumeric(14, range)).toBe("NORMAL");
    expect(flagNumeric(17, range)).toBe("HIGH");
    expect(flagNumeric(21, range)).toBe("CRITICAL_HIGH");
    expect(flagNumeric(21, null)).toBe("NONE");
  });
  it("flags coded results only against an expected normal", () => {
    expect(flagCoded("Not seen", r({ normalText: "not seen" }))).toBe("NORMAL");
    expect(flagCoded("Seen (+)", r({ normalText: "Not seen" }))).toBe("ABNORMAL");
    expect(flagCoded("Seen", null)).toBe("NONE");
  });
  it("parses numeric results strictly", () => {
    expect(parseNumericResult("12.5", 1)).toBe(12.5);
    expect(parseNumericResult("12.55", 1)).toBeNull();
    expect(parseNumericResult("12,5", 1)).toBeNull();
    expect(parseNumericResult(">10", null)).toBeNull();
  });
  it("formats reference text", () => {
    expect(referenceText(r({ low: 12, high: 16 }), "g/dL")).toBe("12–16 g/dL");
    expect(referenceText(r({ normalText: "Negative" }), null)).toBe("Negative");
    expect(referenceText(null, "g/dL")).toBeNull();
  });
});

describe("vital flags", () => {
  it("only flags parameters with approved thresholds", () => {
    const flags = flagVitals({ temperatureC: 39.2, pulseBpm: 130 }, [
      { parameter: "TEMPERATURE_C", low: 36, high: 37.5, criticalLow: 35, criticalHigh: 40 },
    ]);
    expect(flags.temperatureC).toBe("HIGH");
    expect(flags.pulseBpm).toBeUndefined();
  });
  it("computes BMI only with valid inputs", () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmi(70, null)).toBeNull();
    expect(bmi(70, 30)).toBeNull();
  });
});
