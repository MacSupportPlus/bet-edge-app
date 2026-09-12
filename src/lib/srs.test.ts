import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { computeSrs } from "./srs";

function game(overrides: Partial<Game>): Game {
  return {
    gameId: "g",
    date: "2024-09-01",
    season: 2024,
    homeTeam: "A",
    awayTeam: "B",
    homeScore: 0,
    awayScore: 0,
    neutral: false,
    ...overrides,
  };
}

describe("computeSrs", () => {
  it("solves a simple transitive chain exactly: A beat B by 10, B beat C by 10 -> A +10, B 0, C -10", () => {
    const games = [
      game({ gameId: "1", homeTeam: "A", awayTeam: "B", homeScore: 20, awayScore: 10 }),
      game({ gameId: "2", homeTeam: "B", awayTeam: "C", homeScore: 20, awayScore: 10 }),
    ];
    const ratings = computeSrs(games, 2024, 200);
    expect(ratings.get("A")).toBeCloseTo(10, 3);
    expect(ratings.get("B")).toBeCloseTo(0, 3);
    expect(ratings.get("C")).toBeCloseTo(-10, 3);
  });

  it("mean-centers ratings across all teams", () => {
    const games = [
      game({ gameId: "1", homeTeam: "A", awayTeam: "B", homeScore: 30, awayScore: 10 }),
      game({ gameId: "2", homeTeam: "C", awayTeam: "D", homeScore: 14, awayScore: 13 }),
    ];
    const ratings = computeSrs(games, 2024, 200);
    const mean = [...ratings.values()].reduce((s, v) => s + v, 0) / ratings.size;
    expect(mean).toBeCloseTo(0, 6);
  });

  it("gives an undefeated blowout team a clearly higher rating than a team it beat badly", () => {
    const games = [
      game({ gameId: "1", homeTeam: "A", awayTeam: "B", homeScore: 40, awayScore: 7 }),
      game({ gameId: "2", homeTeam: "A", awayTeam: "C", homeScore: 35, awayScore: 10 }),
    ];
    const ratings = computeSrs(games, 2024, 200);
    expect(ratings.get("A")!).toBeGreaterThan(ratings.get("B")!);
    expect(ratings.get("A")!).toBeGreaterThan(ratings.get("C")!);
  });

  it("only includes games from the requested season", () => {
    const games = [
      game({ gameId: "1", season: 2023, homeTeam: "A", awayTeam: "B", homeScore: 40, awayScore: 7 }),
      game({ gameId: "2", season: 2024, homeTeam: "C", awayTeam: "D", homeScore: 14, awayScore: 13 }),
    ];
    const ratings = computeSrs(games, 2024, 50);
    expect(ratings.has("A")).toBe(false);
    expect(ratings.has("C")).toBe(true);
  });

  it("returns an empty map for a season with no games", () => {
    const ratings = computeSrs([game({ season: 2023 })], 2024, 50);
    expect(ratings.size).toBe(0);
  });
});
