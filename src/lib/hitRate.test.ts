import { describe, expect, it } from "vitest";
import { currentStreak, hitRate, MIN_SAMPLE_FOR_TIER, tierFor } from "./hitRate";

describe("tierFor", () => {
  it("marks a small sample as insufficient regardless of rate", () => {
    expect(tierFor(1, MIN_SAMPLE_FOR_TIER - 1)).toBe("insufficient");
    expect(tierFor(0, MIN_SAMPLE_FOR_TIER - 1)).toBe("insufficient");
  });

  it("marks NaN (zero games) as insufficient", () => {
    expect(tierFor(NaN, 0)).toBe("insufficient");
  });

  it("uses Outlier's exact boundaries once the sample is large enough", () => {
    expect(tierFor(0.65, 10)).toBe("green");
    expect(tierFor(0.64, 10)).toBe("yellow");
    expect(tierFor(0.45, 10)).toBe("yellow");
    expect(tierFor(0.44, 10)).toBe("red");
  });
});

describe("hitRate", () => {
  it("counts games clearing an OVER threshold", () => {
    const result = hitRate([80, 40, 90, 30], 50, "over");
    expect(result).toEqual({ hits: 2, total: 4, rate: 0.5, tier: "yellow" });
  });

  it("counts games clearing an UNDER threshold", () => {
    const result = hitRate([80, 40, 90, 30], 50, "under");
    expect(result.hits).toBe(2);
  });

  it("returns NaN rate and insufficient tier for zero games", () => {
    const result = hitRate([], 50);
    expect(result.rate).toBeNaN();
    expect(result.tier).toBe("insufficient");
  });

  it("does not count an exact tie as a hit either direction", () => {
    const over = hitRate([50], 50, "over");
    const under = hitRate([50], 50, "under");
    expect(over.hits).toBe(0);
    expect(under.hits).toBe(0);
  });
});

describe("currentStreak", () => {
  it("counts consecutive hits from the front (most-recent-first order)", () => {
    // most recent 3 games clear 50, then a miss
    expect(currentStreak([80, 90, 60, 20, 100], 50, "over")).toBe(3);
  });

  it("returns 0 when the very first (most recent) game misses", () => {
    expect(currentStreak([20, 90, 80], 50, "over")).toBe(0);
  });

  it("returns the full length when every game hits", () => {
    expect(currentStreak([80, 90, 100], 50, "over")).toBe(3);
  });

  it("works for an UNDER streak too", () => {
    expect(currentStreak([10, 20, 80], 50, "under")).toBe(2);
  });
});
