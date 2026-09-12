import { describe, expect, it } from "vitest";
import { ClosingLine, findClosingLine } from "./closingLines";

function line(overrides: Partial<ClosingLine>): ClosingLine {
  return {
    homeTeam: "SEA",
    awayTeam: "NE",
    commenceTime: "2026-09-13T17:00:00Z",
    homeMoneylineClose: -150,
    awayMoneylineClose: 130,
    capturedAt: "2026-09-13T16:00:00Z",
    ...overrides,
  };
}

describe("findClosingLine", () => {
  it("matches by exact team names within the date window", () => {
    const lines = [line({})];
    const result = findClosingLine(lines, "SEA", "NE", "2026-09-10");
    expect(result).not.toBeNull();
    expect(result!.homeMoneylineClose).toBe(-150);
  });

  it("returns null when the team names don't match", () => {
    const lines = [line({})];
    expect(findClosingLine(lines, "KC", "NE", "2026-09-10")).toBeNull();
  });

  it("returns null when the date is outside the match window", () => {
    const lines = [line({ commenceTime: "2026-01-01T17:00:00Z" })];
    expect(findClosingLine(lines, "SEA", "NE", "2026-09-10")).toBeNull();
  });

  it("picks the closest date when multiple candidates exist", () => {
    const lines = [
      line({ commenceTime: "2026-09-08T17:00:00Z", homeMoneylineClose: -100 }),
      line({ commenceTime: "2026-09-13T17:00:00Z", homeMoneylineClose: -200 }),
    ];
    const result = findClosingLine(lines, "SEA", "NE", "2026-09-12");
    expect(result!.homeMoneylineClose).toBe(-200); // Sept 13 is closer to Sept 12 than Sept 8 is
  });

  it("returns null with no lines at all", () => {
    expect(findClosingLine([], "SEA", "NE", "2026-09-10")).toBeNull();
  });
});
