/**
 * Auto-settles a PENDING logged bet once its game shows up completed in one
 * of our own historical archives — no push notifications (this is a static,
 * client-only app with no backend to receive them from), just "check on
 * page load whether any pending bet's game has finished since last time."
 *
 * Two settlement paths:
 *  - Moneyline: only works for bets logged via the old "Log this bet" link
 *    format, whose description follows a fixed, parseable string. A
 *    manually-typed description (e.g. "Lakers -4.5") never matches and
 *    stays manual-only — there's no archive to check it against.
 *  - Spread/total: works for bets carrying the structured betType/line/
 *    side/homeTeam/awayTeam fields (bankroll.ts's BetEntry) set at log
 *    time, settled directly against the final score without needing to
 *    parse anything out of `description`. A bet whose margin/total lands
 *    exactly on the line is a push (BetOutcome's "push") — refunded, not
 *    guessed as a win or loss.
 */

import { BetEntry } from "./bankroll";
import { Game } from "./elo";
import { matchTeamName } from "./teamMatch";

export interface ParsedBetDescription {
  pickedTeam: string;
  away: string;
  home: string;
}

/** "{team} ML (+150) — {away} @ {home}" -> its three parts, or null for anything else (a manually-typed description). */
export function parseLoggedBetDescription(description: string): ParsedBetDescription | null {
  const m = description.match(/^(.+?) ML \([^)]*\) — (.+?) @ (.+)$/);
  if (!m) return null;
  return { pickedTeam: m[1].trim(), away: m[2].trim(), home: m[3].trim() };
}

/** How far from the bet's logged date a matching game's date can be — covers logging a bet a day or two before/after kickoff. */
const MATCH_WINDOW_DAYS = 3;

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000);
}

/** Finds a completed game between these two teams within the match window, closest to betDate — null if no confident match (unknown team names, or nothing within the window). */
function findCompletedGame(homeTeam: string, awayTeam: string, betDate: string, games: Game[]): Game | null {
  const known = new Set<string>();
  for (const g of games) {
    known.add(g.homeTeam);
    known.add(g.awayTeam);
  }
  const home = matchTeamName(homeTeam, known);
  const away = matchTeamName(awayTeam, known);
  if (!home || !away) return null;

  const candidates = games
    .filter((g) => g.homeTeam === home && g.awayTeam === away && daysApart(betDate, g.date) <= MATCH_WINDOW_DAYS)
    .sort((a, b) => daysApart(betDate, a.date) - daysApart(betDate, b.date));
  return candidates[0] ?? null;
}

/** Finds this parsed moneyline bet's completed game in one archive, and whether the picked side won — null if no confident match. */
function resolveMoneylineInArchive(parsed: ParsedBetDescription, betDate: string, games: Game[]): { won: boolean } | null {
  const game = findCompletedGame(parsed.home, parsed.away, betDate, games);
  if (!game || game.homeScore === game.awayScore) return null; // no match, or a tie — don't guess

  const known = new Set([game.homeTeam, game.awayTeam]);
  const picked = matchTeamName(parsed.pickedTeam, known);
  if (picked !== game.homeTeam && picked !== game.awayTeam) return null;

  const homeWon = game.homeScore > game.awayScore;
  return { won: picked === game.homeTeam ? homeWon : !homeWon };
}

export type SpreadTotalResult = { outcome: "win" | "loss" | "push" };

/**
 * Settles a structured spread/total bet (BetEntry's betType/line/side/
 * homeTeam/awayTeam) against a completed game's final score — no
 * description parsing needed. Home margin/total landing exactly on the
 * line is a push, not a guess.
 */
function resolveSpreadOrTotalInArchive(bet: BetEntry, games: Game[]): SpreadTotalResult | null {
  if (!bet.betType || bet.betType === "moneyline") return null;
  if (!bet.homeTeam || !bet.awayTeam || bet.line === undefined || !bet.side) return null;
  const game = findCompletedGame(bet.homeTeam, bet.awayTeam, bet.date, games);
  if (!game) return null;

  if (bet.betType === "spread") {
    if (bet.side !== "home" && bet.side !== "away") return null;
    const margin = game.homeScore - game.awayScore; // positive = home won by this much
    if (margin === bet.line) return { outcome: "push" };
    const homeCovers = margin > bet.line;
    return { outcome: (bet.side === "home" ? homeCovers : !homeCovers) ? "win" : "loss" };
  }

  // total
  if (bet.side !== "over" && bet.side !== "under") return null;
  const total = game.homeScore + game.awayScore;
  if (total === bet.line) return { outcome: "push" };
  const over = total > bet.line;
  return { outcome: (bet.side === "over" ? over : !over) ? "win" : "loss" };
}

export interface AutoGradeResult {
  bets: BetEntry[];
  gradedCount: number;
}

/** Auto-settles every PENDING bet whose game is now complete in either archive. Never touches an already-settled bet. */
export function autoGradeBets(bets: BetEntry[], cfbGames: Game[], nflGames: Game[]): AutoGradeResult {
  let gradedCount = 0;
  const graded = bets.map((bet): BetEntry => {
    if (bet.outcome !== "pending") return bet;

    if (bet.betType && bet.betType !== "moneyline") {
      const result = resolveSpreadOrTotalInArchive(bet, cfbGames) ?? resolveSpreadOrTotalInArchive(bet, nflGames);
      if (!result) return bet;
      gradedCount++;
      return { ...bet, outcome: result.outcome, settledAuto: true };
    }

    const parsed = parseLoggedBetDescription(bet.description);
    if (!parsed) return bet;
    const result = resolveMoneylineInArchive(parsed, bet.date, cfbGames) ?? resolveMoneylineInArchive(parsed, bet.date, nflGames);
    if (!result) return bet;
    gradedCount++;
    return { ...bet, outcome: result.won ? "win" : "loss", settledAuto: true };
  });
  return { bets: graded, gradedCount };
}
