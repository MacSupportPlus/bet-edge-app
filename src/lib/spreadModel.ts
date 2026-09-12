/**
 * Model-implied spread and total. Measured against real historical market
 * lines (the same betting archive used for the Probability Model's
 * backtest) before shipping this:
 *
 *   Spread: a simple linear fit of margin-of-victory against Elo
 *   difference averaged 8 points away from 8,142 real historical Vegas
 *   spreads (sometimes 10-15+ on an individual game) — real books price in
 *   injuries, weather, and situational factors this never sees.
 *
 *   Total: a team's own season scoring average (points scored + points
 *   allowed) averaged 4 points away from 15,160 real historical market
 *   totals, with no systematic bias — looser than a real book, but a
 *   genuinely useful directional estimate.
 *
 * Both point estimates carry real, sizeable error — the honest way to turn
 * either into a bet recommendation isn't to pretend the number itself is
 * precise, but to treat (actual − predicted) as roughly normal with a
 * calibrated standard deviation (residualStdDev, fit from the same
 * historical residuals that produced the "8 points"/"4 points" figures
 * above) and ask how far the LINE sits from that whole distribution
 * (coverProbability/overProbability). A model this uncertain will only
 * produce a probability far from 50/50 when its prediction and the market's
 * line disagree by a lot — which is the correct, honest behavior, and lets
 * this feed the same summarizeEdge/classifyPick pipeline (scanner.ts) the
 * moneyline pipeline already uses.
 */

import { EloGameRecord, EloHistoryPoint, Game } from "./elo";

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

interface PredictedActual {
  predicted: number;
  actual: number;
}

/** This team's own games, in chronological order, across every season — the base a running season-to-date average is built from. */
function gamesInvolving(games: Game[], team: string): Game[] {
  return games.filter((g) => g.homeTeam === team || g.awayTeam === team).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** This team's scoring average using only ITS OWN games strictly before each game it played, keyed by game object identity — a proper walk-forward season-to-date average, not the final/full-season one `seasonScoringAverage` gives for a live (still-in-progress) prediction. */
function priorScoringAverages(games: Game[], team: string): Map<Game, { average: ScoringAverage; n: number }> {
  const result = new Map<Game, { average: ScoringAverage; n: number }>();
  const runningBySeason = new Map<number, { sumFor: number; sumAgainst: number; n: number }>();
  for (const g of gamesInvolving(games, team)) {
    const isHome = g.homeTeam === team;
    const pointsFor = isHome ? g.homeScore : g.awayScore;
    const pointsAgainst = isHome ? g.awayScore : g.homeScore;
    const running = runningBySeason.get(g.season) ?? { sumFor: 0, sumAgainst: 0, n: 0 };
    result.set(g, { average: { pointsFor: running.n > 0 ? running.sumFor / running.n : 0, pointsAgainst: running.n > 0 ? running.sumAgainst / running.n : 0 }, n: running.n });
    runningBySeason.set(g.season, { sumFor: running.sumFor + pointsFor, sumAgainst: running.sumAgainst + pointsAgainst, n: running.n + 1 });
  }
  return result;
}

/**
 * Walk-forward (no-leakage) total-points residuals across the WHOLE
 * historical archive: for every game where both teams already have
 * `minPriorGames` games on file that season, predicts the total from only
 * what was known BEFORE that game, then compares to the real final total —
 * the same discipline qbValue.ts/playerProjection.ts use, applied to
 * spreadModel.ts's total for the first time (the point-estimate model
 * itself already existed; this is what makes its accuracy claim
 * walk-forward rather than in-sample).
 */
export function historicalTotalResiduals(games: Game[], minPriorGames = 3): PredictedActual[] {
  const teams = new Set<string>();
  for (const g of games) {
    teams.add(g.homeTeam);
    teams.add(g.awayTeam);
  }
  const priorByTeam = new Map<string, ReturnType<typeof priorScoringAverages>>();
  for (const t of teams) priorByTeam.set(t, priorScoringAverages(games, t));

  const out: PredictedActual[] = [];
  for (const g of games) {
    const homePrior = priorByTeam.get(g.homeTeam)?.get(g);
    const awayPrior = priorByTeam.get(g.awayTeam)?.get(g);
    if (!homePrior || !awayPrior || homePrior.n < minPriorGames || awayPrior.n < minPriorGames) continue;
    out.push({ predicted: predictTotal(homePrior.average, awayPrior.average), actual: g.homeScore + g.awayScore });
  }
  return out;
}

/** Population standard deviation of (actual - predicted) over a set of predictions — how far off this model typically runs, in the same units as its point estimate. */
export function residualStdDev(records: { predicted: number; actual: number }[]): number {
  const n = records.length;
  if (n === 0) return 0;
  const residuals = records.map((r) => r.actual - r.predicted);
  const mean = residuals.reduce((s, r) => s + r, 0) / n;
  const variance = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

/** Standard normal CDF via the Abramowitz & Stegun erf approximation (max error ~1.5e-7) — no stats-library dependency, matching this app's from-scratch approach elsewhere (logisticRegression.ts, elo.ts). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability the HOME side covers `spreadLine` (nflverse's convention:
 * positive = home favored, lines up with actual margin = homeScore -
 * awayScore — see gameContext.ts), modeling actual margin as
 * Normal(predictedMargin, sigma^2). Home covers iff actualMargin >
 * spreadLine; a sigma of 0 (or a fitted model with no data) falls back to a
 * plain point-estimate comparison instead of dividing by zero.
 */
export function coverProbability(predictedMargin: number, spreadLine: number, sigma: number): number {
  if (sigma <= 0) return predictedMargin > spreadLine ? 1 : 0;
  return 1 - normalCdf((spreadLine - predictedMargin) / sigma);
}

/** Probability the total goes OVER `totalLine`, modeling the actual total as Normal(predictedTotal, sigma^2) — same idea as coverProbability. */
export function overProbability(predictedTotal: number, totalLine: number, sigma: number): number {
  if (sigma <= 0) return predictedTotal > totalLine ? 1 : 0;
  return 1 - normalCdf((totalLine - predictedTotal) / sigma);
}

/**
 * Distribution-free alternative to coverProbability/overProbability:
 * instead of assuming (actual - predicted) is Normal, directly counts what
 * fraction of REAL held-out residuals would have cleared this line — the
 * split-conformal idea (calibrate quantiles from held-out residuals rather
 * than a fitted parametric shape) applied as a probability rather than a
 * fixed-coverage interval. Captures real skew a Normal assumption can't —
 * e.g. playerProjection.ts's disclosed rushing skew (44.4% of games beat
 * the trailing mean, not 50%) shows up here automatically, with no
 * separate skew correction needed. Falls back to the Normal estimate below
 * `MIN_RESIDUALS_FOR_EMPIRICAL` residuals, where an empirical quantile
 * would itself be too noisy to trust.
 */
export const MIN_RESIDUALS_FOR_EMPIRICAL = 50;

function empiricalProbabilityAbove(predicted: number, line: number, residuals: number[]): number {
  const threshold = line - predicted;
  const above = residuals.filter((r) => r > threshold).length;
  return above / residuals.length;
}

/** Empirical (conformal-style) version of coverProbability — see empiricalProbabilityAbove. `residuals` are (actual margin - predicted margin) from historicalTotalResiduals-style held-out data, NOT the same games being predicted now. */
export function empiricalCoverProbability(predictedMargin: number, spreadLine: number, residuals: number[], sigma: number): number {
  if (residuals.length < MIN_RESIDUALS_FOR_EMPIRICAL) return coverProbability(predictedMargin, spreadLine, sigma);
  return empiricalProbabilityAbove(predictedMargin, spreadLine, residuals);
}

/** Empirical (conformal-style) version of overProbability — see empiricalProbabilityAbove. */
export function empiricalOverProbability(predictedTotal: number, totalLine: number, residuals: number[], sigma: number): number {
  if (residuals.length < MIN_RESIDUALS_FOR_EMPIRICAL) return overProbability(predictedTotal, totalLine, sigma);
  return empiricalProbabilityAbove(predictedTotal, totalLine, residuals);
}

export interface ConformalInterval {
  lower: number;
  upper: number;
  coverage: number;
}

/**
 * Split-conformal prediction interval at the requested coverage (e.g. 0.8
 * for an 80% interval): the empirical (coverage)-quantile band of held-out
 * residuals, added to the point estimate — distribution-free, so it
 * widens/skews correctly for a right-skewed stat instead of forcing a
 * symmetric Normal band around the mean. Uses the standard finite-sample
 * conformal index ceil((n+1) * q) so small calibration sets slightly
 * over-cover rather than under-cover (the safe direction to round).
 */
export function conformalInterval(predicted: number, residuals: number[], coverage: number): ConformalInterval {
  if (residuals.length === 0) return { lower: predicted, upper: predicted, coverage };
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const alpha = 1 - coverage;
  const clampIdx = (i: number) => Math.min(n - 1, Math.max(0, i));
  const lowerIdx = clampIdx(Math.ceil((alpha / 2) * (n + 1)) - 1);
  const upperIdx = clampIdx(Math.ceil((1 - alpha / 2) * (n + 1)) - 1);
  return { lower: predicted + sorted[lowerIdx], upper: predicted + sorted[upperIdx], coverage };
}
