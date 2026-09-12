import { describe, expect, it } from "vitest";
import { computeSituationStats } from "./situationalTrends";
import { buildCustomSituation, CustomFilters, DEFAULT_CUSTOM_FILTERS } from "./customTrends";
import { TrendGameRecord } from "./situationalTrends";

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

function filters(overrides: Partial<CustomFilters>): CustomFilters {
  return { ...DEFAULT_CUSTOM_FILTERS, ...overrides };
}

describe("buildCustomSituation — no team scope", () => {
  it("with all filters 'any', both sides of every game qualify (like a no-op filter)", () => {
    const records = [record({ spreadLine: 3, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({})));
    expect(stats.ats!.n).toBe(2);
  });

  it("role=favorite matches only the favored side", () => {
    const records = [record({ spreadLine: 3, homeScore: 24, awayScore: 17 })]; // home favored by 3, covers by 4
    const stats = computeSituationStats(records, buildCustomSituation(filters({ role: "favorite" })));
    expect(stats.ats!.n).toBe(1);
    expect(stats.ats!.covers).toBe(1);
  });

  it("location=home restricts to the home side only", () => {
    const records = [record({ spreadLine: 3, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ location: "home" })));
    expect(stats.ats!.n).toBe(1);
  });

  it("combines role and location with AND semantics", () => {
    // away favored by 3 (spreadLine=-3): road favorite = away side.
    const records = [record({ spreadLine: -3, homeScore: 10, awayScore: 20 })];
    // Asking for home favorites should find nothing here (favorite is away, not home).
    const stats = computeSituationStats(records, buildCustomSituation(filters({ role: "favorite", location: "home" })));
    expect(stats.ats).toBeNull();
  });

  it("divisionGame=yes excludes non-division games", () => {
    const records = [record({ spreadLine: 3, divisionGame: false, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ divisionGame: "yes" })));
    expect(stats.ats).toBeNull();
  });
});

describe("buildCustomSituation — team scoped", () => {
  it("scopes ATS to only the named team's own side, regardless of home/away each game", () => {
    const records = [
      record({ gameId: "g1", homeTeam: "SEA", awayTeam: "NE", spreadLine: 3, homeScore: 24, awayScore: 17 }), // SEA home, favored, covers
      record({ gameId: "g2", homeTeam: "KC", awayTeam: "SEA", spreadLine: -3, homeScore: 10, awayScore: 20 }), // SEA away, favored, covers
      record({ gameId: "g3", homeTeam: "KC", awayTeam: "DAL", spreadLine: 3, homeScore: 24, awayScore: 17 }), // SEA not in this game
    ];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ team: "SEA" })));
    expect(stats.ats!.n).toBe(2);
    expect(stats.ats!.covers).toBe(2);
  });

  it("a team filter with no matching games produces no result at all (n=0 -> ats null)", () => {
    const records = [record({ homeTeam: "KC", awayTeam: "DAL", spreadLine: 3 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ team: "SEA" })));
    expect(stats.ats).toBeNull();
    expect(stats.total).toBeNull();
  });

  it("qualifiesForTotal is scoped to the team's own game only", () => {
    const records = [
      record({ gameId: "g1", homeTeam: "SEA", awayTeam: "NE", totalLine: 40, homeScore: 24, awayScore: 20 }),
      record({ gameId: "g2", homeTeam: "KC", awayTeam: "DAL", totalLine: 40, homeScore: 24, awayScore: 20 }),
    ];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ team: "SEA" })));
    expect(stats.total!.n).toBe(1);
  });
});

describe("buildCustomSituation — rest, roof, weather", () => {
  it("rest=short (no team scope) counts each qualifying side independently", () => {
    const records = [record({ spreadLine: 3, homeRest: 4, awayRest: 10, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ rest: "short" })));
    expect(stats.ats!.n).toBe(1); // only home is on short rest
  });

  it("roof=dome excludes outdoor games", () => {
    const records = [record({ spreadLine: 3, roof: "outdoors", homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ roof: "dome" })));
    expect(stats.ats).toBeNull();
  });

  it("weather=cold requires a temp reading below 40", () => {
    const records = [record({ spreadLine: 3, temp: 55, homeScore: 24, awayScore: 17 })];
    const stats = computeSituationStats(records, buildCustomSituation(filters({ weather: "cold" })));
    expect(stats.ats).toBeNull();
  });
});
