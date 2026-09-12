import { describe, expect, it } from "vitest";
import { removeVig } from "./devig";

describe("removeVig", () => {
  it("normalizes standard -110/-110 odds to an exact 50/50 fair split", () => {
    // impliedProbability(-110) = 110/210 ≈ 0.52381 for both sides.
    const result = removeVig(110 / 210, 110 / 210);
    expect(result.fairHome).toBeCloseTo(0.5, 10);
    expect(result.fairAway).toBeCloseTo(0.5, 10);
    expect(result.overround).toBeCloseTo(110 / 210 + 110 / 210 - 1, 10);
  });

  it("preserves the relative favorite/underdog skew while removing the vig", () => {
    // A 70/35 raw split (sums to 1.05) should become a fair 2:1 split.
    const result = removeVig(0.7, 0.35);
    expect(result.fairHome).toBeCloseTo(2 / 3, 10);
    expect(result.fairAway).toBeCloseTo(1 / 3, 10);
    expect(result.fairHome + result.fairAway).toBeCloseTo(1, 10);
  });

  it("reports zero overround for an already-fair (no-vig) market", () => {
    const result = removeVig(0.5, 0.5);
    expect(result.overround).toBeCloseTo(0, 10);
    expect(result.fairHome).toBeCloseTo(0.5, 10);
  });

  it("doesn't divide by zero when both inputs are zero", () => {
    expect(removeVig(0, 0)).toEqual({ fairHome: 0, fairAway: 0, overround: 0 });
  });
});
