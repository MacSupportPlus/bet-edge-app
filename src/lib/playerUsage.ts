/**
 * Per-game usage leaders (see prepare-data.mjs's fetchCfbGameBoxScore) — who
 * led each team in passing attempts, carries, receptions, and total tackles,
 * straight from ESPN's box score, plus their full stat line for that game.
 * Not fed into the win-probability model (there's no reliable way to know
 * BEFORE kickoff whether this week's usual leader will actually play — that
 * would need a live injury/depth-chart feed we don't have), so this is
 * purely informational context: who's actually been playing and how well,
 * surfaced for a human to weigh alongside the model's number.
 */

import { Game } from "./elo";
import { Sport } from "./espn";

export type UsageCategory = "passing" | "rushing" | "receiving" | "defensive";

export const USAGE_CATEGORY_LABELS: Record<UsageCategory, string> = {
  passing: "QB",
  rushing: "Leading rusher",
  receiving: "Leading receiver",
  defensive: "Leading tackler",
};

/** statLine field order per category — must match PLAYER_USAGE_CATEGORIES' `fields` in prepare-data.mjs exactly. */
export const USAGE_STAT_FIELDS: Record<UsageCategory, string[]> = {
  passing: ["comp", "att", "yds", "td", "int"],
  rushing: ["car", "yds", "td"],
  receiving: ["rec", "yds", "td"],
  defensive: ["tot", "sacks", "tfl"],
};

export interface PlayerUsageRow {
  gameId: string;
  team: string;
  category: UsageCategory;
  player: string;
  /** 1 = that game's usage leader in this category; 2/3 = runners-up (see USAGE_TOP_N in prepare-data.mjs). */
  rank: number;
  statLine: number[];
}

interface RawPlayerUsageDataset {
  schema: string[];
  rows: [string, string, UsageCategory, string, number, number[]][];
}

/** Fetches public/data/{sport}-player-usage.json — empty array (not an error) if the sport doesn't have this archive. */
export async function loadPlayerUsage(sport: Sport): Promise<PlayerUsageRow[]> {
  const res = await fetch(`/data/${sport}-player-usage.json`);
  if (!res.ok) return [];
  const raw: RawPlayerUsageDataset = await res.json();
  return raw.rows.map(([gameId, team, category, player, rank, statLine]) => ({ gameId, team, category, player, rank, statLine }));
}

export interface StarterInfo {
  /** The player who's led this category most often among this team's games this season. */
  player: string;
  /** How many of the team's usage-tracked games this season this player led. */
  gamesLed: number;
  /** How many of the team's games this season have usage data at all. */
  totalGames: number;
  /** False if someone else led the category in the most recent tracked game — a possible injury/rotation signal. */
  ledMostRecentGame: boolean;
  /**
   * This player's stat line SUMMED over exactly the games they were recorded
   * as the leader for (see USAGE_STAT_FIELDS for field order/meaning) — not
   * a full season total if they lost the lead in some games along the way,
   * since we only ever kept the leader's row, not every player's.
   */
  statLine: number[];
}

/**
 * Every player who's led this team in one category at least once this
 * season, ranked by how many games they led (most first) — from real
 * per-game data (not a live depth chart), each with their combined stat
 * line across exactly the games they led. primaryStarter (index 0) is the
 * common case; index 1 is this function's other reason to exist — a
 * presumed backup, for when the primary starter shows up hurt on a live
 * injury report (see qbValue.ts's live-prediction callers).
 */
export function usageLeaders(usage: PlayerUsageRow[], games: Game[], team: string, category: UsageCategory, season: number): StarterInfo[] {
  const teamGameIds = new Set(
    games.filter((g) => g.season === season && g.gameId && (g.homeTeam === team || g.awayTeam === team)).map((g) => g.gameId!),
  );
  const orderedGameIds = games
    .filter((g) => g.season === season && g.gameId && (g.homeTeam === team || g.awayTeam === team))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((g) => g.gameId!);

  // Only rank 1 counts as "the game's leader" for continuity purposes — rank
  // 2/3 rows exist for depth-chart/ranking use, not to be treated as ties.
  const rowsThisSeason = usage.filter((r) => r.team === team && r.category === category && r.rank === 1 && teamGameIds.has(r.gameId));
  if (rowsThisSeason.length === 0) return [];

  const leaderByGame = new Map(rowsThisSeason.map((r) => [r.gameId, r.player]));
  const leadersInOrder = orderedGameIds.map((id) => leaderByGame.get(id)).filter((p): p is string => !!p);

  const counts = new Map<string, number>();
  for (const p of leadersInOrder) counts.set(p, (counts.get(p) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const fieldCount = USAGE_STAT_FIELDS[category].length;
  return ranked.map(([player, gamesLed]) => {
    const statLine = new Array(fieldCount).fill(0);
    for (const r of rowsThisSeason) {
      if (r.player !== player) continue;
      for (let i = 0; i < fieldCount; i++) statLine[i] += r.statLine[i] ?? 0;
    }
    return {
      player,
      gamesLed,
      totalGames: leadersInOrder.length,
      ledMostRecentGame: leadersInOrder[leadersInOrder.length - 1] === player,
      statLine,
    };
  });
}

/** This team's most-frequent usage leader in one category this season — see usageLeaders for the full ranked list (e.g. a presumed backup at index 1). */
export function primaryStarter(
  usage: PlayerUsageRow[],
  games: Game[],
  team: string,
  category: UsageCategory,
  season: number,
): StarterInfo | null {
  return usageLeaders(usage, games, team, category, season)[0] ?? null;
}

/** "213/312, 2450 yds, 21 TD, 6 INT" style summary, field order/labels from USAGE_STAT_FIELDS. */
export function formatStatLine(category: UsageCategory, statLine: number[]): string {
  if (category === "passing") {
    const [comp, att, yds, td, int] = statLine;
    return `${comp}/${att}, ${yds} yds, ${td} TD, ${int} INT`;
  }
  if (category === "rushing") {
    const [car, yds, td] = statLine;
    return `${car} car, ${yds} yds, ${td} TD`;
  }
  if (category === "receiving") {
    const [rec, yds, td] = statLine;
    return `${rec} rec, ${yds} yds, ${td} TD`;
  }
  const [tot, sacks, tfl] = statLine;
  return `${tot} tackles, ${sacks} sacks, ${tfl} TFL`;
}
