/**
 * Bankroll tracker math (Phase 3): pure functions over a log of real bets.
 *
 * Two paths are computed from the same log:
 *  - "realized": bankroll from the stakes you actually placed.
 *  - "theoretical": bankroll if every bet had used the recommended
 *    fractional-Kelly stake instead, given the SAME win/loss outcomes.
 *    This isolates sizing discipline from pick quality — same picks,
 *    different stake sizes.
 */

import { recommendedStake } from "./edge";

export type BetOutcome = "pending" | "win" | "loss" | "push";

export type BetType = "moneyline" | "spread" | "total";
export type BetSide = "home" | "away" | "over" | "under";

export interface BetEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  p: number; // 0-1, the win probability estimate used at bet time
  b: number; // net odds
  stake: number; // dollars actually staked
  outcome: BetOutcome;
  /** True if this bet's outcome was set by autoGradeBets.ts rather than a manual Win/Loss click. */
  settledAuto?: boolean;
  /**
   * Structured fields for auto-settling spread/total bets — optional and
   * absent for older/manually-typed bets, which stay settleable only via
   * the free-text moneyline format autoGradeBets.ts already parses out of
   * `description`. All four are required together for a spread/total bet
   * to be auto-gradeable; homeTeam/awayTeam let settlement look the game up
   * directly instead of re-parsing it out of `description`.
   */
  betType?: BetType;
  /** The line at bet time — spread points (home-favored convention, see gameContext.ts) or total points. */
  line?: number;
  /** "home"/"away" for a spread bet, "over"/"under" for a total bet. */
  side?: BetSide;
  homeTeam?: string;
  awayTeam?: string;
}

export interface BankrollPoint {
  /** Index into the chronological, settled-only bet list; 0 = starting bankroll. */
  step: number;
  betId: string | null;
  bankroll: number;
}

export interface DrawdownPoint {
  step: number;
  bankroll: number;
  peak: number;
  drawdown: number; // fraction, 0-1
}

/** Settled bets only, sorted chronologically (date, then stable input order). */
export function settledInOrder(bets: BetEntry[]): BetEntry[] {
  return bets
    .map((bet, i) => ({ bet, i }))
    .filter(({ bet }) => bet.outcome !== "pending")
    .sort((a, b) => (a.bet.date < b.bet.date ? -1 : a.bet.date > b.bet.date ? 1 : a.i - b.i))
    .map(({ bet }) => bet);
}

/** A push refunds the stake — net profit 0, same as never having bet (unlike a loss). */
function betProfit(bet: BetEntry, stake: number): number {
  if (bet.outcome === "win") return stake * bet.b;
  if (bet.outcome === "loss") return -stake;
  return 0;
}

/** Bankroll path from the stakes actually placed, in chronological order. */
export function realizedPath(startingBankroll: number, bets: BetEntry[]): BankrollPoint[] {
  const ordered = settledInOrder(bets);
  const path: BankrollPoint[] = [{ step: 0, betId: null, bankroll: startingBankroll }];
  let bankroll = startingBankroll;
  ordered.forEach((bet, i) => {
    bankroll += betProfit(bet, bet.stake);
    path.push({ step: i + 1, betId: bet.id, bankroll });
  });
  return path;
}

/**
 * Bankroll path if every settled bet had been sized at the recommended
 * fractional-Kelly stake (given the bankroll *at that point in the
 * theoretical path*), using the same outcomes that actually happened.
 */
export function theoreticalPath(
  startingBankroll: number,
  bets: BetEntry[],
  fractionalMultiplier: number,
): BankrollPoint[] {
  const ordered = settledInOrder(bets);
  const path: BankrollPoint[] = [{ step: 0, betId: null, bankroll: startingBankroll }];
  let bankroll = startingBankroll;
  ordered.forEach((bet, i) => {
    const stake = bankroll > 0 ? recommendedStake(bet.p, bet.b, bankroll, fractionalMultiplier) : 0;
    bankroll += betProfit(bet, stake);
    path.push({ step: i + 1, betId: bet.id, bankroll });
  });
  return path;
}

/** Running peak and drawdown (fraction below peak) at every step of a path. */
export function drawdownSeries(path: BankrollPoint[]): DrawdownPoint[] {
  let peak = -Infinity;
  return path.map((pt) => {
    peak = Math.max(peak, pt.bankroll);
    const drawdown = peak > 0 ? Math.max(0, (peak - pt.bankroll) / peak) : 0;
    return { step: pt.step, bankroll: pt.bankroll, peak, drawdown };
  });
}

export interface BankrollSummary {
  currentBankroll: number;
  totalStaked: number;
  totalProfit: number;
  settledCount: number;
  pendingCount: number;
  winRate: number; // 0-1, among settled bets
  currentDrawdown: number; // fraction
  maxDrawdown: number; // fraction
}

export function summarizeBankroll(startingBankroll: number, bets: BetEntry[]): BankrollSummary {
  const path = realizedPath(startingBankroll, bets);
  const dd = drawdownSeries(path);
  const settled = bets.filter((b) => b.outcome !== "pending");
  const wins = settled.filter((b) => b.outcome === "win").length;
  const losses = settled.filter((b) => b.outcome === "loss").length;
  const currentBankroll = path[path.length - 1].bankroll;

  return {
    currentBankroll,
    totalStaked: settled.reduce((sum, b) => sum + b.stake, 0),
    totalProfit: currentBankroll - startingBankroll,
    settledCount: settled.length,
    pendingCount: bets.length - settled.length,
    // Pushes are excluded from both sides of this ratio — a push is neutral, not a loss.
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    currentDrawdown: dd[dd.length - 1].drawdown,
    maxDrawdown: Math.max(0, ...dd.map((d) => d.drawdown)),
  };
}
