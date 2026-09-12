import { describe, expect, it } from "vitest";
import { bestMoneylines, consensusSpread, consensusTotal, gameKey, LiveOddsGame } from "./liveOdds";

function book(overrides: Partial<LiveOddsGame["books"][number]>): LiveOddsGame["books"][number] {
  return {
    book: "Test Book",
    lastUpdate: "2026-09-11T00:00:00Z",
    homeMoneyline: null,
    awayMoneyline: null,
    homeSpread: null,
    homeSpreadOdds: null,
    awaySpreadOdds: null,
    total: null,
    overOdds: null,
    underOdds: null,
    ...overrides,
  };
}

function game(books: LiveOddsGame["books"]): LiveOddsGame {
  return { eventId: "e1", commenceTime: "2026-09-13T17:00:00Z", homeTeam: "Home Team", awayTeam: "Away Team", books };
}

describe("gameKey", () => {
  it("joins home and away display names with a separator", () => {
    expect(gameKey("Seattle Seahawks", "New England Patriots")).toBe("Seattle Seahawks|New England Patriots");
  });
});

describe("bestMoneylines", () => {
  it("picks the highest-payout price for each side across books", () => {
    const g = game([
      book({ book: "A", homeMoneyline: -265, awayMoneyline: 215 }),
      book({ book: "B", homeMoneyline: -250, awayMoneyline: 230 }), // better on both sides
      book({ book: "C", homeMoneyline: -275, awayMoneyline: 200 }),
    ]);
    expect(bestMoneylines(g)).toEqual({ home: -250, away: 230 });
  });

  it("returns null for a side with no posted price", () => {
    const g = game([book({ homeMoneyline: -150, awayMoneyline: null })]);
    expect(bestMoneylines(g)).toEqual({ home: -150, away: null });
  });

  it("returns nulls with no books at all", () => {
    expect(bestMoneylines(game([]))).toEqual({ home: null, away: null });
  });
});

describe("consensusSpread", () => {
  it("returns the median home spread across books", () => {
    const g = game([book({ homeSpread: 3 }), book({ homeSpread: 3.5 }), book({ homeSpread: 4 })]);
    expect(consensusSpread(g)).toBe(3.5);
  });

  it("averages the two middle values for an even number of books", () => {
    const g = game([book({ homeSpread: 3 }), book({ homeSpread: 4 })]);
    expect(consensusSpread(g)).toBe(3.5);
  });

  it("ignores books that haven't posted a spread", () => {
    const g = game([book({ homeSpread: 3 }), book({ homeSpread: null })]);
    expect(consensusSpread(g)).toBe(3);
  });

  it("returns null when no book has posted a spread", () => {
    expect(consensusSpread(game([book({ homeSpread: null })]))).toBeNull();
  });
});

describe("consensusTotal", () => {
  it("returns the median total across books", () => {
    const g = game([book({ total: 44 }), book({ total: 44.5 }), book({ total: 45 })]);
    expect(consensusTotal(g)).toBe(44.5);
  });
});
