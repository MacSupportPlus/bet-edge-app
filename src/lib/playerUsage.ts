/**
 * Per-game usage leaders (see prepare-data.mjs's fetchCfbGameBoxScore) — who
 * led each team in passing attempts, carries, receptions, and total tackles,
 * straight from ESPN's box score. Not fed into the win-probability model
 * (there's no reliable way to know BEFORE kickoff whether this week's usual
 * leader will actually play — that would need a live injury/depth-chart feed
 * we don't have), so this is purely informational context: who's actually
 * been playing, surfaced for a human to weigh alongside the model's number.
 */

import { Game } from "./elo";
import { Sport } from "./espn";

export type UsageCategory = "passing" | "rushing" | "receiving" | "defensive";

export const USAGE_CATEGORY_LABELS: Record<UsageCategory, string> = {
  passing: "QB (pass attempts)",
  rushing: "Leading rusher (carries)",
  receiving: "Leading receiver (catches)",
  defensive: "Leading tackler",
};

export interface PlayerUsageRow {
  gameId: string;
  team: string;
  category: UsageCategory;
  player: string;
  value: number;
}

interface RawPlayerUsageDataset {
  schema: string[];
  rows: [string, string, UsageCategory, string, number][];
}

/** Fetches public/data/{sport}-player-usage.json — empty array (not an error) if the sport doesn't have this archive. */
export async function loadPlayerUsage(sport: Sport): Promise<PlayerUsageRow[]> {
  const res = await fetch(`/data/${sport}-player-usage.json`);
  if (!res.ok) return [];
  const raw: RawPlayerUsageDataset = await res.json();
  return raw.rows.map(([gameId, team, category, player, value]) => ({ gameId, team, category, player, value }));
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
}

/** This team's most-frequent usage leader in one category this season, from real per-game data (not a live depth chart). */
export function primaryStarter(
  usage: PlayerUsageRow[],
  games: Game[],
  team: string,
  category: UsageCategory,
  season: number,
): StarterInfo | null {
  const teamGameIds = games
    .filter((g) => g.season === season && g.gameId && (g.homeTeam === team || g.awayTeam === team))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((g) => g.gameId!);

  const leaderByGame = new Map<string, string>();
  for (const row of usage) {
    if (row.team === team && row.category === category) leaderByGame.set(row.gameId, row.player);
  }

  const leadersInOrder = teamGameIds.map((id) => leaderByGame.get(id)).filter((p): p is string => !!p);
  if (leadersInOrder.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of leadersInOrder) counts.set(p, (counts.get(p) ?? 0) + 1);
  const [topPlayer, gamesLed] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    player: topPlayer,
    gamesLed,
    totalGames: leadersInOrder.length,
    ledMostRecentGame: leadersInOrder[leadersInOrder.length - 1] === topPlayer,
  };
}
