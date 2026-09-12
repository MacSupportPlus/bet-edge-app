import { describe, expect, it } from "vitest";
import { BetEntry } from "./bankroll";
import { ClosingLine } from "./closingLines";
import { computeClv } from "./clv";

function bet(overrides: Partial<BetEntry>): BetEntry {
  return {
    id: "1",
    date: "2026-09-10",
    description: "Seattle ML (+130) — New England @ Seattle",
    p: 0.55,
    b: 1.3,
    stake: 100,
    outcome: "pending",
    homeTeam: "Seattle",
    awayTeam: "New England",
    ...overrides,
  };
}

function closingLine(overrides: Partial<ClosingLine>): ClosingLine {
  return {
    homeTeam: "Seattle",
    awayTeam: "New England",
    commenceTime: "2026-09-13T17:00:00Z",
    homeMoneylineClose: -150,
    awayMoneylineClose: 130,
    capturedAt: "2026-09-13T16:00:00Z",
    ...overrides,
  };
}

describe("computeClv", () => {
  it("returns null for an unparseable (manually-typed) description", () => {
    const result = computeClv(bet({ description: "Lakers -4.5" }), closingLine({}));
    expect(result).toBeNull();
  });

  it("returns null when the bet has no homeTeam/awayTeam on file", () => {
    const result = computeClv(bet({ homeTeam: undefined, awayTeam: undefined }), closingLine({}));
    expect(result).toBeNull();
  });

  it("returns null when the picked team matches neither side of the closing line", () => {
    const result = computeClv(bet({ description: "Kansas City ML (+130) — New England @ Seattle" }), closingLine({}));
    expect(result).toBeNull();
  });

  it("identifies the home side correctly and computes positive CLV when you got a better price", () => {
    // You bet home (Seattle) at +130 (b=1.3); the line closed at -150 for home (a much shorter price) -> you beat the close.
    const result = computeClv(bet({ description: "Seattle ML (+130) — New England @ Seattle", b: 1.3 }), closingLine({ homeMoneylineClose: -150 }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("home");
    expect(result!.beatClose).toBe(true);
    expect(result!.clvPoints).toBeGreaterThan(0);
  });

  it("identifies the away side correctly", () => {
    const result = computeClv(
      bet({ description: "New England ML (+130) — New England @ Seattle", b: 1.3 }),
      closingLine({ awayMoneylineClose: 130 }),
    );
    expect(result).not.toBeNull();
    expect(result!.side).toBe("away");
  });

  it("computes negative CLV when the closing price was better than what you got", () => {
    // You bet at -110 (b ≈ 0.909); the line closed at +120 (a much better price for that side) -> you did NOT beat the close.
    const result = computeClv(
      bet({ description: "Seattle ML (-110) — New England @ Seattle", b: 100 / 110 }),
      closingLine({ homeMoneylineClose: 120 }),
    );
    expect(result!.beatClose).toBe(false);
    expect(result!.clvPoints).toBeLessThan(0);
  });

  it("computes yourImplied/closingImplied as proper probabilities summing sensibly", () => {
    const result = computeClv(bet({ description: "Seattle ML (+100) — New England @ Seattle", b: 1 }), closingLine({ homeMoneylineClose: -110 }));
    expect(result!.yourImplied).toBeCloseTo(0.5, 10); // b=1 -> 1/(1+1) = 0.5
    expect(result!.closingImplied).toBeCloseTo(110 / 210, 6); // moneylineToDecimalB(-110) = 100/110 -> 1/(1+100/110) = 110/210
  });
});
