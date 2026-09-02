import { describe, expect, it } from "vitest";
import {
  impliedProbability,
  isStaleSeasonStats,
  moneylineToDecimalB,
  parseOddsSummary,
  parseScoreboardEvent,
  parseTeamStatistics,
  toEspnDate,
} from "./espn";

describe("moneylineToDecimalB", () => {
  it("converts a positive (underdog) moneyline", () => {
    expect(moneylineToDecimalB(150)).toBeCloseTo(1.5, 10);
  });

  it("converts a negative (favorite) moneyline", () => {
    expect(moneylineToDecimalB(-150)).toBeCloseTo(100 / 150, 10);
  });

  it("matches standard -110 odds to b ≈ 0.909", () => {
    expect(moneylineToDecimalB(-110)).toBeCloseTo(100 / 110, 10);
  });

  it("handles an extreme heavy favorite", () => {
    expect(moneylineToDecimalB(-100000)).toBeCloseTo(0.001, 10);
  });
});

describe("impliedProbability", () => {
  it("converts standard -110 odds to ~52.4% (the vig)", () => {
    expect(impliedProbability(-110)).toBeCloseTo(110 / 210, 10);
  });

  it("converts a positive underdog moneyline", () => {
    expect(impliedProbability(150)).toBeCloseTo(100 / 250, 10);
  });

  it("gives a heavy favorite a probability near 1", () => {
    expect(impliedProbability(-100000)).toBeGreaterThan(0.999);
  });

  it("both sides of a fair (no-vig) coin sum to 1", () => {
    expect(impliedProbability(100) + impliedProbability(-100)).toBeCloseTo(1, 10);
  });
});

describe("toEspnDate", () => {
  it("formats a date as YYYYMMDD", () => {
    expect(toEspnDate(new Date(2026, 8, 3))).toBe("20260903"); // month is 0-indexed -> September
  });

  it("zero-pads single-digit months and days", () => {
    expect(toEspnDate(new Date(2026, 0, 5))).toBe("20260105");
  });
});

describe("parseScoreboardEvent", () => {
  const validEvent = {
    id: "401864494",
    date: "2026-08-29T19:00Z",
    competitions: [
      {
        neutralSite: false,
        competitors: [
          { homeAway: "home", team: { id: "30", location: "USC", abbreviation: "USC" } },
          { homeAway: "away", team: { id: "23", location: "San José State", abbreviation: "SJSU" } },
        ],
      },
    ],
  };

  it("extracts home/away team, abbreviations, ids, and neutral-site flag", () => {
    const result = parseScoreboardEvent(validEvent);
    expect(result).toEqual({
      espnId: "401864494",
      date: "2026-08-29T19:00Z",
      homeTeam: "USC",
      awayTeam: "San José State",
      homeTeamAbbr: "USC",
      awayTeamAbbr: "SJSU",
      homeTeamId: "30",
      awayTeamId: "23",
      neutralSite: false,
    });
  });

  it("falls back to null team ids and abbreviations when ESPN omits them", () => {
    const result = parseScoreboardEvent({
      id: "1",
      date: "x",
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { location: "A" } },
            { homeAway: "away", team: { location: "B" } },
          ],
        },
      ],
    });
    expect(result?.homeTeamId).toBeNull();
    expect(result?.awayTeamId).toBeNull();
    expect(result?.homeTeamAbbr).toBeNull();
    expect(result?.awayTeamAbbr).toBeNull();
  });

  it("returns null for malformed/missing data instead of throwing", () => {
    expect(parseScoreboardEvent({})).toBeNull();
    expect(parseScoreboardEvent(null)).toBeNull();
    expect(parseScoreboardEvent({ id: "1", date: "x", competitions: [] })).toBeNull();
    expect(
      parseScoreboardEvent({
        id: "1",
        date: "x",
        competitions: [{ competitors: [{ homeAway: "home", team: {} }] }],
      }),
    ).toBeNull();
  });
});

describe("parseOddsSummary", () => {
  const validSummary = {
    pickcenter: [
      {
        provider: { name: "DraftKings" },
        spread: -37.5,
        homeTeamOdds: { moneyLine: -100000 },
        awayTeamOdds: { moneyLine: 5000 },
      },
    ],
  };

  it("extracts provider and both moneylines", () => {
    expect(parseOddsSummary(validSummary)).toEqual({
      provider: "DraftKings",
      homeMoneyline: -100000,
      awayMoneyline: 5000,
      spread: -37.5,
    });
  });

  it("returns null when there's no pickcenter entry (no odds posted yet)", () => {
    expect(parseOddsSummary({})).toBeNull();
    expect(parseOddsSummary({ pickcenter: [] })).toBeNull();
    expect(parseOddsSummary(null)).toBeNull();
  });

  it("returns nulls for missing moneylines rather than throwing", () => {
    const noMoneyline = {
      pickcenter: [{ provider: { name: "DraftKings" }, spread: -42.5, homeTeamOdds: {}, awayTeamOdds: {} }],
    };
    expect(parseOddsSummary(noMoneyline)).toEqual({
      provider: "DraftKings",
      homeMoneyline: null,
      awayMoneyline: null,
      spread: -42.5,
    });
  });
});

describe("parseTeamStatistics", () => {
  const validResponse = {
    results: {
      stats: {
        categories: [
          {
            name: "passing",
            stats: [
              { name: "yardsPerGame", value: 422.6 },
              { name: "totalPointsPerGame", value: 33.4 },
              { name: "gamesPlayed", value: 14 },
            ],
          },
          {
            name: "miscellaneous",
            stats: [{ name: "turnOverDifferential", value: 4 }],
          },
        ],
      },
    },
  };

  it("finds each stat regardless of which category it's nested under", () => {
    expect(parseTeamStatistics(validResponse)).toEqual({
      pointsPerGame: 33.4,
      yardsPerGame: 422.6,
      turnoverMargin: 4,
      gamesPlayed: 14,
    });
  });

  it("returns nulls for stats it can't find instead of throwing", () => {
    expect(parseTeamStatistics({ results: { stats: { categories: [] } } })).toEqual({
      pointsPerGame: null,
      yardsPerGame: null,
      turnoverMargin: null,
      gamesPlayed: null,
    });
  });

  it("returns null entirely for malformed input", () => {
    expect(parseTeamStatistics({})).toBeNull();
    expect(parseTeamStatistics(null)).toBeNull();
    expect(parseTeamStatistics({ results: {} })).toBeNull();
  });
});

describe("isStaleSeasonStats", () => {
  it("flags a team with far more games played than weeks elapsed as stale (last season's fallback)", () => {
    expect(isStaleSeasonStats({ pointsPerGame: 33, yardsPerGame: 400, turnoverMargin: 2, gamesPlayed: 12 }, 1)).toBe(
      true,
    );
  });

  it("does not flag a plausible current-season game count", () => {
    expect(isStaleSeasonStats({ pointsPerGame: 33, yardsPerGame: 400, turnoverMargin: 2, gamesPlayed: 1 }, 1)).toBe(
      false,
    );
    expect(isStaleSeasonStats({ pointsPerGame: 33, yardsPerGame: 400, turnoverMargin: 2, gamesPlayed: 6 }, 7)).toBe(
      false,
    );
  });

  it("doesn't flag anything when the inputs needed to judge are missing", () => {
    expect(isStaleSeasonStats(null, 1)).toBe(false);
    expect(isStaleSeasonStats({ pointsPerGame: null, yardsPerGame: null, turnoverMargin: null, gamesPlayed: null }, 1)).toBe(
      false,
    );
    expect(isStaleSeasonStats({ pointsPerGame: 33, yardsPerGame: 400, turnoverMargin: 2, gamesPlayed: 12 }, null)).toBe(
      false,
    );
  });
});
