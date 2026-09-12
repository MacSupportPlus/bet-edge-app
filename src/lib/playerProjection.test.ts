import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { PlayerUsageRow } from "./playerUsage";
import { buildPlayerProjectionModel, projectedYardsBefore } from "./playerProjection";

function game(overrides: Partial<Game>): Game {
  return {
    gameId: "g1",
    date: "2024-09-01",
    season: 2024,
    homeTeam: "A",
    awayTeam: "B",
    homeScore: 24,
    awayScore: 17,
    neutral: false,
    ...overrides,
  };
}

function rushingRow(overrides: Partial<PlayerUsageRow>): PlayerUsageRow {
  return { gameId: "g1", team: "A", category: "rushing", player: "Runner", rank: 1, statLine: [15, 80, 1], ...overrides };
}

// Six games at 100 yards each — well past MIN_PRIOR_GAMES (5).
function sixSteadyGames(player: string): { games: Game[]; usage: PlayerUsageRow[] } {
  const games: Game[] = [];
  const usage: PlayerUsageRow[] = [];
  for (let i = 0; i < 6; i++) {
    const gid = `g${i}`;
    games.push(game({ gameId: gid, date: `2024-09-${String(i + 1).padStart(2, "0")}` }));
    usage.push(rushingRow({ gameId: gid, player, statLine: [15, 100, 1] }));
  }
  return { games, usage };
}

describe("projectedYardsBefore", () => {
  it("returns null before the player has cleared the minimum prior-games threshold", () => {
    const { games, usage } = sixSteadyGames("Runner");
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    // As of game index 3 (0-based), only 3 prior games exist — below MIN_PRIOR_GAMES (5).
    expect(projectedYardsBefore(model, "Runner", 2024, "2024-09-04")).toBeNull();
  });

  it("averages only PRIOR games in the requested season (no leakage)", () => {
    const { games, usage } = sixSteadyGames("Runner");
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    // As of the 6th game's date, 5 prior 100-yard games exist -> average 100.
    expect(projectedYardsBefore(model, "Runner", 2024, "2024-09-06")).toBeCloseTo(100, 6);
  });

  it("does not leak a different season's games into the average", () => {
    const { games, usage } = sixSteadyGames("Runner");
    // Add a huge outlier game from a DIFFERENT season, dated before all the 2024 games chronologically.
    games.push(game({ gameId: "g_old", date: "2020-01-01", season: 2020 }));
    usage.push(rushingRow({ gameId: "g_old", player: "Runner", statLine: [30, 900, 5] }));
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    expect(projectedYardsBefore(model, "Runner", 2024, "2024-09-06")).toBeCloseTo(100, 6);
  });

  it("returns null for a player with no usage data at all", () => {
    const { games, usage } = sixSteadyGames("Runner");
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    expect(projectedYardsBefore(model, "Nobody", 2024, "2024-09-06")).toBeNull();
  });

  it("keeps rushing and receiving as separate models for the same player", () => {
    const { games, usage } = sixSteadyGames("Runner");
    const receivingUsage = usage.map((r) => ({ ...r, category: "receiving" as const, statLine: [5, 40, 0] }));
    const rushingModel = buildPlayerProjectionModel(games, usage, "rushing");
    const receivingModel = buildPlayerProjectionModel(games, receivingUsage, "receiving");
    expect(projectedYardsBefore(rushingModel, "Runner", 2024, "2024-09-06")).toBeCloseTo(100, 6);
    expect(projectedYardsBefore(receivingModel, "Runner", 2024, "2024-09-06")).toBeCloseTo(40, 6);
  });
});

describe("buildPlayerProjectionModel sigma", () => {
  it("is 0 when every game matches the trailing average exactly", () => {
    const { games, usage } = sixSteadyGames("Runner");
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    expect(model.sigma).toBeCloseTo(0, 6);
  });

  it("is positive when actual yards vary game to game", () => {
    const games: Game[] = [];
    const usage: PlayerUsageRow[] = [];
    const yards = [60, 140, 80, 120, 100, 90, 130];
    yards.forEach((y, i) => {
      const gid = `g${i}`;
      games.push(game({ gameId: gid, date: `2024-09-${String(i + 1).padStart(2, "0")}` }));
      usage.push(rushingRow({ gameId: gid, player: "Runner", statLine: [15, y, 1] }));
    });
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    expect(model.sigma).toBeGreaterThan(0);
  });

  it("exposes the raw residuals, one per game past the minimum prior-games threshold, summing consistently with sigma's own variance", () => {
    const games: Game[] = [];
    const usage: PlayerUsageRow[] = [];
    const yards = [60, 140, 80, 120, 100, 90, 130];
    yards.forEach((y, i) => {
      const gid = `g${i}`;
      games.push(game({ gameId: gid, date: `2024-09-${String(i + 1).padStart(2, "0")}` }));
      usage.push(rushingRow({ gameId: gid, player: "Runner", statLine: [15, y, 1] }));
    });
    const model = buildPlayerProjectionModel(games, usage, "rushing");
    // 7 games, MIN_PRIOR_GAMES=5 -> only games 6 and 7 produce a residual.
    expect(model.residuals).toHaveLength(2);
    const mean = model.residuals.reduce((s, r) => s + r, 0) / model.residuals.length;
    const variance = model.residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / model.residuals.length;
    expect(Math.sqrt(variance)).toBeCloseTo(model.sigma, 6);
  });
});
