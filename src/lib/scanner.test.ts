import { describe, expect, it } from "vitest";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickSide } from "./scanner";

describe("pickSide", () => {
  it("picks the home side when its expectancy is higher", () => {
    // p_home=0.6 at even money (b=1, ml=+100 -> b=1): clear positive expectancy
    const pick = pickSide(0.6, 100, -120, "Home", "Away");
    expect(pick.side).toBe("home");
    expect(pick.team).toBe("Home");
  });

  it("picks the away side when its expectancy is higher", () => {
    // p_home=0.2 -> away side has p=0.8, likely the better bet at reasonable away odds
    const pick = pickSide(0.2, -200, 300, "Home", "Away");
    expect(pick.side).toBe("away");
    expect(pick.team).toBe("Away");
  });

  it("computes disagreement as model probability minus market-implied probability", () => {
    // model gives home 0.677, market moneyline +1500 implies ~0.0625
    const pick = pickSide(0.677, 1500, -3000, "Stanford", "Miami");
    expect(pick.side).toBe("home");
    expect(pick.marketImplied).toBeCloseTo(100 / 1600, 6);
    expect(pick.disagreement).toBeCloseTo(0.677 - 100 / 1600, 6);
  });
});

describe("classifyPick", () => {
  it("returns no-edge when there is no positive expectancy", () => {
    const pick = pickSide(0.5, -110, -110, "Home", "Away");
    expect(classifyPick(pick, 10000, 0.5)).toEqual({ status: "no-edge" });
  });

  it("returns a trustworthy edge with a recommended stake for a modest, plausible disagreement", () => {
    // Away side: model gives it 70%, market (-150) implies 60% — a 10pt gap,
    // under the trust threshold, with genuine positive expectancy. This is
    // the kind of real, modest edge the app should actually act on.
    const pick = pickSide(0.3, 130, -150, "Home", "Away");
    expect(pick.side).toBe("away");
    const result = classifyPick(pick, 10000, 0.5);
    expect(result.status).toBe("edge");
    if (result.status === "edge") {
      expect(result.stake).toBeGreaterThan(0);
    }
  });

  it("flags rather than recommends a bet when the model wildly disagrees with the market (point-gap check)", () => {
    // The real case that motivated this rule: model gives a home team 67.7%
    // against a market moneyline of +1500 (~6.25% implied) — a 61-point gap
    // AND a ~10.8x ratio, so either check alone would catch this.
    const pick = pickSide(0.677, 1500, -3000, "Stanford", "Miami");
    const result = classifyPick(pick, 10000, 0.5);
    expect(result.status).toBe("flagged");
  });

  it("flags a small absolute gap that's still a huge relative disagreement near the extremes (ratio check)", () => {
    // model 10.9% vs market-implied 2.0% on a +5000 longshot: only a 8.9pt
    // absolute gap (under the 15pt cap) but a 5.45x ratio — exactly the
    // case a point-gap-only check misses.
    const pick = pickSide(0.109, 5000, -10000, "Underdog", "Favorite");
    expect(pick.disagreement).toBeLessThan(MAX_TRUSTED_DISAGREEMENT);
    const result = classifyPick(pick, 10000, 0.5);
    expect(result.status).toBe("flagged");
  });

  it("requires both checks to pass to become a trusted edge", () => {
    const pick = pickSide(0.677, 1500, -3000, "Stanford", "Miami");
    // Raising only the point-gap threshold isn't enough — the ratio check still catches it.
    expect(classifyPick(pick, 10000, 0.5, 0.99).status).toBe("flagged");
    // Raising both lets it through.
    expect(classifyPick(pick, 10000, 0.5, 0.99, 100).status).toBe("edge");
  });

  it("the default thresholds are 15 percentage points and a 2x ratio", () => {
    expect(MAX_TRUSTED_DISAGREEMENT).toBe(0.15);
    expect(MAX_TRUSTED_RATIO).toBe(2);
  });
});
