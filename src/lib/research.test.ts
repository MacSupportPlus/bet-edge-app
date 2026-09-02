import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { headToHead, headToHeadRecord, seasonAverage, teamStatTrend } from "./research";
import { TeamGameStat } from "./teamStats";

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

describe("headToHead", () => {
  it("finds meetings regardless of which team was home", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2022-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2023-01-01", homeTeam: "B", awayTeam: "A" }),
      game({ gameId: "g3", date: "2023-06-01", homeTeam: "A", awayTeam: "C" }), // unrelated
    ];
    const result = headToHead(games, "A", "B");
    expect(result).toHaveLength(2);
    expect(result.every((g) => [g.homeTeam, g.awayTeam].includes("A") && [g.homeTeam, g.awayTeam].includes("B"))).toBe(
      true,
    );
  });

  it("sorts most recent first", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2020-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
    ];
    const result = headToHead(games, "A", "B");
    expect(result.map((g) => g.date)).toEqual(["2024-01-01", "2020-01-01"]);
  });

  it("returns an empty list for teams that have never played", () => {
    const games: Game[] = [game({ homeTeam: "A", awayTeam: "B" })];
    expect(headToHead(games, "A", "Z")).toEqual([]);
  });
});

describe("headToHeadRecord", () => {
  it("tallies wins/losses/ties from the given team's perspective", () => {
    const h2h = headToHead(
      [
        game({ gameId: "g1", date: "2022-01-01", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }), // A won
        game({ gameId: "g2", date: "2023-01-01", homeTeam: "B", awayTeam: "A", homeScore: 20, awayScore: 24 }), // A won (away)
        game({ gameId: "g3", date: "2024-01-01", homeTeam: "A", awayTeam: "B", homeScore: 14, awayScore: 21 }), // A lost
        game({ gameId: "g4", date: "2025-01-01", homeTeam: "A", awayTeam: "B", homeScore: 7, awayScore: 7 }), // tie
      ],
      "A",
      "B",
    );
    expect(headToHeadRecord(h2h, "A")).toEqual({ wins: 2, losses: 1, ties: 1 });
    expect(headToHeadRecord(h2h, "B")).toEqual({ wins: 1, losses: 2, ties: 1 });
  });
});

describe("teamStatTrend", () => {
  function stat(overrides: Partial<TeamGameStat>): TeamGameStat {
    return { gameId: "g1", team: "A", totalYards: 300, turnoverMargin: 0, offEpa: 0, ...overrides };
  }

  it("returns one point per game the team actually has stats for, in game order", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-01-08", homeTeam: "C", awayTeam: "A" }),
    ];
    const stats: TeamGameStat[] = [
      stat({ gameId: "g1", team: "A", totalYards: 400 }),
      stat({ gameId: "g2", team: "A", totalYards: 350 }),
    ];
    const result = teamStatTrend(games, stats, "A");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ opponent: "B", totalYards: 400 });
    expect(result[1]).toMatchObject({ opponent: "C", totalYards: 350 });
  });

  it("skips games the team wasn't in, and games with no matching stat row", () => {
    const games: Game[] = [
      game({ gameId: "g1", date: "2024-01-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-01-08", homeTeam: "X", awayTeam: "Y" }),
    ];
    const stats: TeamGameStat[] = []; // no stats at all
    expect(teamStatTrend(games, stats, "A")).toEqual([]);
  });

  it("skips games with no gameId (e.g. CFB)", () => {
    const games: Game[] = [game({ gameId: undefined, homeTeam: "A", awayTeam: "B" })];
    expect(teamStatTrend(games, [stat({ gameId: "g1", team: "A" })], "A")).toEqual([]);
  });
});

describe("seasonAverage", () => {
  it("averages only the given season's games", () => {
    const trend = [
      { gameId: "g1", date: "2023-01-01", season: 2023, opponent: "X", totalYards: 999, turnoverMargin: 9, offEpa: 9 },
      { gameId: "g2", date: "2024-01-01", season: 2024, opponent: "X", totalYards: 400, turnoverMargin: 2, offEpa: 1 },
      { gameId: "g3", date: "2024-01-08", season: 2024, opponent: "Y", totalYards: 300, turnoverMargin: 0, offEpa: -1 },
    ];
    expect(seasonAverage(trend, 2024)).toEqual({ totalYards: 350, turnoverMargin: 1, offEpa: 0 });
  });

  it("returns null when the team has no games that season", () => {
    expect(seasonAverage([], 2024)).toBeNull();
  });
});
