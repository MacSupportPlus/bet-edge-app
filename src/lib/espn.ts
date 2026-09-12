/**
 * Live data from ESPN's public, unofficial site API (no key required, CORS
 * open). Unofficial means ESPN can change or remove it without notice — the
 * parsing here is deliberately defensive (return null/skip rather than
 * throw) so one malformed game doesn't take down the whole page.
 */

import { mapWithConcurrency } from "./concurrency";

export type Sport = "cfb" | "nfl";

const ESPN_SPORT_PATH: Record<Sport, string> = {
  cfb: "college-football",
  nfl: "nfl",
};

function scoreboardUrl(sport: Sport): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${ESPN_SPORT_PATH[sport]}/scoreboard`;
}
function summaryUrl(sport: Sport): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${ESPN_SPORT_PATH[sport]}/summary`;
}
function teamsUrl(sport: Sport): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${ESPN_SPORT_PATH[sport]}/teams`;
}

export interface UpcomingGame {
  espnId: string;
  date: string; // ISO datetime
  homeTeam: string; // ESPN's "location" field, e.g. "Ohio State" (CFB) or "Seattle" (NFL) — for display.
  awayTeam: string;
  /** ESPN's "abbreviation" field, e.g. "SEA" — NFL's dataset match key (see ESPN_TEAM_ALIASES); unused for CFB. */
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  /** ESPN's "displayName" field, e.g. "Seattle Seahawks" / "Ohio State Buckeyes" — verified live to match The Odds API's own team-name convention exactly for both sports, so this is the join key against live odds/props (see oddsApi.ts), not homeTeamAbbr/homeTeam. */
  homeTeamDisplayName: string | null;
  awayTeamDisplayName: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  neutralSite: boolean;
}

export interface TeamSeasonStats {
  pointsPerGame: number | null;
  yardsPerGame: number | null;
  turnoverMargin: number | null;
  /** Games counted in these totals — used to detect ESPN silently falling back to last season's final stats before this season has enough games played (see `isStaleSeasonStats`). */
  gamesPlayed: number | null;
}

export interface GameOdds {
  provider: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  spread: number | null;
  /** The game total (over/under line) — same pickcenter entry as spread/moneyline, just previously left unparsed. */
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
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
  team?: { id?: string; location?: string; abbreviation?: string; displayName?: string };
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
    homeTeamAbbr: home.team.abbreviation ?? null,
    awayTeamAbbr: away.team.abbreviation ?? null,
    homeTeamDisplayName: home.team.displayName ?? null,
    awayTeamDisplayName: away.team.displayName ?? null,
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
  overUnder?: number;
  overOdds?: number;
  underOdds?: number;
}

interface EspnInjuryAthlete {
  displayName?: string;
  position?: { abbreviation?: string };
}

interface EspnInjuryItem {
  status?: string;
  athlete?: EspnInjuryAthlete;
}

interface EspnInjuryTeamBlock {
  team?: { displayName?: string };
  injuries?: EspnInjuryItem[];
}

interface EspnSummary {
  pickcenter?: EspnPickcenterEntry[];
  injuries?: EspnInjuryTeamBlock[];
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
    total: typeof entry.overUnder === "number" ? entry.overUnder : null,
    overOdds: typeof entry.overOdds === "number" ? entry.overOdds : null,
    underOdds: typeof entry.underOdds === "number" ? entry.underOdds : null,
  };
}

export interface PlayerInjury {
  team: string;
  player: string;
  position: string | null;
  /** ESPN's own status label, e.g. "Questionable", "Doubtful", "Out", "Injured Reserve". */
  status: string;
}

/**
 * Both teams' injury reports from the same game-summary response already
 * fetched for odds (`summary.injuries`) — no extra request needed. Verified
 * live against real 2026-season data; ESPN's separately-documented
 * `againstTheSpread` field on this same endpoint was checked too but came
 * back empty on every completed game tried, so it isn't parsed here.
 */
/** Statuses severe enough to treat "this player probably won't play" as the working assumption. Deliberately excludes Questionable/Probable/Day-To-Day — those players usually do play, and treating every questionable tag as an automatic backup swap would be wrong more often than right. */
const LIKELY_OUT_STATUSES = new Set(["Out", "Doubtful", "Injured Reserve", "IR", "Suspended", "PUP"]);

export function isLikelyOut(status: string): boolean {
  return LIKELY_OUT_STATUSES.has(status);
}

export function parseInjuries(summary: unknown): PlayerInjury[] {
  if (typeof summary !== "object" || summary === null) return [];
  const blocks = (summary as Partial<EspnSummary>).injuries;
  if (!Array.isArray(blocks)) return [];
  const out: PlayerInjury[] = [];
  for (const block of blocks) {
    const team = block?.team?.displayName;
    if (!team || !Array.isArray(block.injuries)) continue;
    for (const item of block.injuries) {
      const player = item?.athlete?.displayName;
      const status = item?.status;
      if (!player || !status) continue;
      out.push({ team, player, position: item.athlete?.position?.abbreviation ?? null, status });
    }
  }
  return out;
}

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
    gamesPlayed: findStatValue(categories, "gamesPlayed"),
  };
}

/**
 * ESPN's team-statistics endpoint has no explicit "which season is this"
 * field, and early in a new season (before it has real current-season data)
 * it silently falls back to last season's final numbers instead of erroring
 * — confirmed by hitting it in week 1 of the 2026 season and getting back
 * "gamesPlayed: 12" from 2025. A team genuinely can't have played more games
 * than weeks have elapsed this season, so that mismatch is the tell.
 */
export function isStaleSeasonStats(stats: TeamSeasonStats | null, currentWeek: number | null): boolean {
  if (!stats || stats.gamesPlayed === null || currentWeek === null) return false;
  return stats.gamesPlayed > currentWeek + 1;
}

export async function fetchTeamStatistics(sport: Sport, teamId: string): Promise<TeamSeasonStats | null> {
  const res = await fetch(`${teamsUrl(sport)}/${teamId}/statistics`);
  if (!res.ok) return null;
  const data = await res.json();
  return parseTeamStatistics(data);
}

/** Fetches season stats for many teams without firing them all at ESPN at once. Deduplicates ids first. */
export async function fetchTeamStatsForIds(
  sport: Sport,
  teamIds: string[],
  concurrency = 8,
): Promise<Map<string, TeamSeasonStats | null>> {
  const uniqueIds = [...new Set(teamIds)];
  const results = await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
    try {
      return await fetchTeamStatistics(sport, id);
    } catch {
      return null;
    }
  });
  return new Map(uniqueIds.map((id, i) => [id, results[i]]));
}

export interface UpcomingSchedule {
  games: UpcomingGame[];
  /** The current week number per ESPN, or null if it wasn't in the response. Used to detect stale season stats — see `isStaleSeasonStats`. */
  currentWeek: number | null;
}

/** Upcoming games from today through `daysAhead` days out, plus the current week number. `groups=80` (FBS) only applies to CFB — NFL has no such split. */
export async function fetchUpcomingGames(sport: Sport, daysAhead = 8): Promise<UpcomingSchedule> {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + daysAhead);
  const groupParam = sport === "cfb" ? "&groups=80" : "";
  const url = `${scoreboardUrl(sport)}?limit=400${groupParam}&dates=${toEspnDate(today)}-${toEspnDate(end)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard request failed: ${res.status}`);
  const data = await res.json();
  const events: unknown[] = Array.isArray(data.events) ? data.events : [];
  const games = events.map(parseScoreboardEvent).filter((g): g is UpcomingGame => g !== null);
  const currentWeek = typeof data.week?.number === "number" ? data.week.number : null;
  return { games, currentWeek };
}

export interface GameSummary {
  odds: GameOdds | null;
  injuries: PlayerInjury[];
}

/** One fetch of ESPN's summary endpoint, shaped into both odds and injuries — avoids fetching the same URL twice when a caller wants both. */
export async function fetchGameSummary(sport: Sport, espnId: string): Promise<GameSummary> {
  const res = await fetch(`${summaryUrl(sport)}?event=${espnId}`);
  if (!res.ok) return { odds: null, injuries: [] };
  const data = await res.json();
  return { odds: parseOddsSummary(data), injuries: parseInjuries(data) };
}

export async function fetchGameOdds(sport: Sport, espnId: string): Promise<GameOdds | null> {
  return (await fetchGameSummary(sport, espnId)).odds;
}

/** Fetches odds for many games without firing them all at ESPN at once. */
export async function fetchOddsForGames(
  sport: Sport,
  espnIds: string[],
  concurrency = 8,
): Promise<Map<string, GameOdds | null>> {
  const results = await mapWithConcurrency(espnIds, concurrency, async (id) => {
    try {
      return await fetchGameOdds(sport, id);
    } catch {
      return null;
    }
  });
  return new Map(espnIds.map((id, i) => [id, results[i]]));
}
