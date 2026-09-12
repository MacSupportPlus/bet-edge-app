import { describe, expect, it } from "vitest";
import {
  BetEntry,
  drawdownSeries,
  realizedPath,
  settledInOrder,
  summarizeBankroll,
  theoreticalPath,
} from "./bankroll";

function bet(overrides: Partial<BetEntry>): BetEntry {
  return {
    id: Math.random().toString(36),
    date: "2026-01-01",
    description: "test bet",
    p: 0.55,
    b: 1,
    stake: 100,
    outcome: "win",
    ...overrides,
  };
}

describe("settledInOrder", () => {
  it("excludes pending bets and sorts by date", () => {
    const bets = [
      bet({ id: "b", date: "2026-01-03", outcome: "win" }),
      bet({ id: "pending", date: "2026-01-01", outcome: "pending" }),
      bet({ id: "a", date: "2026-01-02", outcome: "loss" }),
    ];
    const ordered = settledInOrder(bets);
    expect(ordered.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("preserves input order for same-day bets (stable tie-break)", () => {
    const bets = [
      bet({ id: "first", date: "2026-01-01" }),
      bet({ id: "second", date: "2026-01-01" }),
    ];
    expect(settledInOrder(bets).map((b) => b.id)).toEqual(["first", "second"]);
  });
});

describe("realizedPath", () => {
  it("starts at the starting bankroll with no bets", () => {
    expect(realizedPath(1000, [])).toEqual([{ step: 0, betId: null, bankroll: 1000 }]);
  });

  it("adds win profit at b:1 and subtracts loss stake", () => {
    const bets = [
      bet({ id: "w", date: "2026-01-01", stake: 100, b: 1, outcome: "win" }), // +100
      bet({ id: "l", date: "2026-01-02", stake: 50, outcome: "loss" }), // -50
    ];
    const path = realizedPath(1000, bets);
    expect(path.map((p) => p.bankroll)).toEqual([1000, 1100, 1050]);
  });

  it("refunds a push's stake with zero net profit, unlike a loss", () => {
    const bets = [bet({ id: "pu", date: "2026-01-01", stake: 100, b: 2, outcome: "push" })];
    expect(realizedPath(1000, bets)[1].bankroll).toBe(1000);
  });

  it("ignores pending bets entirely", () => {
    const bets = [
      bet({ id: "w", date: "2026-01-01", stake: 100, outcome: "win" }),
      bet({ id: "p", date: "2026-01-02", stake: 5000, outcome: "pending" }),
    ];
    const path = realizedPath(1000, bets);
    expect(path[path.length - 1].bankroll).toBe(1100);
  });

  it("computes uneven-odds profit correctly (b=2)", () => {
    const bets = [bet({ id: "w", date: "2026-01-01", stake: 100, b: 2, outcome: "win" })];
    expect(realizedPath(1000, bets)[1].bankroll).toBe(1200);
  });
});

describe("theoreticalPath", () => {
  it("sizes each bet at the recommended fractional-Kelly stake given the theoretical bankroll", () => {
    // p=0.55, b=1 -> f*=0.10; half-Kelly multiplier 0.5 -> stake = 5% of bankroll
    const bets = [
      bet({ id: "w1", date: "2026-01-01", p: 0.55, b: 1, stake: 999999, outcome: "win" }),
      bet({ id: "w2", date: "2026-01-02", p: 0.55, b: 1, stake: 1, outcome: "win" }),
    ];
    const path = theoreticalPath(1000, bets, 0.5);
    // step 1: stake = 0.05 * 1000 = 50, win -> 1050
    expect(path[1].bankroll).toBeCloseTo(1050, 10);
    // step 2: stake = 0.05 * 1050 = 52.5, win -> 1102.5
    expect(path[2].bankroll).toBeCloseTo(1102.5, 10);
  });

  it("stakes nothing once theoretical bankroll is exhausted", () => {
    const bets = [bet({ id: "w1", p: 0.3, b: 1, outcome: "loss" })]; // no edge -> kelly fraction 0
    const path = theoreticalPath(1000, bets, 1);
    expect(path[1].bankroll).toBe(1000); // no edge, no stake, no change
  });
});

describe("drawdownSeries", () => {
  it("tracks running peak and drawdown fraction", () => {
    const path = [
      { step: 0, betId: null, bankroll: 1000 },
      { step: 1, betId: "a", bankroll: 1200 }, // new peak
      { step: 2, betId: "b", bankroll: 900 }, // drawdown from 1200
      { step: 3, betId: "c", bankroll: 1200 }, // back to peak
    ];
    const dd = drawdownSeries(path);
    expect(dd.map((d) => d.peak)).toEqual([1000, 1200, 1200, 1200]);
    expect(dd[2].drawdown).toBeCloseTo((1200 - 900) / 1200, 10);
    expect(dd[3].drawdown).toBe(0);
  });
});

describe("summarizeBankroll", () => {
  it("summarizes win rate, staked, profit, and pending count", () => {
    const bets = [
      bet({ id: "w", date: "2026-01-01", stake: 100, b: 1, outcome: "win" }),
      bet({ id: "l", date: "2026-01-02", stake: 50, outcome: "loss" }),
      bet({ id: "p", date: "2026-01-03", stake: 200, outcome: "pending" }),
    ];
    const summary = summarizeBankroll(1000, bets);
    expect(summary.currentBankroll).toBe(1050);
    expect(summary.totalProfit).toBe(50);
    expect(summary.totalStaked).toBe(150); // settled only
    expect(summary.settledCount).toBe(2);
    expect(summary.pendingCount).toBe(1);
    expect(summary.winRate).toBeCloseTo(0.5, 10);
  });

  it("excludes pushes from both sides of the win-rate ratio, but still counts stake/settled/pending", () => {
    const bets = [
      bet({ id: "w", date: "2026-01-01", stake: 100, b: 1, outcome: "win" }),
      bet({ id: "l", date: "2026-01-02", stake: 50, outcome: "loss" }),
      bet({ id: "pu", date: "2026-01-03", stake: 75, outcome: "push" }),
    ];
    const summary = summarizeBankroll(1000, bets);
    expect(summary.winRate).toBeCloseTo(0.5, 10); // 1 win / (1 win + 1 loss), push excluded
    expect(summary.settledCount).toBe(3); // push counts as settled, not pending
    expect(summary.totalStaked).toBe(225); // push's stake still counted as put into action
    expect(summary.totalProfit).toBe(50); // push contributes 0
  });

  it("defaults sensibly with no bets logged", () => {
    const summary = summarizeBankroll(1000, []);
    expect(summary.currentBankroll).toBe(1000);
    expect(summary.totalProfit).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.maxDrawdown).toBe(0);
  });
});
