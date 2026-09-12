import { describe, expect, it } from "vitest";
import { LiveOddsGame } from "./liveOdds";
import { buildTodaysGameTrends } from "./todaysTrends";

function game(overrides: Partial<LiveOddsGame>): LiveOddsGame {
  return {
    eventId: "e1",
    commenceTime: "2026-09-13T17:00:00Z",
    homeTeam: "Pittsburgh Steelers",
    awayTeam: "Atlanta Falcons",
    books: [{ book: "DK", lastUpdate: "", homeMoneyline: -150, awayMoneyline: 130, homeSpread: 3, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 44, overOdds: -110, underOdds: -110 }],
    ...overrides,
  };
}

const knownNfl = new Set(["PIT", "ATL", "SEA", "NE"]);

describe("buildTodaysGameTrends", () => {
  it("labels the home team a home-favorite and the away team a road-underdog when the spread favors home", () => {
    const [result] = buildTodaysGameTrends("nfl", [game({})], knownNfl);
    expect(result.home).toEqual({ team: "PIT", displayTeam: "Pittsburgh Steelers", isHome: true, situationId: "home-favorite" });
    expect(result.away).toEqual({ team: "ATL", displayTeam: "Atlanta Falcons", isHome: false, situationId: "road-underdog" });
  });

  it("flips to home-underdog / road-favorite when the away team is favored", () => {
    const negSpreadGame = game({ books: [{ book: "DK", lastUpdate: "", homeMoneyline: 130, awayMoneyline: -150, homeSpread: -3, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 44, overOdds: -110, underOdds: -110 }] });
    const [result] = buildTodaysGameTrends("nfl", [negSpreadGame], knownNfl);
    expect(result.home?.situationId).toBe("home-underdog");
    expect(result.away?.situationId).toBe("road-favorite");
  });

  it("returns a null situationId for a pick'em (spread of exactly 0)", () => {
    const pickEm = game({ books: [{ book: "DK", lastUpdate: "", homeMoneyline: -110, awayMoneyline: -110, homeSpread: 0, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 44, overOdds: -110, underOdds: -110 }] });
    const [result] = buildTodaysGameTrends("nfl", [pickEm], knownNfl);
    expect(result.home?.situationId).toBeNull();
    expect(result.away?.situationId).toBeNull();
  });

  it("returns a null situationId when no book has posted a spread yet", () => {
    const noSpread = game({ books: [{ book: "DK", lastUpdate: "", homeMoneyline: -110, awayMoneyline: -110, homeSpread: null, homeSpreadOdds: null, awaySpreadOdds: null, total: null, overOdds: null, underOdds: null }] });
    const [result] = buildTodaysGameTrends("nfl", [noSpread], knownNfl);
    expect(result.home?.situationId).toBeNull();
  });

  it("returns null for a team that can't be resolved against the historical archive", () => {
    const unresolvable = game({ homeTeam: "Some Fake Team" });
    const [result] = buildTodaysGameTrends("nfl", [unresolvable], knownNfl);
    expect(result.home).toBeNull();
    expect(result.away).not.toBeNull();
  });
});
