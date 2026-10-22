import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { formatMrn, isValidMrn, luhnCheckDigit } from "@/server/sequence";

describe("phone normalisation", () => {
  it("normalises Nigerian formats to E.164", () => {
    expect(normalizePhone("0803 555 0123")).toBe("+2348035550123");
    expect(normalizePhone("+234 803 555 0123")).toBe("+2348035550123");
    expect(normalizePhone("2348035550123")).toBe("+2348035550123");
  });
  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("masks for non-clinical display", () => {
    expect(maskPhone("+2348035550123")).toBe("+234 *** *** 0123");
  });
});

describe("MRN", () => {
  it("includes a Luhn check digit", () => {
    expect(luhnCheckDigit("000001")).toBe(8);
    const mrn = formatMrn(1n);
    expect(mrn).toBe("ADK0000018");
    expect(isValidMrn(mrn)).toBe(true);
  });
  it("detects single-digit typos and transpositions", () => {
    expect(isValidMrn("ADK0000019")).toBe(false);
    expect(isValidMrn(formatMrn(12n).replace("12", "21"))).toBe(false);
  });
});
