import { describe, expect, it } from "vitest";
import {
  ageInYears,
  formatAge,
  localDateTimeToUtc,
  localDayRange,
  parseLocalDate,
  toLocalDateString,
  toLocalTimeString,
} from "@/lib/time";

describe("Africa/Lagos time handling", () => {
  it("local day range is [00:00, 24:00) Lagos = [23:00Z prev, 23:00Z)", () => {
    const { start, end } = localDayRange("2026-10-22");
    expect(start.toISOString()).toBe("2026-10-21T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-22T23:00:00.000Z");
  });
  it("an instant late in the UTC evening belongs to the next Lagos day", () => {
    expect(toLocalDateString(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
    expect(toLocalTimeString(new Date("2026-10-21T23:30:00Z"))).toBe("00:30");
  });
  it("converts local wall time to UTC", () => {
    expect(localDateTimeToUtc("2026-01-01", "08:15").toISOString()).toBe("2026-01-01T07:15:00.000Z");
    expect(localDateTimeToUtc("2026-12-31", "23:59").toISOString()).toBe("2026-12-31T22:59:00.000Z");
  });
  it("rejects impossible dates and times", () => {
    expect(() => parseLocalDate("2026-02-30")).toThrow();
    expect(() => localDateTimeToUtc("2026-02-01", "24:10")).toThrow();
  });
  it("computes age from date of birth, not stored age", () => {
    const dob = new Date("2000-10-23T00:00:00Z");
    expect(ageInYears(dob, new Date("2026-10-22T12:00:00Z"))).toBe(25);
    expect(ageInYears(dob, new Date("2026-10-22T23:30:00Z"))).toBe(26); // already 23 Oct in Lagos
    expect(formatAge(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-22T12:00:00Z"))).toBe("21 d");
    expect(formatAge(new Date("2026-01-15T00:00:00Z"), new Date("2026-10-22T12:00:00Z"))).toBe("9 mo");
  });
});
