import { describe, expect, it } from "vitest";
import { suggestQuantity } from "@/lib/dosing";

describe("suggestQuantity", () => {
  it("multiplies plain unit doses by frequency and duration", () => {
    expect(suggestQuantity("1", 2, 5)).toBe(10);
    expect(suggestQuantity("2", 3, 7)).toBe(42);
    expect(suggestQuantity("0.5", 2, 5)).toBe(5);
    expect(suggestQuantity("0.5", 3, 5)).toBe(8); // rounds up to whole units
  });

  it("makes no suggestion when the dose is not a plain number or data is missing", () => {
    expect(suggestQuantity("500 mg", 2, 5)).toBeNull();
    expect(suggestQuantity("5 ml", 3, 5)).toBeNull();
    expect(suggestQuantity("", 2, 5)).toBeNull();
    expect(suggestQuantity("1", null, 5)).toBeNull();
    expect(suggestQuantity("1", 2, undefined)).toBeNull();
    expect(suggestQuantity("-1", 2, 5)).toBeNull();
    expect(suggestQuantity("1000", 24, 365)).toBeNull(); // implausibly large: no suggestion
  });
});
