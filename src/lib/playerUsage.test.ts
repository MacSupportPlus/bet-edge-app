import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { primaryStarter, PlayerUsageRow } from "./playerUsage";

function game(gameId: string, date: string, season: number, homeTeam: string, awayTeam: string): Game {
  return { gameId, date, season, homeTeam, awayTeam, homeScore: 21, awayScore: 14, neutral: false };
}

describe("primaryStarter", () => {
  const games: Game[] = [
    game("g1", "2024-09-01", 2024, "Ohio State", "Akron"),
    game("g2", "2024-09-08", 2024, "Marshall", "Ohio State"),
    game("g3", "2024-09-15", 2024, "Ohio State", "Michigan"),
    game("g4", "2023-09-01", 2023, "Ohio State", "Indiana"), // different season, should be ignored
  ];

  it("finds the most-frequent usage leader across the team's games this season", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", value: 20 },
      { gameId: "g2", team: "Ohio State", category: "passing", player: "Julian Sayin", value: 25 },
      { gameId: "g3", team: "Ohio State", category: "passing", player: "Backup Guy", value: 15 },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result).toEqual({ player: "Julian Sayin", gamesLed: 2, totalGames: 3, ledMostRecentGame: false });
  });

  it("marks ledMostRecentGame true when the primary starter led the latest tracked game", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", value: 20 },
      { gameId: "g2", team: "Ohio State", category: "passing", player: "Julian Sayin", value: 25 },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result?.ledMostRecentGame).toBe(true);
  });

  it("ignores usage rows from other seasons and other teams", () => {
    const usage: PlayerUsageRow[] = [
      { gameId: "g4", team: "Ohio State", category: "passing", player: "2023 Guy", value: 30 }, // wrong season
      { gameId: "g1", team: "Akron", category: "passing", player: "Akron QB", value: 30 }, // wrong team
      { gameId: "g1", team: "Ohio State", category: "passing", player: "Julian Sayin", value: 20 },
    ];
    const result = primaryStarter(usage, games, "Ohio State", "passing", 2024);
    expect(result).toEqual({ player: "Julian Sayin", gamesLed: 1, totalGames: 1, ledMostRecentGame: true });
  });

  it("returns null when there's no usage data for this team/category/season", () => {
    expect(primaryStarter([], games, "Ohio State", "passing", 2024)).toBeNull();
  });
});
