import { describe, expect, it } from "vitest";
import { bestPropPrice, PlayerPropQuote } from "./playerProps";

function quote(overrides: Partial<PlayerPropQuote>): PlayerPropQuote {
  return {
    market: "player_pass_yds",
    book: "Test Book",
    player: "Test Player",
    line: 250,
    overOdds: -110,
    underOdds: -110,
    yesOdds: null,
    ...overrides,
  };
}

describe("bestPropPrice", () => {
  it("takes the best (highest payout) price on each side across books", () => {
    const props = [
      quote({ book: "A", overOdds: -115, underOdds: -105 }),
      quote({ book: "B", overOdds: -108, underOdds: -112 }), // better over
      quote({ book: "C", overOdds: -120, underOdds: -100 }), // better under
    ];
    const result = bestPropPrice(props, "Test Player", "player_pass_yds");
    expect(result.bestOverOdds).toBe(-108);
    expect(result.bestUnderOdds).toBe(-100);
  });

  it("returns the median line across books", () => {
    const props = [quote({ line: 249.5 }), quote({ line: 250.5 }), quote({ line: 251.5 })];
    const result = bestPropPrice(props, "Test Player", "player_pass_yds");
    expect(result.line).toBe(250.5);
  });

  it("only considers quotes for the requested player and market", () => {
    const props = [
      quote({ player: "Test Player", market: "player_pass_yds", line: 250 }),
      quote({ player: "Other Player", market: "player_pass_yds", line: 999 }),
      quote({ player: "Test Player", market: "player_rush_yds", line: 999 }),
    ];
    const result = bestPropPrice(props, "Test Player", "player_pass_yds");
    expect(result.line).toBe(250);
  });

  it("returns all nulls when there are no matching quotes", () => {
    expect(bestPropPrice([], "Nobody", "player_pass_yds")).toEqual({ line: null, bestOverOdds: null, bestUnderOdds: null });
  });

  it("handles a single-outcome market (no line) without crashing", () => {
    const props = [quote({ market: "player_anytime_td", line: null, overOdds: null, underOdds: null, yesOdds: -155 })];
    const result = bestPropPrice(props, "Test Player", "player_anytime_td");
    expect(result.line).toBeNull();
    expect(result.bestOverOdds).toBeNull();
    expect(result.bestUnderOdds).toBeNull();
  });
});
