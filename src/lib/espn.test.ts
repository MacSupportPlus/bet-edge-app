import { describe, expect, it } from "vitest";
import { impliedProbability, moneylineToDecimalB, parseOddsSummary, parseScoreboardEvent, toEspnDate } from "./espn";

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
          { homeAway: "home", team: { location: "USC" } },
          { homeAway: "away", team: { location: "San José State" } },
        ],
      },
    ],
  };

  it("extracts home/away team and neutral-site flag", () => {
    const result = parseScoreboardEvent(validEvent);
    expect(result).toEqual({
      espnId: "401864494",
      date: "2026-08-29T19:00Z",
      homeTeam: "USC",
      awayTeam: "San José State",
      neutralSite: false,
    });
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
