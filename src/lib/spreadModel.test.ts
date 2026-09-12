import { describe, expect, it } from "vitest";
import { EloHistoryPoint, Game } from "./elo";
import {
  conformalInterval,
  coverProbability,
  empiricalCoverProbability,
  empiricalOverProbability,
  fitMarginModel,
  formatSpread,
  historicalTotalResiduals,
  overProbability,
  predictMargin,
  predictTotal,
  residualStdDev,
  seasonScoringAverage,
} from "./spreadModel";

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

describe("residualStdDev", () => {
  it("is zero when the model is perfect", () => {
    const records = [1, 2, 3].map((v) => ({ predicted: v, actual: v }));
    expect(residualStdDev(records)).toBeCloseTo(0, 10);
  });

  it("matches a hand-computed population standard deviation", () => {
    // residuals: -2, 0, 2 -> mean 0, variance (4+0+4)/3 = 8/3
    const records = [
      { predicted: 10, actual: 8 },
      { predicted: 10, actual: 10 },
      { predicted: 10, actual: 12 },
    ];
    expect(residualStdDev(records)).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it("returns 0 for an empty input instead of NaN", () => {
    expect(residualStdDev([])).toBe(0);
  });
});

describe("coverProbability", () => {
  it("gives exactly 50% when the prediction lands exactly on the line", () => {
    // Precision limited to the erf approximation's own ~1.5e-7 max error (see normalCdf's doc comment).
    expect(coverProbability(3, 3, 10)).toBeCloseTo(0.5, 6);
  });

  it("gives home a probability well above 50% when comfortably favored beyond the line", () => {
    // predicted margin +14 vs a home line of +3, with modest uncertainty -> strongly favors home covering.
    expect(coverProbability(14, 3, 10)).toBeGreaterThan(0.8);
  });

  it("gives home a probability well below 50% when the prediction falls short of the line", () => {
    expect(coverProbability(1, 10, 5)).toBeLessThan(0.2);
  });

  it("is symmetric: covering by X is as likely as the mirrored miss is unlikely", () => {
    const p1 = coverProbability(10, 3, 7);
    const p2 = coverProbability(3, 10, 7);
    expect(p1).toBeCloseTo(1 - p2, 6);
  });

  it("falls back to a plain point-estimate comparison when sigma is 0 (no data to calibrate)", () => {
    expect(coverProbability(5, 3, 0)).toBe(1);
    expect(coverProbability(2, 3, 0)).toBe(0);
  });

  it("widens toward 50% as uncertainty (sigma) grows, for a fixed gap", () => {
    const tight = coverProbability(10, 3, 5);
    const loose = coverProbability(10, 3, 50);
    expect(tight).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0.5);
  });
});

describe("overProbability", () => {
  it("gives exactly 50% when the prediction lands exactly on the total line", () => {
    expect(overProbability(45, 45, 8)).toBeCloseTo(0.5, 6);
  });

  it("favors the over when the predicted total comfortably clears the line", () => {
    expect(overProbability(55, 44, 8)).toBeGreaterThan(0.8);
  });

  it("favors the under when the predicted total falls well short of the line", () => {
    expect(overProbability(35, 50, 8)).toBeLessThan(0.2);
  });
});

function game(overrides: Partial<Game>): Game {
  return {
    gameId: undefined,
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

describe("historicalTotalResiduals", () => {
  it("skips games before minPriorGames is met for both teams", () => {
    const games = [
      game({ date: "2024-09-01", homeTeam: "A", awayTeam: "B" }),
      game({ date: "2024-09-08", homeTeam: "A", awayTeam: "C" }),
    ];
    // Neither team has 3 prior games yet by the second game either.
    expect(historicalTotalResiduals(games, 3)).toHaveLength(0);
  });

  it("only uses games strictly BEFORE the one being predicted (no leakage)", () => {
    // Team A plays 4 low-scoring games, then one high-scoring game. If the
    // 5th game's prediction leaked its own huge score into the average used
    // to predict it, the residual would be tiny; walk-forward, it won't be.
    const games: Game[] = [];
    for (let i = 0; i < 4; i++) {
      games.push(game({ date: `2024-09-0${i + 1}`, homeTeam: "A", awayTeam: "X", homeScore: 10, awayScore: 10 }));
    }
    games.push(game({ date: "2024-10-01", homeTeam: "A", awayTeam: "X", homeScore: 60, awayScore: 60 }));
    // X also needs minPriorGames — reuse the same X-vs-A games (X's opponent is always A here, fine for this test).
    const residuals = historicalTotalResiduals(games, 4);
    expect(residuals).toHaveLength(1);
    // Predicted total based on 4 games of 10+10=20 each -> predicted ~20 (home avg 10 for/10 against, away same) -> predictTotal = 20.
    expect(residuals[0].predicted).toBeCloseTo(20, 6);
    expect(residuals[0].actual).toBe(120);
  });

  it("resets the running average at a new season", () => {
    const games: Game[] = [];
    for (let i = 0; i < 4; i++) games.push(game({ date: `2023-09-0${i + 1}`, season: 2023, homeTeam: "A", awayTeam: "X", homeScore: 50, awayScore: 50 }));
    for (let i = 0; i < 5; i++) games.push(game({ date: `2024-09-0${i + 1}`, season: 2024, homeTeam: "A", awayTeam: "X", homeScore: 10, awayScore: 10 }));
    const residuals = historicalTotalResiduals(games, 4);
    // Only the 5th 2024 game has 4 PRIOR 2024 games — if 2023's much higher
    // scoring had leaked in, the predicted total would be far from 20.
    expect(residuals).toHaveLength(1);
    expect(residuals[0].predicted).toBeCloseTo(20, 6);
  });
});

describe("empiricalCoverProbability / empiricalOverProbability", () => {
  it("falls back to the Normal estimate below MIN_RESIDUALS_FOR_EMPIRICAL", () => {
    const fewResiduals = [1, -2, 3];
    const empirical = empiricalCoverProbability(5, 3, fewResiduals, 7);
    const normal = coverProbability(5, 3, 7);
    expect(empirical).toBeCloseTo(normal, 6);
  });

  it("uses the empirical fraction above the line once there's enough data", () => {
    // 100 residuals: 80 are +100 (way above any reasonable line), 20 are -100.
    const residuals = [...Array(80).fill(100), ...Array(20).fill(-100)];
    // predicted=0, line=0 -> threshold=0 -> exactly the 80 positive residuals clear it.
    const p = empiricalCoverProbability(0, 0, residuals, 7);
    expect(p).toBeCloseTo(0.8, 6);
  });

  it("captures skew a Normal model would miss: mostly-small-positive, rarely-huge-negative residuals", () => {
    const residuals = [...Array(90).fill(1), ...Array(10).fill(-50)];
    // predicted=0, line=0.5 -> only the +1 residuals (90 of them) clear it.
    const empirical = empiricalOverProbability(0, 0.5, residuals, residualStdDevOf(residuals));
    expect(empirical).toBeCloseTo(0.9, 6);
  });
});

function residualStdDevOf(residuals: number[]): number {
  const mean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
  return Math.sqrt(residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / residuals.length);
}

describe("conformalInterval", () => {
  it("returns a degenerate interval (equal to the prediction) with no residuals", () => {
    const interval = conformalInterval(10, [], 0.8);
    expect(interval.lower).toBe(10);
    expect(interval.upper).toBe(10);
  });

  it("produces a wider interval for higher requested coverage", () => {
    const residuals = Array.from({ length: 200 }, (_, i) => i - 100); // uniform -100..99
    const narrow = conformalInterval(0, residuals, 0.5);
    const wide = conformalInterval(0, residuals, 0.95);
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower);
  });

  it("centers roughly around the prediction for symmetric residuals", () => {
    const residuals = Array.from({ length: 200 }, (_, i) => i - 100);
    const interval = conformalInterval(50, residuals, 0.9);
    const mid = (interval.lower + interval.upper) / 2;
    expect(mid).toBeCloseTo(50, 0);
  });
});
