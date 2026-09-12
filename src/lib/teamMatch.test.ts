import { describe, expect, it } from "vitest";
import { matchTeamName, normalizeTeamName, resolveOddsApiTeamName } from "./teamMatch";

describe("normalizeTeamName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTeamName("Texas A&M")).toBe("texas a m");
  });

  it("strips diacritics", () => {
    expect(normalizeTeamName("San José State")).toBe("san jose state");
  });

  it("drops apostrophes entirely rather than treating them as a separator", () => {
    expect(normalizeTeamName("Hawai'i")).toBe("hawaii");
    expect(normalizeTeamName("Hawaii")).toBe("hawaii");
  });
});

describe("matchTeamName", () => {
  const known = new Set([
    "Appalachian State",
    "Sam Houston State",
    "Southern Mississippi",
    "UMass",
    "UT San Antonio",
    "Connecticut",
    "San José State",
    "Hawai'i",
    "Ohio State",
  ]);

  it("matches an exact name", () => {
    expect(matchTeamName("Ohio State", known)).toBe("Ohio State");
  });

  it("resolves a known alias", () => {
    expect(matchTeamName("App State", known)).toBe("Appalachian State");
    expect(matchTeamName("Sam Houston", known)).toBe("Sam Houston State");
    expect(matchTeamName("Southern Miss", known)).toBe("Southern Mississippi");
    expect(matchTeamName("Massachusetts", known)).toBe("UMass");
    expect(matchTeamName("UTSA", known)).toBe("UT San Antonio");
    expect(matchTeamName("UConn", known)).toBe("Connecticut");
  });

  it("falls back to normalized matching for diacritic/punctuation differences", () => {
    expect(matchTeamName("San Jose State", known)).toBe("San José State");
    expect(matchTeamName("Hawaii", known)).toBe("Hawai'i");
  });

  it("returns null rather than guessing when there is no confident match", () => {
    expect(matchTeamName("West Georgia", known)).toBeNull();
    expect(matchTeamName("Some Random FCS School", known)).toBeNull();
  });

  it("resolves NFL's two abbreviation mismatches (LAR/WSH vs. nflverse's LA/WAS)", () => {
    const nflKnown = new Set(["LA", "WAS", "SEA", "KC"]);
    expect(matchTeamName("LAR", nflKnown)).toBe("LA");
    expect(matchTeamName("WSH", nflKnown)).toBe("WAS");
    expect(matchTeamName("SEA", nflKnown)).toBe("SEA");
  });
});

describe("resolveOddsApiTeamName", () => {
  it("resolves an NFL display name via the fixed table", () => {
    expect(resolveOddsApiTeamName("nfl", "Pittsburgh Steelers", new Set())).toBe("PIT");
    expect(resolveOddsApiTeamName("nfl", "Seattle Seahawks", new Set())).toBe("SEA");
  });

  it("returns null for an unrecognized NFL display name", () => {
    expect(resolveOddsApiTeamName("nfl", "Some Fake Team", new Set())).toBeNull();
  });

  it("resolves a CFB name via school-name prefix matching", () => {
    const known = new Set(["Ohio State", "Michigan"]);
    expect(resolveOddsApiTeamName("cfb", "Ohio State Buckeyes", known)).toBe("Ohio State");
    expect(resolveOddsApiTeamName("cfb", "Michigan Wolverines", known)).toBe("Michigan");
  });

  it("returns null for a CFB name with no matching prefix", () => {
    const known = new Set(["Ohio State"]);
    expect(resolveOddsApiTeamName("cfb", "Some FCS Team", known)).toBeNull();
  });
});
