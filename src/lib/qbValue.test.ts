import { describe, expect, it } from "vitest";
import { Game } from "./elo";
import { PlayerInjury } from "./espn";
import { PlayerUsageRow } from "./playerUsage";
import { buildQbValueModel, NEUTRAL_QB_VALUE_FEATURES, qbValueBefore, qbValueDiff, resolveLiveStarter } from "./qbValue";

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

function passingRow(overrides: Partial<PlayerUsageRow>): PlayerUsageRow {
  return { gameId: "g1", team: "A", category: "passing", player: "QB1", rank: 1, statLine: [20, 30, 250, 2, 1], ...overrides };
}

describe("buildQbValueModel / qbValueBefore", () => {
  it("returns the league average for a player with no prior attempts", () => {
    const games = [game({})];
    const usage = [passingRow({})];
    const model = buildQbValueModel(games, usage);
    expect(qbValueBefore(model, "QB1", "2024-09-01")).toBeCloseTo(model.leagueAvgAnyA, 10);
  });

  it("uses only games strictly BEFORE the given date (no leakage)", () => {
    const games = [
      game({ gameId: "g1", date: "2024-09-01" }),
      game({ gameId: "g2", date: "2024-09-08" }),
    ];
    const usage = [
      passingRow({ gameId: "g1", player: "QB1", statLine: [20, 30, 300, 3, 0] }), // great game
      passingRow({ gameId: "g2", player: "QB1", statLine: [10, 30, 100, 0, 3] }), // terrible game, AFTER g1
    ];
    const model = buildQbValueModel(games, usage);
    // Valuing QB1 as of g1's date should NOT see g1's own (or g2's future) stats.
    const beforeG1 = qbValueBefore(model, "QB1", "2024-09-01");
    expect(beforeG1).toBeCloseTo(model.leagueAvgAnyA, 10);
    // Valuing as of g2's date should reflect ONLY g1 (the great game), not g2 itself.
    const beforeG2 = qbValueBefore(model, "QB1", "2024-09-08");
    expect(beforeG2).toBeGreaterThan(model.leagueAvgAnyA);
  });

  it("shrinks a small sample toward league average rather than taking it at face value", () => {
    const games = [
      game({ gameId: "g1", date: "2024-09-01", homeTeam: "A", awayTeam: "B" }),
      game({ gameId: "g2", date: "2024-09-08", homeTeam: "A", awayTeam: "C" }),
      // A dozen ordinary games from other QBs establish a realistic league average distinct from QB1's outlier game.
      ...Array.from({ length: 12 }, (_, i) => game({ gameId: `avg${i}`, date: "2024-09-01", homeTeam: "X", awayTeam: "Y" })),
    ];
    // One monster game (unsustainable ANY/A) should be pulled well below its raw value.
    const usage = [
      passingRow({ gameId: "g1", player: "QB1", statLine: [20, 20, 500, 6, 0] }),
      ...Array.from({ length: 12 }, (_, i) => passingRow({ gameId: `avg${i}`, team: "X", player: `AvgQB${i}`, statLine: [20, 30, 220, 1, 1] })),
    ];
    const model = buildQbValueModel(games, usage);
    const rawAnyA = (500 + 20 * 6) / 20; // 31 ANY/A, absurd for a full season
    expect(model.leagueAvgAnyA).toBeLessThan(15); // sanity: the 12 ordinary games dominate the average, not QB1's outlier
    const shrunk = qbValueBefore(model, "QB1", "2024-09-08");
    expect(shrunk).toBeLessThan(rawAnyA);
    expect(shrunk).toBeGreaterThan(model.leagueAvgAnyA); // still pulled toward, not all the way to, average
  });

  it("computes league-average ANY/A from the data itself", () => {
    const games = [game({ gameId: "g1" }), game({ gameId: "g2", homeTeam: "C", awayTeam: "D" })];
    const usage = [
      passingRow({ gameId: "g1", team: "A", player: "QB1", statLine: [20, 20, 200, 2, 0] }), // ANY/A = (200+40)/20 = 12
      passingRow({ gameId: "g2", team: "C", player: "QB2", statLine: [20, 20, 200, 0, 0] }), // ANY/A = 200/20 = 10
    ];
    const model = buildQbValueModel(games, usage);
    expect(model.leagueAvgAnyA).toBeCloseTo(11, 10); // (240+200)/40 = 11
  });

  it("ignores non-passing rows and rows with zero attempts", () => {
    const games = [game({})];
    const usage: PlayerUsageRow[] = [
      passingRow({ category: "rushing", statLine: [15, 80, 1] }),
      passingRow({ player: "NoAttempts", statLine: [0, 0, 0, 0, 0] }),
    ];
    const model = buildQbValueModel(games, usage);
    expect(model.logsByPlayer.size).toBe(0);
  });
});

describe("qbValueDiff", () => {
  it("returns null when either starter is unknown, rather than guessing", () => {
    const model = buildQbValueModel([game({})], [passingRow({})]);
    expect(qbValueDiff(model, null, "QB1", "2024-09-01")).toBeNull();
    expect(qbValueDiff(model, "QB1", null, "2024-09-01")).toBeNull();
  });

  it("computes home-minus-away value difference", () => {
    const games = [game({ gameId: "g1", date: "2024-09-01" }), game({ gameId: "g2", date: "2024-09-08" })];
    const usage = [
      passingRow({ gameId: "g1", team: "A", player: "GoodQB", statLine: [25, 30, 350, 4, 0] }),
      passingRow({ gameId: "g1", team: "B", player: "BadQB", statLine: [10, 30, 80, 0, 4] }),
    ];
    const model = buildQbValueModel(games, usage);
    const diff = qbValueDiff(model, "GoodQB", "BadQB", "2024-09-08");
    expect(diff).not.toBeNull();
    expect(diff!.qbValueDiff).toBeGreaterThan(0);
  });

  it("NEUTRAL_QB_VALUE_FEATURES is the correct fallback shape", () => {
    expect(NEUTRAL_QB_VALUE_FEATURES).toEqual({ qbValueDiff: 0 });
  });
});

describe("resolveLiveStarter", () => {
  const games: Game[] = [
    game({ gameId: "g1", date: "2024-09-01", homeTeam: "Ohio State", awayTeam: "Akron" }),
    game({ gameId: "g2", date: "2024-09-08", homeTeam: "Marshall", awayTeam: "Ohio State" }),
    game({ gameId: "g3", date: "2024-09-15", homeTeam: "Ohio State", awayTeam: "Michigan" }),
  ];
  const usage: PlayerUsageRow[] = [
    passingRow({ gameId: "g1", team: "Ohio State", player: "Starter", rank: 1 }),
    passingRow({ gameId: "g2", team: "Ohio State", player: "Starter", rank: 1 }),
    passingRow({ gameId: "g3", team: "Ohio State", player: "Backup", rank: 1 }),
  ];

  function injury(overrides: Partial<PlayerInjury>): PlayerInjury {
    return { team: "Ohio State Buckeyes", player: "Starter", position: "QB", status: "Out", ...overrides };
  }

  it("returns the primary usage leader with no note when there's no injury report", () => {
    expect(resolveLiveStarter(usage, games, "Ohio State", 2024, [])).toEqual({ player: "Starter", note: null });
  });

  it("substitutes the #2 usage leader when the primary is listed with a concerning status", () => {
    const result = resolveLiveStarter(usage, games, "Ohio State", 2024, [injury({ status: "Out" })]);
    expect(result.player).toBe("Backup");
    expect(result.note).toContain("Starter is listed Out");
    expect(result.note).toContain("Backup");
  });

  it("does NOT substitute for a non-concerning status like Questionable", () => {
    const result = resolveLiveStarter(usage, games, "Ohio State", 2024, [injury({ status: "Questionable" })]);
    expect(result).toEqual({ player: "Starter", note: null });
  });

  it("returns a neutral note when the primary is out and there's no clear backup", () => {
    const soloUsage: PlayerUsageRow[] = [passingRow({ gameId: "g1", team: "Ohio State", player: "Starter", rank: 1 })];
    const result = resolveLiveStarter(soloUsage, games, "Ohio State", 2024, [injury({ status: "Doubtful" })]);
    expect(result.player).toBeNull();
    expect(result.note).toContain("no clear backup");
  });

  it("matches player names loosely (punctuation/diacritics) via normalizeTeamName", () => {
    const dotUsage: PlayerUsageRow[] = [
      passingRow({ gameId: "g1", team: "Ohio State", player: "A.J. Starter", rank: 1 }),
      passingRow({ gameId: "g3", team: "Ohio State", player: "Backup", rank: 1 }),
    ];
    const result = resolveLiveStarter(dotUsage, games, "Ohio State", 2024, [injury({ player: "AJ Starter", status: "Out" })]);
    expect(result.player).toBe("Backup");
  });

  it("returns nulls when there's no usage data for this team at all", () => {
    expect(resolveLiveStarter([], games, "Ohio State", 2024, [])).toEqual({ player: null, note: null });
  });
});
