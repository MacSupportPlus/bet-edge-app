/**
 * Real closing moneylines (see scripts/fetch-live-odds.mjs's
 * captureClosingLines) — captured whenever a game is within a few hours of
 * kickoff, resolved to the historical archive's own team-name convention so
 * a logged bet's homeTeam/awayTeam fields (bankroll.ts) can look this up
 * directly. Coverage only starts from whenever the live-odds refresh
 * workflow began running with this feature — there's no way to backfill a
 * closing line for a game that already happened before that.
 */

import { Sport } from "./espn";

export interface ClosingLine {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeMoneylineClose: number;
  awayMoneylineClose: number;
  capturedAt: string;
}

interface RawClosingLinesFile {
  lines: ClosingLine[];
}

/** Fetches public/data/{sport}-closing-lines.json — an empty array (not an error) if it hasn't been generated yet. */
export async function loadClosingLines(sport: Sport): Promise<ClosingLine[]> {
  const res = await fetch(`/data/${sport}-closing-lines.json`);
  if (!res.ok) return [];
  const raw: RawClosingLinesFile = await res.json();
  return raw.lines;
}

/** How far from a bet's logged date a matching closing line's game date can be — same reasoning/window as autoGradeBets.ts's MATCH_WINDOW_DAYS. */
const MATCH_WINDOW_DAYS = 5;

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000);
}

/** Finds the closing line for a bet's game, matching by team names and closest date within MATCH_WINDOW_DAYS — null if no confident match. */
export function findClosingLine(lines: ClosingLine[], homeTeam: string, awayTeam: string, betDate: string): ClosingLine | null {
  const candidates = lines
    .filter((l) => l.homeTeam === homeTeam && l.awayTeam === awayTeam && daysApart(betDate, l.commenceTime) <= MATCH_WINDOW_DAYS)
    .sort((a, b) => daysApart(betDate, a.commenceTime) - daysApart(betDate, b.commenceTime));
  return candidates[0] ?? null;
}
