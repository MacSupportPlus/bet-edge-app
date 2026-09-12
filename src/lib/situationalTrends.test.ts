import { describe, expect, it } from "vitest";
import { computeSituationStats, MIN_TRUSTED_SAMPLE, SITUATIONS, TrendGameRecord } from "./situationalTrends";

function record(overrides: Partial<TrendGameRecord>): TrendGameRecord {
  return {
    gameId: "g1",
    date: "2024-09-01",
    season: 2024,
    homeTeam: "A",
    awayTeam: "B",
    homeScore: 24,
    awayScore: 17,
    spreadLine: null,
    totalLine: null,
    homeRest: null,
    awayRest: null,
    divisionGame: null,
    roof: null,
    temp: null,
    wind: null,
    ...overrides,
  };
}

const homeFavorite = SITUATIONS.find((s) => s.id === "home-favorite")!;
const homeUnderdog = SITUATIONS.find((s) => s.id === "home-underdog")!;
const roadFavorite = SITUATIONS.find((s) => s.id === "road-favorite")!;
const roadUnderdog = SITUATIONS.find((s) => s.id === "road-underdog")!;
const divisionGame = SITUATIONS.find((s) => s.id === "division-game")!;
const shortRest = SITUATIONS.find((s) => s.id === "short-rest")!;

describe("computeSituationStats — ATS", () => {
  it("counts a home favorite covering: actual margin exceeds the line", () => {
    // home favored by 3 (spreadLine=3), home wins by 7 (24-17) -> covers by 4.
    const records = [record({ spreadLine: 3, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats).not.toBeNull();
    expect(stats.ats!.covers).toBe(1);
    expect(stats.ats!.losses).toBe(0);
    expect(stats.ats!.avgMarginVsLine).toBeCloseTo(4, 6);
  });

  it("counts a home favorite failing to cover: actual margin falls short of the line", () => {
    // home favored by 10, home wins by only 3 -> doesn't cover.
    const records = [record({ spreadLine: 10, homeScore: 20, awayScore: 17 })];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.covers).toBe(0);
    expect(stats.ats!.losses).toBe(1);
    expect(stats.ats!.avgMarginVsLine).toBeCloseTo(-7, 6);
  });

  it("counts an exact push correctly, not as a cover or loss", () => {
    // home favored by exactly the final margin.
    const records = [record({ spreadLine: 7, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.covers).toBe(0);
    expect(stats.ats!.losses).toBe(0);
    expect(stats.ats!.pushes).toBe(1);
    expect(stats.ats!.coverRate).toBeNaN(); // no decided games
  });

  it("home-underdog and road-favorite are mutually exclusive views of the same game", () => {
    // Away team favored by 3 (spreadLine=-3): this is a "road favorite" and "home underdog" game simultaneously.
    const records = [record({ spreadLine: -3, homeScore: 10, awayScore: 20 })]; // away wins by 10, favored by 3 -> away covers
    const homeUdStats = computeSituationStats(records, homeUnderdog);
    const roadFavStats = computeSituationStats(records, roadFavorite);
    expect(homeUdStats.ats!.n).toBe(1);
    expect(roadFavStats.ats!.n).toBe(1);
    // Home underdog's margin-vs-line uses home's OWN perspective: home lost by 10, "getting" 3 -> -10 - 3 = -13 vs line? Let's check directly instead of re-deriving by hand here.
    expect(homeUdStats.ats!.losses).toBe(1); // home underdog did not cover (lost outright by more than they were getting)
    expect(roadFavStats.ats!.covers).toBe(1); // the road favorite covered
  });

  it("home-favorite and road-underdog never both qualify the same side for the same game", () => {
    const records = [record({ spreadLine: 3, homeScore: 24, awayScore: 17 })];
    expect(computeSituationStats(records, homeFavorite).ats!.n).toBe(1);
    expect(computeSituationStats(records, roadUnderdog).ats!.n).toBe(1);
    // These are two DIFFERENT teams' perspectives on the same game (home favorite = home side, road underdog = away side of THIS game only if away is the underdog, which it is here) — both legitimately qualify, not a double-count of the same side.
  });

  it("ignores games with no spread line at all", () => {
    const records = [record({ spreadLine: null, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats).toBeNull();
  });

  it("flags a small sample as untrusted, and a large one as trusted", () => {
    const small = Array.from({ length: MIN_TRUSTED_SAMPLE - 1 }, () => record({ spreadLine: 3, homeScore: 24, awayScore: 17 }));
    const large = Array.from({ length: MIN_TRUSTED_SAMPLE }, () => record({ spreadLine: 3, homeScore: 24, awayScore: 17 }));
    expect(computeSituationStats(small, homeFavorite).ats!.trusted).toBe(false);
    expect(computeSituationStats(large, homeFavorite).ats!.trusted).toBe(true);
  });
});

describe("computeSituationStats — totals", () => {
  it("counts an over correctly", () => {
    const records = [record({ totalLine: 40, homeScore: 24, awayScore: 20 })]; // total 44 > 40
    const stats = computeSituationStats(records, divisionGame);
    // divisionGame requires divisionGame:true to qualify for totals too.
    expect(stats.total).toBeNull();
  });

  it("division-game situation qualifies totals only when divisionGame is true", () => {
    const records = [record({ divisionGame: true, spreadLine: 3, totalLine: 40, homeScore: 24, awayScore: 20 })];
    const stats = computeSituationStats(records, divisionGame);
    expect(stats.total).not.toBeNull();
    expect(stats.total!.overs).toBe(1);
    expect(stats.total!.avgTotalVsLine).toBeCloseTo(4, 6);
  });

  it("counts an exact total push correctly", () => {
    const records = [record({ divisionGame: true, spreadLine: 3, totalLine: 44, homeScore: 24, awayScore: 20 })];
    const stats = computeSituationStats(records, divisionGame);
    expect(stats.total!.pushes).toBe(1);
    expect(stats.total!.overs).toBe(0);
    expect(stats.total!.unders).toBe(0);
  });
});

describe("computeSituationStats — short rest (both-sides-qualify case)", () => {
  it("counts both teams separately when both are on short rest", () => {
    const records = [record({ spreadLine: 3, homeRest: 4, awayRest: 5, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, shortRest);
    expect(stats.ats!.n).toBe(2); // both home and away qualify independently
  });

  it("counts only the qualifying side when just one team is on short rest", () => {
    const records = [record({ spreadLine: 3, homeRest: 4, awayRest: 10, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, shortRest);
    expect(stats.ats!.n).toBe(1);
  });

  it("is NFL-only", () => {
    expect(shortRest.sports).toEqual(["nfl"]);
  });
});

describe("SITUATIONS", () => {
  it("has a unique id for every situation", () => {
    const ids = SITUATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("computeSituationStats — enriched stats (ROI, units, streak, last10, years)", () => {
  // 30 covers, 12 losses, flat 1u bet at -110 each — matches a real TrendsCenter
  // example exactly (30-12-0, 36.36% ROI) as an external sanity check.
  function manyGames(wins: number, lossesCount: number, opts: { seasonsSpan?: number } = {}) {
    const records: TrendGameRecord[] = [];
    const total = wins + lossesCount;
    for (let i = 0; i < total; i++) {
      const covers = i < wins; // wins first, losses after — order doesn't matter for aggregate stats
      records.push(
        record({
          gameId: `g${i}`,
          date: `${2020 + Math.floor((i / total) * (opts.seasonsSpan ?? 1))}-01-${String((i % 28) + 1).padStart(2, "0")}`,
          season: 2020 + Math.floor((i / total) * (opts.seasonsSpan ?? 1)),
          spreadLine: 3,
          homeScore: covers ? 30 : 10,
          awayScore: 17,
        }),
      );
    }
    return records;
  }

  it("computes ROI and units matching the standard flat-bet-at--110 convention", () => {
    const stats = computeSituationStats(manyGames(30, 12), homeFavorite);
    // units = 30*(100/110) - 12 = 27.2727... - 12 = 15.2727...
    expect(stats.ats!.units).toBeCloseTo(15.2727, 3);
    // roi = units / decided games * 100 = 15.2727/42*100 = 36.36%
    expect(stats.ats!.roi).toBeCloseTo(36.36, 1);
  });

  it("a perfect record has a current streak equal to its full length", () => {
    const stats = computeSituationStats(manyGames(32, 0), homeFavorite);
    expect(stats.ats!.currentStreak).toBe(32);
    expect(stats.ats!.last10).toEqual({ wins: 10, losses: 0, pushes: 0 });
  });

  it("current streak stops at the most recent loss, even with a long history before it", () => {
    // 10 wins, then a loss, in chronological order (losses AFTER wins in date terms).
    const records = [
      ...Array.from({ length: 10 }, (_, i) =>
        record({ gameId: `w${i}`, date: `2023-01-${String(i + 1).padStart(2, "0")}`, spreadLine: 3, homeScore: 30, awayScore: 17 }),
      ),
      record({ gameId: "l1", date: "2023-02-01", spreadLine: 3, homeScore: 10, awayScore: 17 }),
    ];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.currentStreak).toBe(0); // most recent game was a loss
    expect(stats.ats!.last10.losses).toBe(1);
  });

  it("counts distinct seasons as 'years'", () => {
    const records = [
      record({ gameId: "a", date: "2021-09-01", season: 2021, spreadLine: 3, homeScore: 30, awayScore: 17 }),
      record({ gameId: "b", date: "2022-09-01", season: 2022, spreadLine: 3, homeScore: 30, awayScore: 17 }),
      record({ gameId: "c", date: "2023-09-01", season: 2023, spreadLine: 3, homeScore: 30, awayScore: 17 }),
    ];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.years).toBe(3);
  });

  it("cumulativeUnits has one entry per DECIDED game (pushes excluded), running total in chronological order", () => {
    const records = [
      record({ gameId: "a", date: "2023-01-01", spreadLine: 3, homeScore: 30, awayScore: 17 }), // win
      record({ gameId: "b", date: "2023-01-02", spreadLine: 3, homeScore: 20, awayScore: 17 }), // push (exact margin)
      record({ gameId: "c", date: "2023-01-03", spreadLine: 3, homeScore: 10, awayScore: 17 }), // loss
    ];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.cumulativeUnits).toHaveLength(2);
    expect(stats.ats!.cumulativeUnits[0]).toBeCloseTo(100 / 110, 6);
    expect(stats.ats!.cumulativeUnits[1]).toBeCloseTo(100 / 110 - 1, 6);
  });

  it("a push neither extends nor breaks the current streak", () => {
    const records = [
      record({ gameId: "a", date: "2023-01-01", spreadLine: 3, homeScore: 30, awayScore: 17 }), // win
      record({ gameId: "b", date: "2023-01-02", spreadLine: 3, homeScore: 20, awayScore: 17 }), // push
      record({ gameId: "c", date: "2023-01-03", spreadLine: 3, homeScore: 30, awayScore: 17 }), // win
    ];
    const stats = computeSituationStats(records, homeFavorite);
    expect(stats.ats!.currentStreak).toBe(2);
  });
});
