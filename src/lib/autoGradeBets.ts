/**
 * Auto-settles a PENDING logged bet once its game shows up completed in one
 * of our own historical archives — no push notifications (this is a static,
 * client-only app with no backend to receive them from), just "check on
 * page load whether any pending bet's game has finished since last time."
 *
 * Only works for bets logged via a "Log this bet" link (This Week/Research/
 * Picks) — their description follows a fixed, parseable format. A
 * manually-typed description (e.g. "Lakers -4.5") never matches and stays
 * manual-only, which is correct: there's no archive to check it against.
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

/** Finds this parsed bet's completed game in one archive, and whether the picked side won — null if no confident match. */
function resolveInArchive(parsed: ParsedBetDescription, betDate: string, games: Game[]): { won: boolean } | null {
  const known = new Set<string>();
  for (const g of games) {
    known.add(g.homeTeam);
    known.add(g.awayTeam);
  }
  const home = matchTeamName(parsed.home, known);
  const away = matchTeamName(parsed.away, known);
  if (!home || !away) return null;
  const picked = matchTeamName(parsed.pickedTeam, known);
  if (picked !== home && picked !== away) return null;

  const candidates = games
    .filter((g) => g.homeTeam === home && g.awayTeam === away && daysApart(betDate, g.date) <= MATCH_WINDOW_DAYS)
    .sort((a, b) => daysApart(betDate, a.date) - daysApart(betDate, b.date));
  const game = candidates[0];
  if (!game || game.homeScore === game.awayScore) return null; // no match, or a tie — don't guess

  const homeWon = game.homeScore > game.awayScore;
  return { won: picked === home ? homeWon : !homeWon };
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
    const parsed = parseLoggedBetDescription(bet.description);
    if (!parsed) return bet;
    const result = resolveInArchive(parsed, bet.date, cfbGames) ?? resolveInArchive(parsed, bet.date, nflGames);
    if (!result) return bet;
    gradedCount++;
    return { ...bet, outcome: result.won ? "win" : "loss", settledAuto: true };
  });
  return { bets: graded, gradedCount };
}
