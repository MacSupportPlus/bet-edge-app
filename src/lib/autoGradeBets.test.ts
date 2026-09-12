import { describe, expect, it } from "vitest";
import { BetEntry } from "./bankroll";
import { autoGradeBets, parseLoggedBetDescription } from "./autoGradeBets";
import { Game } from "./elo";

function game(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, date = "2026-09-06"): Game {
  return { date, season: 2026, homeTeam, awayTeam, homeScore, awayScore, neutral: false };
}

function bet(overrides: Partial<BetEntry>): BetEntry {
  return { id: "1", date: "2026-09-06", description: "", p: 0.6, b: 1, stake: 100, outcome: "pending", ...overrides };
}

describe("parseLoggedBetDescription", () => {
  it("parses the standard 'Log this bet' format", () => {
    expect(parseLoggedBetDescription("Ohio State ML (-150) — Michigan @ Ohio State")).toEqual({
      pickedTeam: "Ohio State",
      away: "Michigan",
      home: "Ohio State",
    });
  });

  it("returns null for a manually-typed description", () => {
    expect(parseLoggedBetDescription("Lakers -4.5")).toBeNull();
  });
});

describe("autoGradeBets", () => {
  const cfbGames: Game[] = [game("Ohio State", "Michigan", 30, 17, "2026-09-06")];

  it("settles a pending bet as a win when the picked team actually won", () => {
    const bets = [bet({ id: "a", description: "Ohio State ML (-150) — Michigan @ Ohio State" })];
    const result = autoGradeBets(bets, cfbGames, []);
    expect(result.gradedCount).toBe(1);
    expect(result.bets[0].outcome).toBe("win");
    expect(result.bets[0].settledAuto).toBe(true);
  });

  it("settles a pending bet as a loss when the picked team actually lost", () => {
    const bets = [bet({ id: "a", description: "Michigan ML (+130) — Michigan @ Ohio State" })];
    const result = autoGradeBets(bets, cfbGames, []);
    expect(result.bets[0].outcome).toBe("loss");
  });

  it("leaves a bet pending when no matching completed game is found", () => {
    const bets = [bet({ id: "a", description: "Alabama ML (-200) — Auburn @ Alabama" })];
    const result = autoGradeBets(bets, cfbGames, []);
    expect(result.gradedCount).toBe(0);
    expect(result.bets[0].outcome).toBe("pending");
  });

  it("never touches an already-settled bet, even if it would otherwise match", () => {
    const bets = [bet({ id: "a", description: "Ohio State ML (-150) — Michigan @ Ohio State", outcome: "loss" })];
    const result = autoGradeBets(bets, cfbGames, []);
    expect(result.gradedCount).toBe(0);
    expect(result.bets[0].outcome).toBe("loss");
    expect(result.bets[0].settledAuto).toBeUndefined();
  });

  it("leaves a manually-typed description alone (unparseable, so unmatched)", () => {
    const bets = [bet({ id: "a", description: "Lakers -4.5" })];
    const result = autoGradeBets(bets, cfbGames, []);
    expect(result.gradedCount).toBe(0);
    expect(result.bets[0].outcome).toBe("pending");
  });

  it("checks both archives, not just the first", () => {
    const nflGames: Game[] = [game("KC", "BUF", 24, 20, "2026-09-07")];
    const bets = [bet({ id: "a", description: "KC ML (-120) — BUF @ KC", date: "2026-09-07" })];
    const result = autoGradeBets(bets, cfbGames, nflGames);
    expect(result.bets[0].outcome).toBe("win");
  });

  it("does not guess on a tie", () => {
    const tieGames: Game[] = [game("Ohio State", "Michigan", 20, 20, "2026-09-06")];
    const bets = [bet({ id: "a", description: "Ohio State ML (-150) — Michigan @ Ohio State" })];
    const result = autoGradeBets(bets, tieGames, []);
    expect(result.gradedCount).toBe(0);
    expect(result.bets[0].outcome).toBe("pending");
  });

  describe("structured spread/total bets", () => {
    // Ohio State (home) beat Michigan 30-17: margin +13, total 47.

    it("settles a home spread bet as a win when home covers", () => {
      const bets = [bet({ id: "a", betType: "spread", line: 10, side: "home", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.gradedCount).toBe(1);
      expect(result.bets[0].outcome).toBe("win");
      expect(result.bets[0].settledAuto).toBe(true);
    });

    it("settles a home spread bet as a loss when home doesn't cover", () => {
      const bets = [bet({ id: "a", betType: "spread", line: 20, side: "home", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.bets[0].outcome).toBe("loss");
    });

    it("settles an away spread bet as a win when away covers", () => {
      const bets = [bet({ id: "a", betType: "spread", line: 20, side: "away", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.bets[0].outcome).toBe("win");
    });

    it("pushes a spread bet whose line exactly matches the final margin", () => {
      const bets = [bet({ id: "a", betType: "spread", line: 13, side: "home", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.gradedCount).toBe(1);
      expect(result.bets[0].outcome).toBe("push");
    });

    it("settles an over bet as a win when the total clears the line", () => {
      const bets = [bet({ id: "a", betType: "total", line: 40, side: "over", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.bets[0].outcome).toBe("win");
    });

    it("settles an under bet as a win when the total falls short of the line", () => {
      const bets = [bet({ id: "a", betType: "total", line: 55, side: "under", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.bets[0].outcome).toBe("win");
    });

    it("pushes a total bet whose line exactly matches the final total", () => {
      const bets = [bet({ id: "a", betType: "total", line: 47, side: "over", homeTeam: "Ohio State", awayTeam: "Michigan" })];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.bets[0].outcome).toBe("push");
    });

    it("leaves it pending when the structured fields are incomplete", () => {
      const bets = [bet({ id: "a", betType: "spread", side: "home", homeTeam: "Ohio State", awayTeam: "Michigan" })]; // no line
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.gradedCount).toBe(0);
      expect(result.bets[0].outcome).toBe("pending");
    });

    it("never touches an already-settled structured bet", () => {
      const bets = [
        bet({ id: "a", betType: "spread", line: 3, side: "away", homeTeam: "Ohio State", awayTeam: "Michigan", outcome: "win" }),
      ];
      const result = autoGradeBets(bets, cfbGames, []);
      expect(result.gradedCount).toBe(0);
      expect(result.bets[0].outcome).toBe("win");
    });
  });
});
