import { describe, expect, it } from "vitest";
import { DEFAULT_ELO_OPTIONS } from "./elo";
import { Game } from "./elo";
import { computeSkillPlayerRankings } from "./playerRankings";
import { PlayerUsageRow } from "./playerUsage";

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

function usage(overrides: Partial<PlayerUsageRow>): PlayerUsageRow {
  return { gameId: "g1", team: "A", category: "rushing", player: "Runner", rank: 1, statLine: [15, 80, 1], ...overrides };
}

// A season with enough distinct games/teams for tercile bucketing (needs >=6 qualifying entries).
function buildSeason(): { games: Game[]; usage: PlayerUsageRow[] } {
  const teams = ["A", "B", "C", "D"];
  const games: Game[] = [];
  const usage: PlayerUsageRow[] = [];
  let gid = 0;
  for (let week = 0; week < 6; week++) {
    for (let i = 0; i < teams.length; i += 2) {
      const home = teams[i];
      const away = teams[i + 1];
      const id = `g${gid++}`;
      games.push(
        game({ gameId: id, date: `2024-09-${String(week * 7 + 1).padStart(2, "0")}`, homeTeam: home, awayTeam: away, homeScore: 24, awayScore: 17 }),
      );
      // Player "Star" (team A) alternates between rank 1 and rank 2 usage — should still be pooled.
      if (home === "A") {
        usage.push(usage_(id, "A", week % 2 === 0 ? 1 : 2, 100 + week));
      }
    }
  }
  return { games, usage };

  function usage_(gameId: string, team: string, rank: number, yds: number): PlayerUsageRow {
    return { gameId, team, category: "rushing", player: "Star", rank, statLine: [15, yds, 1] };
  }
}

describe("computeSkillPlayerRankings", () => {
  it("returns null with no games or no usage data", () => {
    expect(computeSkillPlayerRankings([], [], DEFAULT_ELO_OPTIONS, "rushing")).toBeNull();
    expect(computeSkillPlayerRankings([game({})], [], DEFAULT_ELO_OPTIONS, "rushing")).toBeNull();
  });

  it("pools rank 1 AND rank 2+ usage rows for the same named player", () => {
    const { games, usage: usageRows } = buildSeason();
    const result = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    expect(result).not.toBeNull();
    const star = result!.rows.find((r) => r.player === "Star");
    expect(star).toBeDefined();
    // 6 weeks of games, "A" plays every week (home) -> 6 qualifying games, not just the rank-1 ones.
    expect(star!.games).toBe(6);
  });

  it("excludes a player below the minimum-games threshold", () => {
    const { games, usage: usageRows } = buildSeason();
    // Add a one-off appearance for a brand new player — shouldn't meet the 5-game minimum.
    usageRows.push(usage({ gameId: games[0].gameId, team: "B", player: "OneGame", rank: 1, statLine: [5, 20, 0] }));
    const result = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    expect(result!.rows.find((r) => r.player === "OneGame")).toBeUndefined();
  });

  it("computes yards/TD per-game averages alongside the opponent-adjusted rating", () => {
    const { games, usage: usageRows } = buildSeason();
    const result = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    const star = result!.rows.find((r) => r.player === "Star")!;
    // yards were 100..105 across 6 games -> average 102.5
    expect(star.yardsPerGame).toBeCloseTo(102.5, 6);
    expect(star.tdPerGame).toBeCloseTo(1, 6);
  });

  it("is deterministic for the same input", () => {
    const { games, usage: usageRows } = buildSeason();
    const r1 = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    const r2 = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    expect(r1).toEqual(r2);
  });

  it("keeps rushing and receiving as separate pools even for the same player/game", () => {
    const { games, usage: usageRows } = buildSeason();
    // Same player also shows up as a receiver every game — should be a fully separate ranking.
    // (Snapshot with a spread first: pushing into usageRows while iterating it live would loop forever.)
    for (const row of [...usageRows]) {
      usageRows.push({ ...row, category: "receiving", statLine: [5, 40, 0] });
    }
    const rushing = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "rushing");
    const receiving = computeSkillPlayerRankings(games, usageRows, DEFAULT_ELO_OPTIONS, "receiving");
    expect(rushing!.rows.find((r) => r.player === "Star")!.yardsPerGame).toBeGreaterThan(50);
    expect(receiving!.rows.find((r) => r.player === "Star")!.yardsPerGame).toBeCloseTo(40, 6);
  });
});
