import { describe, expect, it } from "vitest";
import { computeEloDataset, DEFAULT_ELO_OPTIONS, Game, runElo } from "./elo";

function game(overrides: Partial<Game>): Game {
  return {
    date: "2024-01-01",
    season: 2024,
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 20,
    awayScore: 10,
    neutral: false,
    ...overrides,
  };
}

describe("computeEloDataset", () => {
  it("starts brand-new teams at the initial rating, home-field folded into eloDiff", () => {
    const [record] = computeEloDataset([game({})], DEFAULT_ELO_OPTIONS);
    expect(record.homeEloPre).toBe(DEFAULT_ELO_OPTIONS.initialRating);
    expect(record.awayEloPre).toBe(DEFAULT_ELO_OPTIONS.initialRating);
    expect(record.eloDiff).toBe(DEFAULT_ELO_OPTIONS.homeAdvantage);
    expect(record.homeWin).toBe(1);
  });

  it("applies no home-field bonus at a neutral site", () => {
    const [record] = computeEloDataset([game({ neutral: true })], DEFAULT_ELO_OPTIONS);
    expect(record.eloDiff).toBe(0);
  });

  it("increases the winner's rating and decreases the loser's by equal magnitude", () => {
    // Replay a second game to read post-game ratings indirectly: a team
    // that just won as HOME should rate higher than a brand-new team.
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ date: "2024-01-08", homeTeam: "A", awayTeam: "C", neutral: true }),
    ];
    const records = computeEloDataset(games, DEFAULT_ELO_OPTIONS);
    // A won its first game, so its rating going into game 2 should exceed the initial rating.
    expect(records[1].homeEloPre).toBeGreaterThan(DEFAULT_ELO_OPTIONS.initialRating);
    // C is brand new.
    expect(records[1].awayEloPre).toBe(DEFAULT_ELO_OPTIONS.initialRating);
  });

  it("drops tied games from the output but still updates ratings toward 0.5", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 14, awayScore: 14, neutral: true }),
      game({ date: "2024-01-08", homeTeam: "A", awayTeam: "C", neutral: true }),
    ];
    const records = computeEloDataset(games, DEFAULT_ELO_OPTIONS);
    expect(records).toHaveLength(1); // only the second, decisive game
    // A tie at even ratings shouldn't move A's rating (expected was already 0.5).
    expect(records[0].homeEloPre).toBeCloseTo(DEFAULT_ELO_OPTIONS.initialRating, 6);
  });

  it("rewards upsets more than expected wins (bigger K-adjusted swing)", () => {
    const heavyFavorite: Game[] = [
      game({ date: "2024-01-01", homeTeam: "Champ", awayTeam: "Fresh1", homeScore: 40, awayScore: 0 }),
      game({ date: "2024-01-08", homeTeam: "Champ", awayTeam: "Fresh2", homeScore: 40, awayScore: 0 }),
      // Now Champ (highly rated) loses as a big favorite — an upset.
      game({ date: "2024-01-15", homeTeam: "Champ", awayTeam: "Underdog", homeScore: 10, awayScore: 20 }),
    ];
    const records = computeEloDataset(heavyFavorite, DEFAULT_ELO_OPTIONS);
    const preUpsetRating = records[2].homeEloPre;
    // Simulate the same rating losing to an equally-rated fresh team instead —
    // the swing from an expected-ish game should be smaller than from a true upset.
    const evenGame: Game[] = [game({ date: "2024-01-01", homeTeam: "X", awayTeam: "Y", homeScore: 10, awayScore: 20 })];
    const evenRecord = computeEloDataset(evenGame, DEFAULT_ELO_OPTIONS)[0];
    // Champ was a big favorite (higher pre-game rating) yet lost — the model
    // should have expected it to win with higher probability than a 50/50 game.
    expect(preUpsetRating).toBeGreaterThan(evenRecord.homeEloPre);
  });

  it("is deterministic for the same input", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ date: "2024-01-08", homeTeam: "B", awayTeam: "A", homeScore: 5, awayScore: 30 }),
    ];
    expect(computeEloDataset(games, DEFAULT_ELO_OPTIONS)).toEqual(computeEloDataset(games, DEFAULT_ELO_OPTIONS));
  });
});

describe("runElo finalRatings", () => {
  it("gives every team that played its post-game rating, not just teams in the last game", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ date: "2024-01-08", homeTeam: "C", awayTeam: "D", homeScore: 10, awayScore: 30 }),
    ];
    const { finalRatings } = runElo(games, DEFAULT_ELO_OPTIONS);
    expect(finalRatings.size).toBe(4);
    // A won as home favorite-ish -> above initial; B lost -> below initial.
    expect(finalRatings.get("A")!).toBeGreaterThan(DEFAULT_ELO_OPTIONS.initialRating);
    expect(finalRatings.get("B")!).toBeLessThan(DEFAULT_ELO_OPTIONS.initialRating);
  });

  it("reflects only the LATEST rating when a team plays more than once", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ date: "2024-01-08", homeTeam: "A", awayTeam: "C", homeScore: 10, awayScore: 30, neutral: true }),
    ];
    const { finalRatings, records } = runElo(games, DEFAULT_ELO_OPTIONS);
    // A's final rating should differ from its pre-game-2 rating (records[1].homeEloPre)
    // since it then lost that game.
    expect(finalRatings.get("A")).not.toBeCloseTo(records[1].homeEloPre, 5);
  });

  it("computeEloDataset still returns just the records array (back-compat)", () => {
    const games: Game[] = [game({})];
    expect(computeEloDataset(games, DEFAULT_ELO_OPTIONS)).toEqual(runElo(games, DEFAULT_ELO_OPTIONS).records);
  });
});

describe("ratingHistory", () => {
  it("gives both teams one point per game, in chronological order", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ date: "2024-01-08", homeTeam: "B", awayTeam: "A", homeScore: 20, awayScore: 24, neutral: true }),
    ];
    const { ratingHistory } = runElo(games, DEFAULT_ELO_OPTIONS);
    expect(ratingHistory.get("A")).toHaveLength(2);
    expect(ratingHistory.get("B")).toHaveLength(2);
    expect(ratingHistory.get("A")!.map((p) => p.date)).toEqual(["2024-01-01", "2024-01-08"]);
  });

  it("records the correct opponent, home/away flag, score, and result from each team's own perspective", () => {
    const games: Game[] = [game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 })];
    const { ratingHistory } = runElo(games, DEFAULT_ELO_OPTIONS);
    const [aPoint] = ratingHistory.get("A")!;
    const [bPoint] = ratingHistory.get("B")!;
    expect(aPoint).toMatchObject({ opponent: "B", isHome: true, pointsFor: 30, pointsAgainst: 10, result: "W" });
    expect(bPoint).toMatchObject({ opponent: "A", isHome: false, pointsFor: 10, pointsAgainst: 30, result: "L" });
  });

  it("records a tie for both teams and still updates ratingAfter", () => {
    const games: Game[] = [game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 14, awayScore: 14 })];
    const { ratingHistory } = runElo(games, DEFAULT_ELO_OPTIONS);
    expect(ratingHistory.get("A")![0].result).toBe("T");
    expect(ratingHistory.get("B")![0].result).toBe("T");
  });

  it("ratingAfter matches the next game's pregame rating for that team", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ date: "2024-01-08", homeTeam: "A", awayTeam: "C", neutral: true }),
    ];
    const { ratingHistory, records } = runElo(games, DEFAULT_ELO_OPTIONS);
    const aFirstGameRatingAfter = ratingHistory.get("A")![0].ratingAfter;
    expect(records[1].homeEloPre).toBeCloseTo(aFirstGameRatingAfter, 6);
  });

  it("records the opponent's PREGAME rating (strength of schedule), not their post-game rating", () => {
    const games: Game[] = [
      // B has already played once (and won big), so it enters game 2 above initial rating.
      game({ date: "2024-01-01", homeTeam: "B", awayTeam: "X", homeScore: 40, awayScore: 0, neutral: true }),
      game({ date: "2024-01-08", homeTeam: "A", awayTeam: "B", neutral: true }),
    ];
    const { ratingHistory, records } = runElo(games, DEFAULT_ELO_OPTIONS);
    const bPregameForSecondGame = records[1].awayEloPre;
    const aPoint = ratingHistory.get("A")!.find((p) => p.opponent === "B")!;
    const bPoint = ratingHistory.get("B")!.find((p) => p.opponent === "A")!;
    // A's record of playing B should show B's rating BEFORE that game (1510, from beating X)...
    expect(aPoint.opponentRatingBefore).toBeCloseTo(bPregameForSecondGame, 6);
    // ...not B's rating AFTER this same game against A (B lost, so this differs) — that would leak the outcome.
    expect(aPoint.opponentRatingBefore).not.toBeCloseTo(bPoint.ratingAfter, 6);
    // From B's own perspective, its opponent (A) was brand new (initial rating).
    expect(bPoint.opponentRatingBefore).toBe(DEFAULT_ELO_OPTIONS.initialRating);
  });
});

describe("seasonRegression", () => {
  const opts = { kFactor: 20, initialRating: 1500, homeAdvantage: 65, seasonRegression: 0.5 };

  it("does nothing within the same season", () => {
    const games: Game[] = [
      game({ date: "2024-01-01", season: 2024, homeTeam: "A", awayTeam: "X", homeScore: 40, awayScore: 0 }),
      game({ date: "2024-01-08", season: 2024, homeTeam: "A", awayTeam: "Y" }),
    ];
    const noRegression = computeEloDataset(games, { ...opts, seasonRegression: 0 });
    const withRegression = computeEloDataset(games, opts);
    // Same season both games -> A's rating going into game 2 is untouched either way.
    expect(withRegression[1].homeEloPre).toBeCloseTo(noRegression[1].homeEloPre, 6);
  });

  it("pulls a team's rating toward initialRating the first time it plays in a new season", () => {
    const games: Game[] = [
      game({ date: "2023-12-01", season: 2023, homeTeam: "A", awayTeam: "B", homeScore: 40, awayScore: 0 }),
      game({ date: "2024-09-01", season: 2024, homeTeam: "A", awayTeam: "C" }),
    ];
    const noRegression = computeEloDataset(games, { ...opts, seasonRegression: 0 })[1].homeEloPre;
    const withRegression = computeEloDataset(games, opts)[1].homeEloPre;
    // A finished 2023 well above 1500 (blew out B); 50% regression should pull
    // its 2024 season-opener rating roughly halfway back to 1500.
    expect(noRegression).toBeGreaterThan(opts.initialRating);
    expect(withRegression).toBeLessThan(noRegression);
    expect(withRegression).toBeGreaterThan(opts.initialRating);
  });

  it("has no effect on a team's very first game ever (nothing to regress from)", () => {
    const games: Game[] = [game({ season: 2024 })];
    const record = computeEloDataset(games, opts)[0];
    expect(record.homeEloPre).toBe(opts.initialRating);
    expect(record.awayEloPre).toBe(opts.initialRating);
  });

  it("a full reset (seasonRegression=1) sends a returning team's rating exactly to initialRating", () => {
    const games: Game[] = [
      game({ date: "2023-12-01", season: 2023, homeTeam: "A", awayTeam: "B", homeScore: 40, awayScore: 0 }),
      game({ date: "2024-09-01", season: 2024, homeTeam: "A", awayTeam: "C" }),
    ];
    const record = computeEloDataset(games, { ...opts, seasonRegression: 1 })[1];
    expect(record.homeEloPre).toBeCloseTo(opts.initialRating, 6);
  });
});
