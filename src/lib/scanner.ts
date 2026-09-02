/**
 * Turns a model probability + live odds into a bet recommendation — and,
 * critically, decides when NOT to trust the model.
 *
 * A single-feature Elo/logistic model can be reasonably calibrated ON
 * AVERAGE (see the Probability Model tab's reliability diagram) while still
 * being badly wrong on individual extreme mismatches: the historical
 * training data has relatively few truly lopsided games, so the fitted
 * slope is dominated by competitive games and doesn't necessarily curve
 * sharply enough at the tails. In practice this shows up as the model
 * confidently disagreeing with a professionally-priced market by 40-80
 * points on "buy game" blowouts — which is far more likely to mean the
 * MODEL is wrong than that real money is being left on the table. A big
 * gap from the market is treated as a red flag, not an opportunity.
 */

import { EdgeSummary, recommendedStake, summarizeEdge } from "./edge";
import { impliedProbability, moneylineToDecimalB } from "./espn";

/** Max trusted gap (model p minus market-implied p) before a "positive EV" pick gets flagged instead of recommended. */
export const MAX_TRUSTED_DISAGREEMENT = 0.15;

/**
 * Max trusted RATIO of model p to market-implied p. A point-gap cap alone
 * isn't enough: near the extremes (a heavy underdog priced at 2%), even a
 * modest absolute gap represents an enormous relative disagreement — the
 * model claiming a team is 5x more likely to win than the market thinks.
 * Both checks have to pass for a pick to be trusted.
 */
export const MAX_TRUSTED_RATIO = 2;

export interface PickResult {
  side: "home" | "away";
  team: string;
  moneyline: number;
  b: number;
  summary: EdgeSummary;
  marketImplied: number;
  /** How much more confident the model is than the market, in probability points (can be negative). */
  disagreement: number;
}

/** Picks whichever side (home/away) has the better expectancy against the posted odds. */
export function pickSide(
  pHome: number,
  homeMoneyline: number,
  awayMoneyline: number,
  homeTeam: string,
  awayTeam: string,
): PickResult {
  const bHome = moneylineToDecimalB(homeMoneyline);
  const bAway = moneylineToDecimalB(awayMoneyline);
  const homeSummary = summarizeEdge(pHome, bHome);
  const awaySummary = summarizeEdge(1 - pHome, bAway);

  if (homeSummary.expectancy >= awaySummary.expectancy) {
    const marketImplied = impliedProbability(homeMoneyline);
    return {
      side: "home",
      team: homeTeam,
      moneyline: homeMoneyline,
      b: bHome,
      summary: homeSummary,
      marketImplied,
      disagreement: homeSummary.p - marketImplied,
    };
  }
  const marketImplied = impliedProbability(awayMoneyline);
  return {
    side: "away",
    team: awayTeam,
    moneyline: awayMoneyline,
    b: bAway,
    summary: awaySummary,
    marketImplied,
    disagreement: awaySummary.p - marketImplied,
  };
}

export type GameClassification =
  | { status: "edge"; pick: PickResult; stake: number }
  | { status: "flagged"; pick: PickResult }
  | { status: "no-edge" };

/**
 * Classifies a pick as a trustworthy edge, a flagged large-disagreement
 * case, or no edge at all. Only "edge" should ever be presented as a bet
 * recommendation.
 */
export function classifyPick(
  pick: PickResult,
  currentBankroll: number,
  fractionalMultiplier: number,
  maxDisagreement = MAX_TRUSTED_DISAGREEMENT,
  maxRatio = MAX_TRUSTED_RATIO,
): GameClassification {
  if (!pick.summary.hasEdge) return { status: "no-edge" };
  const ratio = pick.marketImplied > 0 ? pick.summary.p / pick.marketImplied : Infinity;
  if (pick.disagreement > maxDisagreement || ratio > maxRatio) return { status: "flagged", pick };
  const stake = recommendedStake(pick.summary.p, pick.b, currentBankroll, fractionalMultiplier);
  return { status: "edge", pick, stake };
}
