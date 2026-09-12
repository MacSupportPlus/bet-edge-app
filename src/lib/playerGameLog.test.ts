import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { currentTeamFor, playerGameLog, playersOnTeam } from "./playerGameLog";
import { PlayerUsageRow } from "./playerUsage";

function game(overrides: Partial<Game>): Game {
  return {
    gameId: "g1",
    date: "2024-09-01",
    season: 2024,
    homeTeam: "SEA",
    awayTeam: "NE",
    homeScore: 24,
    awayScore: 17,
    neutral: false,
    ...overrides,
  };
}

function row(overrides: Partial<PlayerUsageRow>): PlayerUsageRow {
  return { gameId: "g1", team: "SEA", category: "rushing", player: "Runner", rank: 1, statLine: [15, 80, 1], ...overrides };
}

describe("playerGameLog", () => {
  it("returns entries sorted most-recent-first", () => {
    const games = [game({ gameId: "g1", date: "2024-09-01" }), game({ gameId: "g2", date: "2024-09-08" })];
    const usage = [row({ gameId: "g1" }), row({ gameId: "g2" })];
    const log = playerGameLog(usage, games, "Runner");
    expect(log.map((e) => e.gameId)).toEqual(["g2", "g1"]);
  });

  it("computes the opponent and home/away flag correctly for both sides", () => {
    const games = [game({ gameId: "g1", homeTeam: "SEA", awayTeam: "NE" })];
    const homeRow = [row({ gameId: "g1", team: "SEA" })];
    const awayRow = [row({ gameId: "g1", team: "NE" })];
    expect(playerGameLog(homeRow, games, "Runner")[0]).toMatchObject({ opponent: "NE", isHome: true });
    expect(playerGameLog(awayRow, games, "Runner")[0]).toMatchObject({ opponent: "SEA", isHome: false });
  });

  it("pools every rank, not just rank 1", () => {
    const games = [game({})];
    const usage = [row({ rank: 2 })];
    expect(playerGameLog(usage, games, "Runner")).toHaveLength(1);
  });

  it("ignores rows for other players and games with no matching gameId", () => {
    const games = [game({ gameId: "g1" })];
    const usage = [row({ gameId: "g1", player: "Someone Else" }), row({ gameId: "g_missing" })];
    expect(playerGameLog(usage, games, "Runner")).toHaveLength(0);
  });
});

describe("currentTeamFor", () => {
  it("returns the most recent game's team", () => {
    const games = [game({ gameId: "g1", date: "2024-09-01", homeTeam: "SEA" }), game({ gameId: "g2", date: "2024-09-08", homeTeam: "NE" })];
    const usage = [row({ gameId: "g1", team: "SEA" }), row({ gameId: "g2", team: "NE" })];
    expect(currentTeamFor(playerGameLog(usage, games, "Runner"))).toBe("NE");
  });

  it("returns null for an empty log", () => {
    expect(currentTeamFor([])).toBeNull();
  });
});

describe("playersOnTeam", () => {
  it("returns distinct, sorted player names for a team", () => {
    const usage = [row({ team: "SEA", player: "Zed" }), row({ team: "SEA", player: "Alan" }), row({ team: "SEA", player: "Alan" }), row({ team: "NE", player: "Someone" })];
    expect(playersOnTeam(usage, "SEA")).toEqual(["Alan", "Zed"]);
  });
});
