/**
 * A named player's own game-by-game history, across every usage category
 * they've appeared in — the raw material for the Player Command Page's
 * sortable tables, hit-rate columns, and recent-games chart. Pools every
 * rank (not just the game's usage leader) so a player's own record is
 * complete even on games where a teammate out-touched them.
 */

import { Game } from "./elo";
import { PlayerUsageRow, UsageCategory } from "./playerUsage";

export interface PlayerGameLogEntry {
  gameId: string;
  date: string;
  season: number;
  team: string;
  opponent: string;
  isHome: boolean;
  category: UsageCategory;
  statLine: number[];
  rank: number;
}

/** Every game log entry for `player`, across all categories, most recent first. */
export function playerGameLog(usage: PlayerUsageRow[], games: Game[], player: string): PlayerGameLogEntry[] {
  const gameById = new Map(games.filter((g) => g.gameId).map((g) => [g.gameId as string, g]));
  const entries: PlayerGameLogEntry[] = [];
  for (const r of usage) {
    if (r.player !== player) continue;
    const g = gameById.get(r.gameId);
    if (!g) continue;
    const isHome = g.homeTeam === r.team;
    const opponent = isHome ? g.awayTeam : g.homeTeam;
    entries.push({ gameId: r.gameId, date: g.date, season: g.season, team: r.team, opponent, isHome, category: r.category, statLine: r.statLine, rank: r.rank });
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
}

/** This player's most recent team on file — the natural "current team" for display, without needing a live roster feed. */
export function currentTeamFor(log: PlayerGameLogEntry[]): string | null {
  return log[0]?.team ?? null;
}

/** Every distinct player name appearing in `usage` for `team`, for a team-scoped player picker. */
export function playersOnTeam(usage: PlayerUsageRow[], team: string): string[] {
  return [...new Set(usage.filter((r) => r.team === team).map((r) => r.player))].sort();
}
