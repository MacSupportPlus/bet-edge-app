import { describe, expect, it } from "vitest";
import { kellyFraction } from "./edge";
import { mulberry32, simulateEnsemble, simulateOneBettorPath } from "./simulate";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("simulateOneBettorPath", () => {
  it("grows every step on a certain win (p=1)", () => {
    const path = simulateOneBettorPath({
      p: 1,
      b: 1,
      startingBankroll: 100,
      rule: { type: "fraction", fraction: 0.1 },
      numBets: 20,
      rng: mulberry32(1),
    });
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeGreaterThan(path[i - 1]);
    }
  });

  it("decays every step but never reaches exactly zero under proportional betting on a certain loss (p=0)", () => {
    const path = simulateOneBettorPath({
      p: 0,
      b: 1,
      startingBankroll: 100,
      rule: { type: "fraction", fraction: 0.1 },
      numBets: 50,
      rng: mulberry32(1),
    });
    for (let i = 1; i < path.length; i++) {
      expect(path[i]).toBeLessThan(path[i - 1]);
      expect(path[i]).toBeGreaterThan(0);
    }
    // 100 * 0.9^50 ≈ 0.515
    expect(path[path.length - 1]).toBeCloseTo(100 * 0.9 ** 50, 6);
  });

  it("hits exactly zero under flat betting on a certain loss (p=0)", () => {
    const path = simulateOneBettorPath({
      p: 0,
      b: 1,
      startingBankroll: 100,
      rule: { type: "flat", fraction: 0.1 }, // stakes $10 every bet
      numBets: 20,
      rng: mulberry32(1),
    });
    // 100, 90, 80, ..., 0 at bet 10, then clamped at 0 thereafter
    expect(path[10]).toBe(0);
    expect(path[path.length - 1]).toBe(0);
  });

  it("is deterministic given the same rng stream", () => {
    const run = () =>
      simulateOneBettorPath({
        p: 0.55,
        b: 1,
        startingBankroll: 1000,
        rule: { type: "fraction", fraction: 0.1 },
        numBets: 100,
        rng: mulberry32(7),
      });
    expect(run()).toEqual(run());
  });
});

describe("simulateEnsemble", () => {
  it("is fully reproducible from the seed", () => {
    const params = {
      p: 0.55,
      b: 1,
      startingBankroll: 1000,
      rule: { type: "fraction" as const, fraction: 0.1 },
      numBets: 100,
      numBettors: 200,
      seed: 123,
    };
    const a = simulateEnsemble(params);
    const b = simulateEnsemble(params);
    expect(a.meanPath).toEqual(b.meanPath);
    expect(a.medianPath).toEqual(b.medianPath);
    expect(a.ruinFraction).toEqual(b.ruinFraction);
  });

  it(
    "shows the ensemble average diverging above the median — the 'average is a lie' effect",
    () => {
      // Positive-edge compounding over many bets produces a right-skewed
      // (roughly log-normal) terminal distribution, so the arithmetic mean
      // pulls above the median/typical path. This is the central thesis of
      // the app and should hold robustly for a large ensemble over many bets.
      const p = 0.55;
      const b = 1;
      const f = kellyFraction(p, b);
      const result = simulateEnsemble({
        p,
        b,
        startingBankroll: 1000,
        rule: { type: "fraction", fraction: f },
        numBets: 300,
        numBettors: 3000,
        seed: 42,
      });
      const finalMean = result.meanPath[result.meanPath.length - 1];
      const finalMedian = result.medianPath[result.medianPath.length - 1];
      expect(finalMean).toBeGreaterThan(finalMedian);
    },
    // A 900,000-step simulation genuinely takes longer than Vitest's 5s
    // default under parallel CPU load (observed flaking alongside 23 other
    // test files) — not a hang, just a slow, real computation.
    15000,
  );

  it("all bettors survive when there is no way to lose more than staked and edge is certain (p=1)", () => {
    const result = simulateEnsemble({
      p: 1,
      b: 1,
      startingBankroll: 1000,
      rule: { type: "fraction", fraction: 0.1 },
      numBets: 50,
      numBettors: 100,
      seed: 5,
    });
    expect(result.ruinFraction).toBe(0);
  });

  it("all bettors are ruined on a certain loss (p=0) given enough bets", () => {
    const result = simulateEnsemble({
      p: 0,
      b: 1,
      startingBankroll: 1000,
      rule: { type: "fraction", fraction: 0.1 },
      numBets: 100, // 0.9^100 ≈ 0.0000266 of starting bankroll, well below 1% threshold
      numBettors: 50,
      seed: 9,
    });
    expect(result.ruinFraction).toBe(1);
  });

  it(
    "over-betting at 2x Kelly ruins bettors more often than full Kelly, for the same edge",
    () => {
      const p = 0.55;
      const b = 1;
      const fStar = kellyFraction(p, b);
      const base = {
        p,
        b,
        startingBankroll: 1000,
        numBets: 400,
        numBettors: 2000,
      };
      const fullKelly = simulateEnsemble({ ...base, rule: { type: "fraction", fraction: fStar }, seed: 1 });
      const doubleKelly = simulateEnsemble({
        ...base,
        rule: { type: "fraction", fraction: fStar * 2 },
        seed: 2,
      });
      expect(doubleKelly.ruinFraction).toBeGreaterThan(fullKelly.ruinFraction);
    },
    // Same reasoning as the test above — an 800,000-step simulation, not a hang.
    15000,
  );
});
