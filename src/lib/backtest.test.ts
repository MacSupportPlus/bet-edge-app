import { describe, expect, it } from "vitest";
import { recommendedStake } from "./edge";
import { BacktestRow, runBacktest } from "./backtest";

const B = 100 / 110; // standard -110 both sides

describe("runBacktest", () => {
  it("places no bet when there is no edge at the given odds", () => {
    // breakeven p at b=100/110 is 1/(1+b) ≈ 0.5238; p=0.50 is below that.
    const rows: BacktestRow[] = [{ pHome: 0.5, homeWin: 1 }];
    const result = runBacktest(rows, B, 1000, "full-kelly");
    expect(result.betsPlaced).toBe(0);
    expect(result.finalBankroll).toBe(1000);
    expect(result.path[1].bet).toBe(false);
  });

  it("sizes full-kelly and half-kelly bets exactly per edge.ts's recommendedStake when under the stake cap", () => {
    // p=0.6, b=100/110 -> full-Kelly f*≈16%, half≈8% — both well under the 25% default cap.
    const rows: BacktestRow[] = [{ pHome: 0.6, homeWin: 1 }];
    const full = runBacktest(rows, B, 1000, "full-kelly");
    const half = runBacktest(rows, B, 1000, "half-kelly");

    const expectedFullStake = recommendedStake(0.6, B, 1000, 1);
    const expectedHalfStake = recommendedStake(0.6, B, 1000, 0.5);

    expect(full.finalBankroll).toBeCloseTo(1000 + expectedFullStake * B, 8);
    expect(half.finalBankroll).toBeCloseTo(1000 + expectedHalfStake * B, 8);
  });

  it("caps a single bet's stake even when Kelly (and even half-Kelly) would recommend far more", () => {
    // p=0.95, b=100/110 -> raw full-Kelly f*≈89.5% of bankroll. The 25%
    // default cap should override that entirely — this is the real-world
    // guardrail against trusting a model's confidence too literally.
    const rows: BacktestRow[] = [{ pHome: 0.95, homeWin: 1 }];
    const result = runBacktest(rows, B, 1000, "full-kelly");
    const cappedStake = 0.25 * 1000;
    expect(result.finalBankroll).toBeCloseTo(1000 + cappedStake * B, 8);
  });

  it("a tighter maxStakeFraction caps even harder", () => {
    const rows: BacktestRow[] = [{ pHome: 0.95, homeWin: 1 }];
    const result = runBacktest(rows, B, 1000, "full-kelly", 0.02, 0.05);
    expect(result.finalBankroll).toBeCloseTo(1000 + 50 * B, 8);
  });

  it("uses flat staking as a fixed fraction of the STARTING bankroll", () => {
    const rows: BacktestRow[] = [
      { pHome: 0.65, homeWin: 1 },
      { pHome: 0.65, homeWin: 1 },
    ];
    const result = runBacktest(rows, B, 1000, "flat", 0.05);
    // stake = 50 each time regardless of the bankroll's current size
    expect(result.path[1].bankroll).toBeCloseTo(1000 + 50 * B, 8);
    expect(result.path[2].bankroll).toBeCloseTo(1000 + 50 * B + 50 * B, 8);
  });

  it("bets the away side (and grades it correctly) when the model favors the away team", () => {
    // pHome=0.3 -> away side has p=0.7, a clear edge; away actually wins (homeWin=0)
    const rows: BacktestRow[] = [{ pHome: 0.3, homeWin: 0 }];
    const result = runBacktest(rows, B, 1000, "full-kelly");
    expect(result.betsPlaced).toBe(1);
    expect(result.betsWon).toBe(1);
    expect(result.finalBankroll).toBeGreaterThan(1000);
  });

  it("counts wins/losses and tracks drawdown across a win-then-loss sequence", () => {
    const rows: BacktestRow[] = [
      { pHome: 0.65, homeWin: 1 }, // win
      { pHome: 0.65, homeWin: 0 }, // loss
    ];
    const result = runBacktest(rows, B, 1000, "half-kelly");
    expect(result.betsPlaced).toBe(2);
    expect(result.betsWon).toBe(1);
    expect(result.maxDrawdown).toBeGreaterThan(0);
  });

  it("never lets bankroll go negative — clamps stake at flat sizing once bankroll is below the flat amount", () => {
    const rows: BacktestRow[] = Array.from({ length: 10 }, () => ({ pHome: 0.65, homeWin: 0 as const }));
    const result = runBacktest(rows, B, 40, "flat", 0.5); // flat stake = 20/bet on a $40 bankroll, all losses
    expect(result.finalBankroll).toBeGreaterThanOrEqual(0);
  });

  it("is a pure function: identical input produces identical output", () => {
    const rows: BacktestRow[] = [
      { pHome: 0.6, homeWin: 1 },
      { pHome: 0.4, homeWin: 0 },
    ];
    expect(runBacktest(rows, B, 1000, "full-kelly")).toEqual(runBacktest(rows, B, 1000, "full-kelly"));
  });
});
