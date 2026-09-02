import { describe, expect, it } from "vitest";
import {
  expectancy,
  variance,
  stdDev,
  kellyFraction,
  growthRate,
  growthCurve,
  summarizeEdge,
  recommendedStake,
} from "./edge";

describe("expectancy", () => {
  it("matches the classic 55% coin-flip edge (even money)", () => {
    expect(expectancy(0.55, 1)).toBeCloseTo(0.1, 10);
  });

  it("is zero for a fair coin at even money", () => {
    expect(expectancy(0.5, 1)).toBeCloseTo(0, 10);
  });

  it("is negative when the bettor is at a disadvantage", () => {
    expect(expectancy(0.4, 1)).toBeCloseTo(-0.2, 10);
  });
});

describe("variance / stdDev", () => {
  it("matches the closed-form p*q*(b+1)^2 for a fair coin", () => {
    // Outcomes are +1 w.p. 0.5, -1 w.p. 0.5 -> Var = E[X^2] = 1
    expect(variance(0.5, 1)).toBeCloseTo(1, 10);
    expect(stdDev(0.5, 1)).toBeCloseTo(1, 10);
  });

  it("is zero when the outcome is certain", () => {
    expect(variance(1, 1)).toBeCloseTo(0, 10);
    expect(variance(0, 1)).toBeCloseTo(0, 10);
  });
});

describe("kellyFraction", () => {
  it("matches the classic 55% coin-flip example (f* = 0.10)", () => {
    expect(kellyFraction(0.55, 1)).toBeCloseTo(0.1, 10);
  });

  it("is zero for a fair coin (no edge)", () => {
    expect(kellyFraction(0.5, 1)).toBeCloseTo(0, 10);
  });

  it("clamps to zero rather than going negative when there is no edge", () => {
    expect(kellyFraction(0.4, 1)).toBe(0);
  });

  it("handles uneven payout odds", () => {
    // p=0.5, b=2 ("2 to 1"): f* = (2*0.5 - 0.5) / 2 = 0.25
    expect(kellyFraction(0.5, 2)).toBeCloseTo(0.25, 10);
  });
});

describe("growthRate", () => {
  it("matches the known ~0.5%/bet growth rate for the 55% coin at full Kelly", () => {
    // p ln(1.1) + q ln(0.9) — the textbook figure for this example is ~0.5%
    expect(growthRate(0.55, 1, 0.1)).toBeCloseTo(0.0050083668, 9);
  });

  it("is zero at f=0 (no bet, no growth or loss)", () => {
    expect(growthRate(0.55, 1, 0)).toBe(0);
  });

  it("goes to -Infinity at f=1 when a loss is possible", () => {
    expect(growthRate(0.55, 1, 1)).toBe(-Infinity);
  });

  it("throws for f outside [0, 1]", () => {
    expect(() => growthRate(0.55, 1, 1.5)).toThrow(RangeError);
    expect(() => growthRate(0.55, 1, -0.1)).toThrow(RangeError);
  });

  it("peaks at the Kelly-optimal fraction", () => {
    const p = 0.55;
    const b = 1;
    const fStar = kellyFraction(p, b);
    const atKelly = growthRate(p, b, fStar);
    const belowKelly = growthRate(p, b, fStar - 0.05);
    const aboveKelly = growthRate(p, b, fStar + 0.05);
    expect(atKelly).toBeGreaterThan(belowKelly);
    expect(atKelly).toBeGreaterThan(aboveKelly);
  });
});

describe("growthCurve", () => {
  it("samples points+1 points spanning f in [0, 1]", () => {
    const curve = growthCurve(0.55, 1, 200);
    expect(curve).toHaveLength(201);
    expect(curve[0]).toEqual({ f: 0, g: 0 });
    expect(curve[curve.length - 1].f).toBe(1);
    expect(curve[curve.length - 1].g).toBe(-Infinity);
  });
});

describe("summarizeEdge", () => {
  it("bundles the core outputs and flags a real edge", () => {
    const summary = summarizeEdge(0.55, 1);
    expect(summary.hasEdge).toBe(true);
    expect(summary.expectancy).toBeCloseTo(0.1, 10);
    expect(summary.kellyFraction).toBeCloseTo(0.1, 10);
    // Var = p*q*(b+1)^2 = 0.55*0.45*4 = 0.99
    expect(summary.stdDev).toBeCloseTo(Math.sqrt(0.99), 10);
  });

  it("flags no edge when expectancy is not positive", () => {
    expect(summarizeEdge(0.5, 1).hasEdge).toBe(false);
    expect(summarizeEdge(0.4, 1).hasEdge).toBe(false);
  });
});

describe("recommendedStake", () => {
  it("applies the Kelly fraction and fractional multiplier to bankroll", () => {
    // p=0.55, b=1 -> f*=0.10; half-Kelly on a $10,000 bankroll -> $500
    expect(recommendedStake(0.55, 1, 10000, 0.5)).toBeCloseTo(500, 10);
  });

  it("recommends full Kelly stake at multiplier 1", () => {
    expect(recommendedStake(0.55, 1, 10000, 1)).toBeCloseTo(1000, 10);
  });

  it("is zero when there is no edge, regardless of multiplier", () => {
    expect(recommendedStake(0.5, 1, 10000, 1)).toBe(0);
    expect(recommendedStake(0.4, 1, 10000, 0.25)).toBe(0);
  });
});
