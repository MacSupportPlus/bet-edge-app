import { describe, expect, it } from "vitest";
import { brierScore, reliabilityBins } from "./calibration";

describe("brierScore", () => {
  it("is 0 for perfect predictions", () => {
    expect(brierScore([1, 0, 1, 0], [1, 0, 1, 0])).toBe(0);
  });

  it("is 1 for maximally wrong confident predictions", () => {
    expect(brierScore([1, 0], [0, 1])).toBe(1);
  });

  it("matches hand-computed value for a known small case", () => {
    // (0.7-1)^2 + (0.3-0)^2 = 0.09 + 0.09 = 0.18, / 2 = 0.09
    expect(brierScore([0.7, 0.3], [1, 0])).toBeCloseTo(0.09, 10);
  });

  it("throws on mismatched lengths", () => {
    expect(() => brierScore([0.5], [1, 0])).toThrow(RangeError);
  });
});

describe("reliabilityBins", () => {
  it("groups predictions into equal-width bins and computes avg predicted/actual", () => {
    // 2 predictions in [0, 0.5), 2 in [0.5, 1)
    const predictions = [0.1, 0.2, 0.8, 0.9];
    const outcomes = [0, 1, 1, 1];
    const bins = reliabilityBins(predictions, outcomes, 2);
    expect(bins).toHaveLength(2);
    expect(bins[0].avgPredicted).toBeCloseTo(0.15, 10);
    expect(bins[0].avgActual).toBeCloseTo(0.5, 10);
    expect(bins[0].count).toBe(2);
    expect(bins[1].avgPredicted).toBeCloseTo(0.85, 10);
    expect(bins[1].avgActual).toBeCloseTo(1, 10);
    expect(bins[1].count).toBe(2);
  });

  it("returns null averages for empty bins rather than NaN", () => {
    const bins = reliabilityBins([0.05], [0], 10);
    expect(bins[0].count).toBe(1);
    expect(bins[5].count).toBe(0);
    expect(bins[5].avgPredicted).toBeNull();
    expect(bins[5].avgActual).toBeNull();
  });

  it("clamps p=1.0 into the last bin rather than overflowing", () => {
    const bins = reliabilityBins([1.0], [1], 10);
    expect(bins[9].count).toBe(1);
  });
});
