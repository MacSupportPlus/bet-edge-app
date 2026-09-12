import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { primaryStarter, PlayerUsageRow, usageLeaders } from "./playerUsage";

function game(gameId: string, date: string, season: number, homeTeam: string, awayTeam: string): Game {
  return { gameId, date, season, homeTeam, awayTeam, homeScore: 21, awayScore: 14, neutral: false };
}

// passing statLine order: [comp, att, yds, td, int]
describe("primaryStarter", () => {
  const games: Game[] = [
    game("g1", "2024-09-01", 2024, "Ohio State", "Akron"),
    game("g2", "2024-09-08", 2024, "Marshall", "Ohio State"),
    game("g3", "2024-09-15", 2024, "Ohio State", "Michigan"),
    game("g4", "2023-09-01", 2023, "Ohio State", "Indiana"), // different season, should be ignored
  ];

  it("finds the most-frequent usage leader across the team's games this season", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", rank: 1, statLine: [13, 20, 150, 1, 0] },
      { gameId: "g2", team: "Ohio State", category: "passing", player: "Julian Sayin", rank: 1, statLine: [18, 25, 200, 2, 1] },
      { gameId: "g3", team: "Ohio State", category: "passing", player: "Backup Guy", rank: 1, statLine: [10, 15, 90, 0, 1] },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result).toEqual({
      player: "Julian Sayin",
      gamesLed: 2,
      totalGames: 3,
      ledMostRecentGame: false,
      statLine: [31, 45, 350, 3, 1], // summed only across Sayin's two games
    });
  });

  it("marks ledMostRecentGame true when the primary starter led the latest tracked game", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", rank: 1, statLine: [13, 20, 150, 1, 0] },
      { gameId: "g2", team: "Ohio State", category: "passing", player: "Julian Sayin", rank: 1, statLine: [18, 25, 200, 2, 1] },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result?.ledMostRecentGame).toBe(true);
  });

  it("ignores usage rows from other seasons and other teams", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g4", team: "Ohio State", category: "passing", player: "2023 Guy", rank: 1, statLine: [20, 30, 300, 3, 0] }, // wrong season
      { gameId: "g1", team: "Akron", category: "passing", player: "Akron QB", rank: 1, statLine: [20, 30, 300, 3, 0] }, // wrong team
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", rank: 1, statLine: [13, 20, 150, 1, 0] },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result).toEqual({
      player: "Julian Sayin",
      gamesLed: 1,
      totalGames: 1,
      ledMostRecentGame: true,
      statLine: [13, 20, 150, 1, 0],
    });
  });

  it("ignores rank 2/3 (runner-up) rows — only the game's usage leader counts", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "rushing", player: "Backup RB", rank: 2, statLine: [8, 40, 0] },
      { gameId: "g1", team: "Ohio State", category: "rushing", player: "Starter RB", rank: 1, statLine: [15, 90, 1] },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "rushing", 2024);
    expect(result?.player).toBe("Starter RB");
    expect(result?.gamesLed).toBe(1);
  });

  it("returns null when there's no usage data for this team/category/season", () => {
    expect(primaryStarter([], games, "Ohio State", "passing", 2024)).toBeNull();
  });
});

describe("usageLeaders", () => {
  const games: Game[] = [
    game("g1", "2024-09-01", 2024, "Ohio State", "Akron"),
    game("g2", "2024-09-08", 2024, "Marshall", "Ohio State"),
    game("g3", "2024-09-15", 2024, "Ohio State", "Michigan"),
  ];

  it("ranks every usage leader by games led, most first", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Starter", rank: 1, statLine: [13, 20, 150, 1, 0] },
      { gameId: "g2", team: "Ohio State", category: "passing", player: "Starter", rank: 1, statLine: [18, 25, 200, 2, 1] },
      { gameId: "g3", team: "Ohio State", category: "passing", player: "Backup", rank: 1, statLine: [10, 15, 90, 0, 1] },
    ];
    const result = usageLeaders(usage, games, "Ohio State", "passing", 2024);
    expect(result.map((r) => r.player)).toEqual(["Starter", "Backup"]);
    expect(result[0].gamesLed).toBe(2);
    expect(result[1].gamesLed).toBe(1);
  });

  it("primaryStarter matches usageLeaders' top entry exactly", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Starter", rank: 1, statLine: [13, 20, 150, 1, 0] },
      { gameId: "g3", team: "Ohio State", category: "passing", player: "Backup", rank: 1, statLine: [10, 15, 90, 0, 1] },
    ];
    expect(primaryStarter(usage, games, "Ohio State", "passing", 2024)).toEqual(usageLeaders(usage, games, "Ohio State", "passing", 2024)[0]);
  });

  it("returns an empty array, not null, when there's no usage data", () => {
    expect(usageLeaders([], games, "Ohio State", "passing", 2024)).toEqual([]);
  });
});
