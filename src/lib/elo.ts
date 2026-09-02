/**
 * Elo rating engine (Phase 4 feature engineering).
 *
 * Produces a genuinely *pregame* feature — each team's rating going into a
 * game reflects only games that happened before it — from nothing but raw
 * final scores. This is what makes it usable as a training feature for the
 * probability model without leaking the outcome it's trying to predict.
 */

export interface Game {
  date: string; // ISO yyyy-mm-dd
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  neutral: boolean;
}

export interface EloOptions {
  kFactor: number;
  initialRating: number;
  /** Elo points added to the home team's rating when the game isn't at a neutral site. */
  homeAdvantage: number;
}

export const DEFAULT_ELO_OPTIONS: EloOptions = {
  kFactor: 20,
  initialRating: 1500,
  homeAdvantage: 65,
};

export interface EloGameRecord {
  date: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  /** Team ratings as they stood BEFORE this game (no leakage). */
  homeEloPre: number;
  awayEloPre: number;
  /** Home rating (with home-field bonus folded in) minus away rating. */
  eloDiff: number;
  /** 1 if the home team won, 0 if the away team won. Ties are dropped upstream. */
  homeWin: 0 | 1;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** (-(ratingA - ratingB) / 400));
}

export interface EloRun {
  records: EloGameRecord[];
  /** Every team's rating after the last game it played in the input. */
  finalRatings: Map<string, number>;
}

/**
 * Replays games in chronological order, updating a running Elo rating per
 * team. Returns one record per decisive (non-tied) game carrying the
 * pregame ratings and the eventual outcome, plus the final rating for every
 * team once all games have been replayed (useful for predicting a future
 * matchup that isn't in the input at all).
 */
export function runElo(games: Game[], options: EloOptions = DEFAULT_ELO_OPTIONS): EloRun {
  const ratings = new Map<string, number>();
  const rating = (team: string) => ratings.get(team) ?? options.initialRating;

  const records: EloGameRecord[] = [];

  for (const game of games) {
    const homeEloPre = rating(game.homeTeam);
    const awayEloPre = rating(game.awayTeam);
    const homeAdv = game.neutral ? 0 : options.homeAdvantage;

    const expectedHome = expectedScore(homeEloPre + homeAdv, awayEloPre);

    if (game.homeScore !== game.awayScore) {
      const homeWin: 0 | 1 = game.homeScore > game.awayScore ? 1 : 0;
      records.push({
        date: game.date,
        season: game.season,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeEloPre,
        awayEloPre,
        eloDiff: homeEloPre + homeAdv - awayEloPre,
        homeWin,
      });
      const actualHome = homeWin;
      const delta = options.kFactor * (actualHome - expectedHome);
      ratings.set(game.homeTeam, homeEloPre + delta);
      ratings.set(game.awayTeam, awayEloPre - delta);
    } else {
      // Tie: update ratings toward 0.5 but emit no training record (no
      // binary win/loss label to learn from).
      const delta = options.kFactor * (0.5 - expectedHome);
      ratings.set(game.homeTeam, homeEloPre + delta);
      ratings.set(game.awayTeam, awayEloPre - delta);
    }
  }

  return { records, finalRatings: ratings };
}

/** Convenience wrapper for callers that only need the per-game training records. */
export function computeEloDataset(games: Game[], options: EloOptions = DEFAULT_ELO_OPTIONS): EloGameRecord[] {
  return runElo(games, options).records;
}
