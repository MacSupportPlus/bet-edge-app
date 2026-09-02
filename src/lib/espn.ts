/**
 * Live data from ESPN's public, unofficial site API (no key required, CORS
 * open). Unofficial means ESPN can change or remove it without notice — the
 * parsing here is deliberately defensive (return null/skip rather than
 * throw) so one malformed game doesn't take down the whole page.
 */

import { mapWithConcurrency } from "./concurrency";

export interface UpcomingGame {
  espnId: string;
  date: string; // ISO datetime
  homeTeam: string; // ESPN's "location" field, e.g. "Ohio State"
  awayTeam: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  neutralSite: boolean;
}

export interface TeamSeasonStats {
  pointsPerGame: number | null;
  yardsPerGame: number | null;
  turnoverMargin: number | null;
}

export interface GameOdds {
  provider: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  spread: number | null;
}

/** American moneyline -> net decimal odds (b), e.g. +150 -> 1.5, -150 -> 0.667. */
export function moneylineToDecimalB(moneyline: number): number {
  return moneyline > 0 ? moneyline / 100 : 100 / Math.abs(moneyline);
}

/** American moneyline -> the market's own implied win probability (includes the book's vig). */
export function impliedProbability(moneyline: number): number {
  return moneyline > 0 ? 100 / (moneyline + 100) : Math.abs(moneyline) / (Math.abs(moneyline) + 100);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats a Date as ESPN's YYYYMMDD for its scoreboard `dates` query param. */
export function toEspnDate(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

interface EspnCompetitor {
  homeAway: string;
  team?: { id?: string; location?: string };
}

interface EspnScoreboardEvent {
  id: string | number;
  date: string;
  competitions?: Array<{ competitors?: EspnCompetitor[]; neutralSite?: boolean }>;
}

export function parseScoreboardEvent(event: unknown): UpcomingGame | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as Partial<EspnScoreboardEvent>;
  const comp = e.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  if (!e.id || !e.date || !home?.team?.location || !away?.team?.location) return null;
  return {
    espnId: String(e.id),
    date: e.date,
    homeTeam: home.team.location,
    awayTeam: away.team.location,
    homeTeamId: home.team.id ?? null,
    awayTeamId: away.team.id ?? null,
    neutralSite: Boolean(comp?.neutralSite),
  };
}

interface EspnPickcenterEntry {
  provider?: { name?: string };
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
  spread?: number;
}

interface EspnSummary {
  pickcenter?: EspnPickcenterEntry[];
}

export function parseOddsSummary(summary: unknown): GameOdds | null {
  if (typeof summary !== "object" || summary === null) return null;
  const entry = (summary as Partial<EspnSummary>).pickcenter?.[0];
  if (!entry) return null;
  const home = entry.homeTeamOdds?.moneyLine;
  const away = entry.awayTeamOdds?.moneyLine;
  return {
    provider: entry.provider?.name ?? "unknown",
    homeMoneyline: typeof home === "number" ? home : null,
    awayMoneyline: typeof away === "number" ? away : null,
    spread: typeof entry.spread === "number" ? entry.spread : null,
  };
}

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary";
const TEAM_STATS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams";

interface EspnStatEntry {
  name?: string;
  value?: number;
}

interface EspnStatCategory {
  stats?: EspnStatEntry[];
}

interface EspnTeamStatsResponse {
  results?: { stats?: { categories?: EspnStatCategory[] } };
}

/** Finds the first stat named `statName` in any category — categories aren't consistent across sports/seasons, so search all of them rather than assume one. */
function findStatValue(categories: EspnStatCategory[], statName: string): number | null {
  for (const category of categories) {
    const entry = category.stats?.find((s) => s.name === statName);
    if (entry && typeof entry.value === "number") return entry.value;
  }
  return null;
}

/**
 * Current-season, informational-only team stats (points/game, yards/game,
 * turnover margin) — descriptive context on This Week, not fed into the
 * prediction model. Returns null (never throws) on anything unexpected,
 * since ESPN's schema here is unofficial and undocumented.
 */
export function parseTeamStatistics(data: unknown): TeamSeasonStats | null {
  if (typeof data !== "object" || data === null) return null;
  const categories = (data as Partial<EspnTeamStatsResponse>).results?.stats?.categories;
  if (!Array.isArray(categories)) return null;
  return {
    pointsPerGame: findStatValue(categories, "totalPointsPerGame"),
    yardsPerGame: findStatValue(categories, "yardsPerGame"),
    turnoverMargin: findStatValue(categories, "turnOverDifferential"),
  };
}

export async function fetchTeamStatistics(teamId: string): Promise<TeamSeasonStats | null> {
  const res = await fetch(`${TEAM_STATS_URL}/${teamId}/statistics`);
  if (!res.ok) return null;
  const data = await res.json();
  return parseTeamStatistics(data);
}

/** Fetches season stats for many teams without firing them all at ESPN at once. Deduplicates ids first. */
export async function fetchTeamStatsForIds(
  teamIds: string[],
  concurrency = 8,
): Promise<Map<string, TeamSeasonStats | null>> {
  const uniqueIds = [...new Set(teamIds)];
  const results = await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
    try {
      return await fetchTeamStatistics(id);
    } catch {
      return null;
    }
  });
  return new Map(uniqueIds.map((id, i) => [id, results[i]]));
}

/** Upcoming FBS games from today through `daysAhead` days out. */
export async function fetchUpcomingCfbGames(daysAhead = 8): Promise<UpcomingGame[]> {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + daysAhead);
  const url = `${SCOREBOARD_URL}?groups=80&limit=400&dates=${toEspnDate(today)}-${toEspnDate(end)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard request failed: ${res.status}`);
  const data = await res.json();
  const events: unknown[] = Array.isArray(data.events) ? data.events : [];
  return events.map(parseScoreboardEvent).filter((g): g is UpcomingGame => g !== null);
}

export async function fetchGameOdds(espnId: string): Promise<GameOdds | null> {
  const res = await fetch(`${SUMMARY_URL}?event=${espnId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return parseOddsSummary(data);
}

/** Fetches odds for many games without firing them all at ESPN at once. */
export async function fetchOddsForGames(
  espnIds: string[],
  concurrency = 8,
): Promise<Map<string, GameOdds | null>> {
  const results = await mapWithConcurrency(espnIds, concurrency, async (id) => {
    try {
      return await fetchGameOdds(id);
    } catch {
      return null;
    }
  });
  return new Map(espnIds.map((id, i) => [id, results[i]]));
}
