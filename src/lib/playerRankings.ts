/**
 * Opponent-adjusted QB ranking — same philosophy as the team offense/defense
 * ratings in rankings.ts: compare a QB's output to what an average QB does
 * against the SAME strength of opponent (bucketed into thirds by opponent
 * Elo, league-wide), not a flat per-game average.
 *
 * QB-only, not the full 4-category player-usage picture: rushing/receiving/
 * defensive usage is real but far more fragmented by committees and
 * rotation (median games "led" per player is 2-3 there, vs. 7+ at QB — see
 * the session notes this was scoped down from), too thin a sample to
 * responsibly rank. Only "rank 1" (the game's actual passing leader) counts
 * toward a QB's ranking — a mop-up rank-2/3 appearance doesn't.
 */

import { EloOptions, Game, runElo } from "./elo";
import { PlayerUsageRow } from "./playerUsage";

export interface QbRankingRow {
  player: string;
  team: string;
  gamesLed: number;
  /** Opponent-adjusted passing yards per game, relative to what an average starter does against the same-strength opponent. */
  rating: number;
  passYardsPerGame: number;
  completionPct: number;
  tdPerGame: number;
  intPerGame: number;
}

/** Minimum games led this season before a QB gets ranked at all — guards against a one-game sample looking like a real season. */
const MIN_GAMES_LED = 5;

function tercileThresholds(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return [sorted[Math.floor(n / 3)], sorted[Math.floor((2 * n) / 3)]];
}
function bucketOf(value: number, thresholds: [number, number]): number {
  if (value < thresholds[0]) return 0;
  if (value < thresholds[1]) return 1;
  return 2;
}

export interface QbRankingsResult {
  rows: QbRankingRow[]; // sorted by rating, descending
  currentSeason: number;
  minGamesLed: number;
}

export function computeQbRankings(games: Game[], playerUsage: PlayerUsageRow[], eloOptions: EloOptions): QbRankingsResult | null {
  if (games.length === 0 || playerUsage.length === 0) return null;
  const { ratingHistory } = runElo(games, eloOptions);
  const currentSeason = games[games.length - 1].season;

  // Opponent's PREGAME Elo for a given team's specific game — already
  // computed walk-forward by runElo, just re-keyed for a gameId+team lookup.
  const oppEloByGameTeam = new Map<string, number>();
  const seasonGameIds = new Set<string>();
  for (const [team, history] of ratingHistory) {
    for (const g of history) {
      if (g.season !== currentSeason || !g.gameId) continue;
      oppEloByGameTeam.set(`${g.gameId}|${team}`, g.opponentRatingBefore);
      seasonGameIds.add(g.gameId);
    }
  }

  // This season's rank-1 passing rows only — the actual starter that game.
  const passingRows = playerUsage.filter((r) => r.category === "passing" && r.rank === 1 && seasonGameIds.has(r.gameId));
  if (passingRows.length === 0) return null;

  const entries = passingRows
    .map((r) => ({ ...r, oppElo: oppEloByGameTeam.get(`${r.gameId}|${r.team}`) }))
    .filter((r): r is PlayerUsageRow & { oppElo: number } => r.oppElo !== undefined);
  if (entries.length < 6) return null;

  const thresholds = tercileThresholds(entries.map((e) => e.oppElo));
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (const e of entries) {
    const b = bucketOf(e.oppElo, thresholds);
    sums[b] += e.statLine[2] ?? 0; // passing yards
    counts[b]++;
  }
  const leagueAvgYards = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : s));

  const byPlayer = new Map<
    string,
    { player: string; team: string; games: number; ratingSum: number; comp: number; att: number; yds: number; td: number; int: number }
  >();
  for (const e of entries) {
    const key = `${e.team}|${e.player}`;
    const prev = byPlayer.get(key) ?? { player: e.player, team: e.team, games: 0, ratingSum: 0, comp: 0, att: 0, yds: 0, td: 0, int: 0 };
    const bucket = bucketOf(e.oppElo, thresholds);
    const [comp, att, yds, td, int] = e.statLine;
    byPlayer.set(key, {
      player: e.player,
      team: e.team,
      games: prev.games + 1,
      ratingSum: prev.ratingSum + (yds - leagueAvgYards[bucket]),
      comp: prev.comp + comp,
      att: prev.att + att,
      yds: prev.yds + yds,
      td: prev.td + td,
      int: prev.int + int,
    });
  }

  const rows: QbRankingRow[] = [...byPlayer.values()]
    .filter((p) => p.games >= MIN_GAMES_LED)
    .map((p) => ({
      player: p.player,
      team: p.team,
      gamesLed: p.games,
      rating: p.ratingSum / p.games,
      passYardsPerGame: p.yds / p.games,
      completionPct: p.att > 0 ? (p.comp / p.att) * 100 : 0,
      tdPerGame: p.td / p.games,
      intPerGame: p.int / p.games,
    }));
  rows.sort((a, b) => b.rating - a.rating);

  return { rows, currentSeason, minGamesLed: MIN_GAMES_LED };
}
