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

import { removeVig } from "./devig";
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
  /** The market's fair (vig-removed) implied probability for this side — see devig.ts. Used only for the trust guardrails below, never for the bet's own EV/stake math, which correctly uses the real (vigged) payout odds via `b`. */
  marketImplied: number;
  /** How much more confident the model is than the market's fair probability, in probability points (can be negative). */
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
  const { fairHome, fairAway } = removeVig(impliedProbability(homeMoneyline), impliedProbability(awayMoneyline));

  if (homeSummary.expectancy >= awaySummary.expectancy) {
    return {
      side: "home",
      team: homeTeam,
      moneyline: homeMoneyline,
      b: bHome,
      summary: homeSummary,
      marketImplied: fairHome,
      disagreement: homeSummary.p - fairHome,
    };
  }
  return {
    side: "away",
    team: awayTeam,
    moneyline: awayMoneyline,
    b: bAway,
    summary: awaySummary,
    marketImplied: fairAway,
    disagreement: awaySummary.p - fairAway,
  };
}

/** The shape classifyPick actually needs — deliberately smaller than PickResult so any two-sided market priced independently on each side (props' over/under, not just moneyline home/away) can reuse the exact same trust/edge pipeline via pickOverUnder below. */
export interface Classifiable {
  b: number;
  summary: EdgeSummary;
  marketImplied: number;
  disagreement: number;
}

export type GameClassification<T extends Classifiable = PickResult> =
  | { status: "edge"; pick: T; stake: number }
  | { status: "flagged"; pick: T }
  | { status: "no-edge" };

/**
 * Classifies a pick as a trustworthy edge, a flagged large-disagreement
 * case, or no edge at all. Only "edge" should ever be presented as a bet
 * recommendation.
 */
export function classifyPick<T extends Classifiable>(
  pick: T,
  currentBankroll: number,
  fractionalMultiplier: number,
  maxDisagreement = MAX_TRUSTED_DISAGREEMENT,
  maxRatio = MAX_TRUSTED_RATIO,
): GameClassification<T> {
  if (!pick.summary.hasEdge) return { status: "no-edge" };
  const ratio = pick.marketImplied > 0 ? pick.summary.p / pick.marketImplied : Infinity;
  if (pick.disagreement > maxDisagreement || ratio > maxRatio) return { status: "flagged", pick };
  const stake = recommendedStake(pick.summary.p, pick.b, currentBankroll, fractionalMultiplier);
  return { status: "edge", pick, stake };
}

export interface OverUnderPickResult {
  side: "over" | "under";
  b: number;
  summary: EdgeSummary;
  marketImplied: number;
  disagreement: number;
}

/**
 * Same edge-picking logic as pickSide, generalized to any market with an
 * "over" and "under" side priced independently (player props' yardage/
 * receptions lines) instead of a home/away team. `pOver` is the model's
 * probability of the OVER hitting.
 */
export function pickOverUnder(pOver: number, overOdds: number, underOdds: number): OverUnderPickResult {
  const bOver = moneylineToDecimalB(overOdds);
  const bUnder = moneylineToDecimalB(underOdds);
  const overSummary = summarizeEdge(pOver, bOver);
  const underSummary = summarizeEdge(1 - pOver, bUnder);
  const { fairHome: fairOver, fairAway: fairUnder } = removeVig(impliedProbability(overOdds), impliedProbability(underOdds));

  if (overSummary.expectancy >= underSummary.expectancy) {
    return { side: "over", b: bOver, summary: overSummary, marketImplied: fairOver, disagreement: overSummary.p - fairOver };
  }
  return { side: "under", b: bUnder, summary: underSummary, marketImplied: fairUnder, disagreement: underSummary.p - fairUnder };
}
