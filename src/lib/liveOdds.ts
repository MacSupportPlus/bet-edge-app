/**
 * Live multi-book odds (see scripts/fetch-live-odds.mjs) — moneyline,
 * spread, and total from every book The Odds API tracks, refreshed on its
 * own more-frequent schedule than the historical archives. Keyed by team
 * DISPLAY name (e.g. "Seattle Seahawks"), which matches ESPN's own
 * `displayName` field exactly for both sports (verified live) — join to an
 * UpcomingGame via homeTeamDisplayName/awayTeamDisplayName (espn.ts), not
 * homeTeam/homeTeamAbbr.
 */

import { Sport } from "./espn";

export interface BookOdds {
  book: string;
  lastUpdate: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  /** Positive = home favored — same convention as gameContext.ts's spreadLine. */
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export interface LiveOddsGame {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  books: BookOdds[];
}

interface RawLiveOddsFile {
  fetchedAt: string;
  games: LiveOddsGame[];
}

export interface LiveOddsResult {
  fetchedAt: string;
  /** Keyed by "homeDisplayName|awayDisplayName" — see gameKey. */
  byMatchup: Map<string, LiveOddsGame>;
}

export function gameKey(homeTeamDisplayName: string, awayTeamDisplayName: string): string {
  return `${homeTeamDisplayName}|${awayTeamDisplayName}`;
}

/** Fetches public/data/{sport}-live-odds.json — an empty result (not an error) if it hasn't been generated yet (e.g. ODDS_API_KEY isn't configured). */
export async function loadLiveOdds(sport: Sport): Promise<LiveOddsResult> {
  const res = await fetch(`/data/${sport}-live-odds.json`);
  if (!res.ok) return { fetchedAt: "", byMatchup: new Map() };
  const raw: RawLiveOddsFile = await res.json();
  return {
    fetchedAt: raw.fetchedAt,
    byMatchup: new Map(raw.games.map((g) => [gameKey(g.homeTeam, g.awayTeam), g])),
  };
}

/** The best (highest payout) price for each side across every book — the actual price a line-shopper could get, not any single book's number. */
export function bestMoneylines(game: LiveOddsGame): { home: number | null; away: number | null } {
  let home: number | null = null;
  let away: number | null = null;
  for (const b of game.books) {
    if (b.homeMoneyline !== null && (home === null || b.homeMoneyline > home)) home = b.homeMoneyline;
    if (b.awayMoneyline !== null && (away === null || b.awayMoneyline > away)) away = b.awayMoneyline;
  }
  return { home, away };
}

/** The median line across every book that posted one — a robust "consensus" less swayed by one outlier book than a plain average. */
export function consensusSpread(game: LiveOddsGame): number | null {
  const values = game.books.map((b) => b.homeSpread).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** The median total line across every book that posted one — same idea as consensusSpread. */
export function consensusTotal(game: LiveOddsGame): number | null {
  const values = game.books.map((b) => b.total).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
