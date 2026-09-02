import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { computeTeamStatDiffs, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "./teamStats";

function game(overrides: Partial<Game>): Game {
  return {
    gameId: "g1",
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

function stat(overrides: Partial<TeamGameStat>): TeamGameStat {
  return { gameId: "g1", team: "HOME", totalYards: 300, turnoverMargin: 0, offEpa: 0, ...overrides };
}

describe("computeTeamStatDiffs", () => {
  it("has no prior data for a team's first game of the season (neutral features)", () => {
    const games = [game({})];
    const stats = [stat({ team: "HOME", totalYards: 400 }), stat({ team: "AWAY", totalYards: 300 })];
    const result = computeTeamStatDiffs(games, stats);
    expect(result.get("g1")).toEqual(NEUTRAL_TEAM_STAT_FEATURES);
  });

  it("uses only PRIOR games (no leakage) when computing a team's rolling average", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-01-08", homeTeam: "A", awayTeam: "C" }),
    ];
    const stats: TeamGameStat[] = [
      stat({ gameId: "g1", team: "A", totalYards: 500, turnoverMargin: 2, offEpa: 1 }),
      stat({ gameId: "g1", team: "B", totalYards: 200, turnoverMargin: -2, offEpa: -1 }),
      stat({ gameId: "g2", team: "A", totalYards: 300, turnoverMargin: 0, offEpa: 0 }),
      stat({ gameId: "g2", team: "C", totalYards: 250, turnoverMargin: 0, offEpa: 0 }),
    ];
    const result = computeTeamStatDiffs(games, stats);
    // g1: neither team has played yet this season.
    expect(result.get("g1")).toEqual(NEUTRAL_TEAM_STAT_FEATURES);
    // g2: A's PRE-game average reflects only g1 (500 yards), C is brand new (0).
    expect(result.get("g2")).toEqual({ totalYardsDiff: 500, turnoverMarginDiff: 2, offEpaDiff: 1 });
  });

  it("averages across multiple prior games, not just the most recent one", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2024-01-01", homeTeam: "A", awayTeam: "X" }),
      game({ gameId: "g2", date: "2024-01-08", homeTeam: "A", awayTeam: "X" }),
      game({ gameId: "g3", date: "2024-01-15", homeTeam: "A", awayTeam: "Y" }),
    ];
    const stats: TeamGameStat[] = [
      stat({ gameId: "g1", team: "A", totalYards: 400 }),
      stat({ gameId: "g1", team: "X", totalYards: 100 }),
      stat({ gameId: "g2", team: "A", totalYards: 200 }),
      stat({ gameId: "g2", team: "X", totalYards: 100 }),
      stat({ gameId: "g3", team: "A", totalYards: 999 }),
      stat({ gameId: "g3", team: "Y", totalYards: 999 }),
    ];
    const result = computeTeamStatDiffs(games, stats);
    // Going into g3, A's average over g1+g2 is (400+200)/2 = 300; Y is brand new (0).
    expect(result.get("g3")!.totalYardsDiff).toBe(300);
  });

  it("resets a team's running average at the start of a new season", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2023-12-01", season: 2023, homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-09-01", season: 2024, homeTeam: "A", awayTeam: "C" }),
    ];
    const stats: TeamGameStat[] = [
      stat({ gameId: "g1", team: "A", totalYards: 900 }),
      stat({ gameId: "g1", team: "B", totalYards: 100 }),
      stat({ gameId: "g2", team: "A", totalYards: 250 }),
      stat({ gameId: "g2", team: "C", totalYards: 250 }),
    ];
    const result = computeTeamStatDiffs(games, stats);
    // A's huge 2023 total should not leak into its 2024 season-opener average.
    expect(result.get("g2")).toEqual(NEUTRAL_TEAM_STAT_FEATURES);
  });

  it("skips games with no gameId (e.g. CFB, which has no stats archive)", () => {
    const games: Game[] = [game({ gameId: undefined })];
    const result = computeTeamStatDiffs(games, []);
    expect(result.size).toBe(0);
  });

  it("is deterministic for the same input", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-01-08", homeTeam: "B", awayTeam: "A" }),
    ];
    const stats: TeamGameStat[] = [
      stat({ gameId: "g1", team: "A", totalYards: 350 }),
      stat({ gameId: "g1", team: "B", totalYards: 280 }),
    ];
    expect(computeTeamStatDiffs(games, stats)).toEqual(computeTeamStatDiffs(games, stats));
  });
});
