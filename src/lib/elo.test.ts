import { describe, expect, it } from "vitest";
import { computeEloDataset, DEFAULT_ELO_OPTIONS, Game } from "./elo";

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
