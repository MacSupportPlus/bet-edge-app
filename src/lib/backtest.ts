/**
 * Backtesting harness (Phase 4): replay the model's historical predictions
 * against what actually happened, comparing flat betting vs. full Kelly vs.
 * half Kelly sizing — reusing the exact same staking math from Phase 1.
 */

import { expectancy, recommendedStake } from "./edge";

export type BacktestStrategy = "flat" | "full-kelly" | "half-kelly";

export interface BacktestRow {
  /** Model's predicted probability that the home team wins. */
  pHome: number;
  /** 1 if the home team actually won, 0 otherwise. */
  homeWin: 0 | 1;
}

export interface BacktestPoint {
  step: number;
  bankroll: number;
  bet: boolean;
}

export interface BacktestResult {
  path: BacktestPoint[];
  betsPlaced: number;
  betsWon: number;
  finalBankroll: number;
  maxDrawdown: number;
}

const FRACTIONAL_MULTIPLIER: Record<BacktestStrategy, number> = {
  flat: 1, // unused for flat, kept for symmetry
  "full-kelly": 1,
  "half-kelly": 0.5,
};

/**
 * Runs one strategy over the rows in order. Every row offers a bet on
 * whichever side (home or away) the model favors, at fixed odds `b` (e.g.
 * ~0.909 for standard -110 juice on both sides). A bet is only placed when
 * it has positive expectancy at those odds — same "no edge, no bet" rule as
 * the Phase 1 calculator.
 *
 * `maxStakeFraction` caps any single bet at that fraction of the CURRENT
 * bankroll, applied on top of the strategy's own sizing. This matters more
 * than it looks: a model that's 99% confident on a game still has raw Kelly
 * recommending ~99% of the bankroll on that one bet (even half-Kelly is
 * still ~50%) — real bettors cap position size regardless of how confident
 * a model claims to be, precisely because model confidence is never as
 * trustworthy as the number implies. Without this cap, a long run of such
 * bets compounds into absurd (and fake) bankroll figures.
 */
export function runBacktest(
  rows: BacktestRow[],
  b: number,
  startingBankroll: number,
  strategy: BacktestStrategy,
  flatFraction = 0.02,
  maxStakeFraction = 0.25,
): BacktestResult {
  const path: BacktestPoint[] = [{ step: 0, bankroll: startingBankroll, bet: false }];
  let bankroll = startingBankroll;
  let betsPlaced = 0;
  let betsWon = 0;
  let peak = startingBankroll;
  let maxDrawdown = 0;

  rows.forEach((row, i) => {
    const pSide = row.pHome >= 0.5 ? row.pHome : 1 - row.pHome;
    const won = row.pHome >= 0.5 ? row.homeWin === 1 : row.homeWin === 0;
    const hasEdge = bankroll > 0 && expectancy(pSide, b) > 0;

    let stake = 0;
    if (hasEdge) {
      const desired =
        strategy === "flat"
          ? Math.min(flatFraction * startingBankroll, bankroll)
          : recommendedStake(pSide, b, bankroll, FRACTIONAL_MULTIPLIER[strategy]);
      stake = Math.min(desired, maxStakeFraction * bankroll);
    }

    if (stake > 0) {
      betsPlaced++;
      if (won) {
        betsWon++;
        bankroll += stake * b;
      } else {
        bankroll -= stake;
      }
    }

    peak = Math.max(peak, bankroll);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - bankroll) / peak);

    path.push({ step: i + 1, bankroll, bet: stake > 0 });
  });

  return {
    path,
    betsPlaced,
    betsWon,
    finalBankroll: bankroll,
    maxDrawdown,
  };
}
