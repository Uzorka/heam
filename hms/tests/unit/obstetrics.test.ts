import { describe, expect, it } from "vitest";
import { eddFromLmp, eddFromScan, formatGestation, gestationDays, nightsBetween } from "@/lib/obstetrics";

describe("pregnancy dating arithmetic", () => {
  it("EDD from LMP is 280 days later, across leap years", () => {
    expect(eddFromLmp("2026-01-01")).toBe("2026-10-08");
    expect(eddFromLmp("2027-06-15")).toBe("2028-03-21"); // 2028 is a leap year
  });

  it("EDD from an ultrasound uses gestation at the scan", () => {
    // 12 weeks 3 days on 2026-04-01 -> 193 days remaining
    expect(eddFromScan("2026-04-01", 87)).toBe("2026-10-11");
  });

  it("gestational age on a date from the adopted EDD", () => {
    expect(gestationDays("2026-10-08", "2026-01-01")).toBe(0);
    expect(gestationDays("2026-10-08", "2026-10-08")).toBe(280);
    expect(formatGestation(gestationDays("2026-10-08", "2026-05-01"))).toBe("17w 1d");
    expect(formatGestation(null)).toBe("—");
  });

  it("bed nights count calendar nights with a one-night minimum", () => {
    expect(nightsBetween("2026-10-20", "2026-10-20")).toBe(1);
    expect(nightsBetween("2026-10-20", "2026-10-22")).toBe(2);
    expect(nightsBetween("2026-12-31", "2027-01-02")).toBe(2);
  });
});
