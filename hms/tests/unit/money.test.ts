import { describe, expect, it } from "vitest";
import {
  formatNaira,
  koboToNairaString,
  multiplyKobo,
  parseNairaToKobo,
  percentOfKobo,
  sumKobo,
} from "@/lib/money";

describe("money (integer kobo)", () => {
  it("parses naira strings exactly", () => {
    expect(parseNairaToKobo("1,250.50")).toBe(125050n);
    expect(parseNairaToKobo("₦ 0.1")).toBe(10n);
    expect(parseNairaToKobo("15000")).toBe(1500000n);
    expect(parseNairaToKobo("-20.05")).toBe(-2005n);
  });
  it("rejects invalid and over-precise amounts", () => {
    expect(() => parseNairaToKobo("12.345")).toThrow();
    expect(() => parseNairaToKobo("abc")).toThrow();
    expect(() => parseNairaToKobo("")).toThrow();
  });
  it("formats for display", () => {
    expect(formatNaira(125050n)).toBe("₦1,250.50");
    expect(formatNaira(5)).toBe("₦0.05");
    expect(formatNaira(-123456789n)).toBe("-₦1,234,567.89");
    expect(koboToNairaString(100n)).toBe("1.00");
  });
  it("avoids floating point drift", () => {
    // 0.1 + 0.2 style errors cannot happen with kobo bigint
    expect(sumKobo([10n, 20n])).toBe(30n);
    expect(sumKobo(Array.from({ length: 1000 }, () => 1n))).toBe(1000n);
  });
  it("multiplies by fractional quantities with half-up rounding", () => {
    expect(multiplyKobo(333n, "3")).toBe(999n);
    expect(multiplyKobo(1000n, "1.5")).toBe(1500n);
    expect(multiplyKobo(333n, "0.5")).toBe(167n); // 166.5 -> 167
  });
  it("splits percentages so parts sum to the whole", () => {
    const total = 1234567n;
    const copay = percentOfKobo(total, 1000); // 10%
    expect(copay).toBe(123457n);
    expect(copay + (total - copay)).toBe(total);
    expect(() => percentOfKobo(total, 10001)).toThrow();
  });
});
