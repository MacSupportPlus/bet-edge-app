import { describe, expect, it } from "vitest";
import { EloHistoryPoint } from "./elo";
import { fitMarginModel, formatSpread, predictMargin, predictTotal, seasonScoringAverage } from "./spreadModel";

describe("fitMarginModel / predictMargin", () => {
  it("recovers an exact linear relationship with no noise", () => {
    // margin = 2 + 0.01 * eloDiff, exactly, for every record.
    const records = [-200, -100, 0, 100, 200, 300].map((eloDiff) => ({ eloDiff, margin: 2 + 0.01 * eloDiff }));
    const model = fitMarginModel(records);
    expect(model.intercept).toBeCloseTo(2, 6);
    expect(model.slope).toBeCloseTo(0.01, 6);
    expect(predictMargin(model, 400)).toBeCloseTo(6, 6);
  });

  it("returns a flat zero model for no records, without throwing", () => {
    const model = fitMarginModel([]);
    expect(model).toEqual({ intercept: 0, slope: 0 });
    expect(predictMargin(model, 150)).toBe(0);
  });

  it("is insensitive to eloDiff when every record has the same eloDiff (zero variance in x)", () => {
    const records = [
      { eloDiff: 50, margin: 3 },
      { eloDiff: 50, margin: -7 },
    ];
    const model = fitMarginModel(records);
    expect(model.slope).toBe(0);
  });
});

describe("formatSpread", () => {
  it("favors home when predicted margin is positive", () => {
    expect(formatSpread("Ohio State", "Indiana", 14)).toBe("Ohio State -14.0");
  });

  it("favors away when predicted margin is negative", () => {
    expect(formatSpread("Ohio State", "Indiana", -3.5)).toBe("Indiana -3.5");
  });

  it("favors home on an exact pick'em (margin of 0)", () => {
    expect(formatSpread("Ohio State", "Indiana", 0)).toBe("Ohio State -0.0");
  });
});

describe("seasonScoringAverage", () => {
  const history: EloHistoryPoint[] = [
    { date: "2024-09-01", season: 2024, opponent: "A", isHome: true, pointsFor: 30, pointsAgainst: 10, result: "W", ratingAfter: 1520, opponentRatingBefore: 1480 },
    { date: "2024-09-08", season: 2024, opponent: "B", isHome: false, pointsFor: 20, pointsAgainst: 24, result: "L", ratingAfter: 1510, opponentRatingBefore: 1500 },
    { date: "2023-09-02", season: 2023, opponent: "C", isHome: true, pointsFor: 40, pointsAgainst: 0, result: "W", ratingAfter: 1600, opponentRatingBefore: 1400 },
  ];

  it("averages only the requested season", () => {
    expect(seasonScoringAverage(history, 2024)).toEqual({ pointsFor: 25, pointsAgainst: 17 });
  });

  it("returns null for a season with no games", () => {
    expect(seasonScoringAverage(history, 2025)).toBeNull();
  });

  it("returns null for undefined history", () => {
    expect(seasonScoringAverage(undefined, 2024)).toBeNull();
  });
});

describe("predictTotal", () => {
  it("averages both teams' combined scoring and points-allowed", () => {
    // home avg 30 for / 10 against, away avg 20 for / 24 against -> (30+10+20+24)/2 = 42
    expect(predictTotal({ pointsFor: 30, pointsAgainst: 10 }, { pointsFor: 20, pointsAgainst: 24 })).toBeCloseTo(42, 6);
  });
});
