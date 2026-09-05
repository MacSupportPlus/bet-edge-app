/**
 * Model-implied spread and total — informational estimates, not a betting
 * signal. Measured against real historical market lines (the same betting
 * archive used for the Probability Model's backtest) before shipping this:
 *
 *   Spread: a simple linear fit of margin-of-victory against Elo
 *   difference averaged 8 points away from 8,142 real historical Vegas
 *   spreads (sometimes 10-15+ on an individual game) — real books price in
 *   injuries, weather, and situational factors this never sees. Show it as
 *   context, never as if it competes with an actual line.
 *
 *   Total: a team's own season scoring average (points scored + points
 *   allowed) averaged 4 points away from 15,160 real historical market
 *   totals, with no systematic bias — looser than a real book, but a
 *   genuinely useful directional estimate.
 *
 * Neither has a cover-probability or edge calculation attached (unlike the
 * moneyline pipeline) — the spread figure specifically isn't accurate
 * enough to responsibly frame as a bet recommendation.
 */

import { EloGameRecord, EloHistoryPoint } from "./elo";

export interface MarginModel {
  intercept: number;
  slope: number;
}

/** Fits margin-of-victory (home score minus away score) as a linear function of Elo difference, via ordinary least squares. */
export function fitMarginModel(records: Pick<EloGameRecord, "eloDiff" | "margin">[]): MarginModel {
  const n = records.length;
  if (n === 0) return { intercept: 0, slope: 0 };
  const meanX = records.reduce((s, r) => s + r.eloDiff, 0) / n;
  const meanY = records.reduce((s, r) => s + r.margin, 0) / n;
  let num = 0;
  let den = 0;
  for (const r of records) {
    num += (r.eloDiff - meanX) * (r.margin - meanY);
    den += (r.eloDiff - meanX) ** 2;
  }
  const slope = den > 1e-9 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

/** Predicted home-minus-away margin for a given Elo difference (positive = home favored). */
export function predictMargin(model: MarginModel, eloDiff: number): number {
  return model.intercept + model.slope * eloDiff;
}

/** "Ohio State -14.0" style spread string, favored team first. */
export function formatSpread(homeTeam: string, awayTeam: string, predictedMargin: number): string {
  const favored = predictedMargin >= 0 ? homeTeam : awayTeam;
  return `${favored} -${Math.abs(predictedMargin).toFixed(1)}`;
}

export interface ScoringAverage {
  pointsFor: number;
  pointsAgainst: number;
}

/** A team's season-to-date scoring average (points for and against), from its Elo rating history — needs no team-stats archive, works for any sport/season. */
export function seasonScoringAverage(history: EloHistoryPoint[] | undefined, season: number): ScoringAverage | null {
  const games = history?.filter((g) => g.season === season) ?? [];
  if (games.length === 0) return null;
  return {
    pointsFor: games.reduce((s, g) => s + g.pointsFor, 0) / games.length,
    pointsAgainst: games.reduce((s, g) => s + g.pointsAgainst, 0) / games.length,
  };
}

/** Predicted combined total, from both teams' season scoring averages. */
export function predictTotal(home: ScoringAverage, away: ScoringAverage): number {
  return (home.pointsFor + home.pointsAgainst + away.pointsFor + away.pointsAgainst) / 2;
}
