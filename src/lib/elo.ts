/**
 * Elo rating engine (Phase 4 feature engineering).
 *
 * Produces a genuinely *pregame* feature — each team's rating going into a
 * game reflects only games that happened before it — from nothing but raw
 * final scores. This is what makes it usable as a training feature for the
 * probability model without leaking the outcome it's trying to predict.
 */

export interface Game {
  /** nflverse's per-game id (e.g. "2024_01_KC_BAL"). Undefined for CFB, which has no per-game stats archive to join against. */
  gameId?: string;
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
  /**
   * Fraction (0-1) to pull a team's rating back toward `initialRating` the
   * first time it's read in a season it hasn't played in yet — models real
   * roster turnover between seasons instead of carrying last year's exact
   * strength untouched into a new one. 0 = no pull (default; matches
   * pre-existing behavior). Most useful for college football, where the
   * roster turns over far more than the pros.
   */
  seasonRegression?: number;
}

export const DEFAULT_ELO_OPTIONS: EloOptions = {
  kFactor: 20,
  initialRating: 1500,
  homeAdvantage: 65,
  // 0.35 measured best on real CFB history (This Week's only consumer of
  // this constant): overall Brier 0.1836 -> 0.1773. It does NOT specifically
  // help week-1-type games — the early-season slice of that same test
  // actually calibrates very slightly worse as this goes up — so treat it as
  // a general accuracy tune, not an opening-week fix.
  seasonRegression: 0.35,
};

export interface EloGameRecord {
  gameId?: string;
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
  /** Home score minus away score — the actual margin, for fitting a spread estimate against eloDiff. */
  margin: number;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** (-(ratingA - ratingB) / 400));
}

export interface EloHistoryPoint {
  gameId?: string;
  date: string;
  season: number;
  opponent: string;
  isHome: boolean;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
  /** This team's rating AFTER this game (post-game, includes the K-factor update). */
  ratingAfter: number;
  /** The opponent's rating BEFORE this game — strength of schedule, made visible instead of only baked into the number. */
  opponentRatingBefore: number;
}

export interface EloRun {
  records: EloGameRecord[];
  /** Every team's rating after the last game it played in the input. */
  finalRatings: Map<string, number>;
  /** Every team's full game-by-game rating trajectory, in chronological order — for rating-trend charts and recent-form lookups. */
  ratingHistory: Map<string, EloHistoryPoint[]>;
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
  const lastSeasonPlayed = new Map<string, number>();
  const regression = options.seasonRegression ?? 0;

  // Reads a team's current rating, lazily pulling it back toward
  // initialRating the first time (and only the first time) it's read in a
  // season it hasn't played in yet.
  const rating = (team: string, season: number) => {
    let r = ratings.get(team) ?? options.initialRating;
    const last = lastSeasonPlayed.get(team);
    if (regression > 0 && last !== undefined && last !== season) {
      r = r + (options.initialRating - r) * regression;
      ratings.set(team, r);
    }
    lastSeasonPlayed.set(team, season);
    return r;
  };

  const records: EloGameRecord[] = [];
  const ratingHistory = new Map<string, EloHistoryPoint[]>();
  const pushHistory = (team: string, point: EloHistoryPoint) => {
    const list = ratingHistory.get(team);
    if (list) list.push(point);
    else ratingHistory.set(team, [point]);
  };

  for (const game of games) {
    const homeEloPre = rating(game.homeTeam, game.season);
    const awayEloPre = rating(game.awayTeam, game.season);
    const homeAdv = game.neutral ? 0 : options.homeAdvantage;

    const expectedHome = expectedScore(homeEloPre + homeAdv, awayEloPre);

    const result: "W" | "L" | "T" = game.homeScore === game.awayScore ? "T" : game.homeScore > game.awayScore ? "W" : "L";
    const delta =
      game.homeScore === game.awayScore
        ? options.kFactor * (0.5 - expectedHome)
        : options.kFactor * ((game.homeScore > game.awayScore ? 1 : 0) - expectedHome);
    const homeRatingAfter = homeEloPre + delta;
    const awayRatingAfter = awayEloPre - delta;

    if (game.homeScore !== game.awayScore) {
      const homeWin: 0 | 1 = game.homeScore > game.awayScore ? 1 : 0;
      records.push({
        gameId: game.gameId,
        date: game.date,
        season: game.season,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeEloPre,
        awayEloPre,
        eloDiff: homeEloPre + homeAdv - awayEloPre,
        homeWin,
        margin: game.homeScore - game.awayScore,
      });
    }

    pushHistory(game.homeTeam, {
      gameId: game.gameId,
      date: game.date,
      season: game.season,
      opponent: game.awayTeam,
      isHome: true,
      pointsFor: game.homeScore,
      pointsAgainst: game.awayScore,
      result,
      ratingAfter: homeRatingAfter,
      opponentRatingBefore: awayEloPre,
    });
    pushHistory(game.awayTeam, {
      gameId: game.gameId,
      date: game.date,
      season: game.season,
      opponent: game.homeTeam,
      isHome: false,
      pointsFor: game.awayScore,
      pointsAgainst: game.homeScore,
      opponentRatingBefore: homeEloPre,
      result: result === "W" ? "L" : result === "L" ? "W" : "T",
      ratingAfter: awayRatingAfter,
    });

    ratings.set(game.homeTeam, homeRatingAfter);
    ratings.set(game.awayTeam, awayRatingAfter);
  }

  return { records, finalRatings: ratings, ratingHistory };
}

/** Convenience wrapper for callers that only need the per-game training records. */
export function computeEloDataset(games: Game[], options: EloOptions = DEFAULT_ELO_OPTIONS): EloGameRecord[] {
  return runElo(games, options).records;
}
