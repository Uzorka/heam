import { describe, expect, it } from "vitest";
import { DUPLICATE_WARN_THRESHOLD, orderedPair, scoreDuplicate } from "@/server/domains/patients/duplicates";
import { editDistance, normalizeName } from "@/server/domains/patients/normalize";

const base = {
  givenName: "Oluwaseun",
  familyName: "Adebayo",
  dateOfBirth: new Date("1990-01-30"),
  phones: ["+2348090000107"],
  identifierIndexes: [],
};

describe("duplicate scoring", () => {
  it("flags same phone + DOB + surname", () => {
    const s = scoreDuplicate(base, { ...base, id: "x", givenName: "Seun" });
    expect(s.score).toBeGreaterThanOrEqual(DUPLICATE_WARN_THRESHOLD);
    expect(s.reasons).toContain("Same phone number");
  });
  it("does not flag unrelated people with the same common surname", () => {
    const s = scoreDuplicate(base, {
      id: "y",
      givenName: "Kemi",
      familyName: "Adebayo",
      dateOfBirth: new Date("1970-02-02"),
      phones: [],
      identifierIndexes: [],
    });
    expect(s.score).toBeLessThan(DUPLICATE_WARN_THRESHOLD);
  });
  it("detects swapped first name and surname", () => {
    const s = scoreDuplicate(base, {
      ...base,
      id: "z",
      givenName: "Adebayo",
      familyName: "Oluwaseun",
      phones: [],
    });
    expect(s.reasons).toContain("First name and surname swapped");
  });
  it("a matching identity document dominates", () => {
    const s = scoreDuplicate(
      { ...base, identifierIndexes: ["abc"] },
      { id: "q", givenName: "X", familyName: "Y", dateOfBirth: null, phones: [], identifierIndexes: ["abc"] },
    );
    expect(s.score).toBeGreaterThanOrEqual(DUPLICATE_WARN_THRESHOLD);
  });
  it("orders pairs canonically", () => {
    expect(orderedPair("b", "a")).toEqual(["a", "b"]);
  });
  it("normalises names", () => {
    expect(normalizeName("  ADÉBÁYỌ   Olú ")).toBe("adebayo olu");
    expect(editDistance("adebayo", "adebayor")).toBe(1);
  });
});
