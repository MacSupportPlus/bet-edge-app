/**
 * Opponent-adjusted player rankings — same philosophy as the team
 * offense/defense ratings in rankings.ts: compare a player's output to what
 * an average player at that usage level does against the SAME strength of
 * opponent (bucketed into thirds by opponent Elo, league-wide), not a flat
 * per-game average.
 *
 * QB (computeQbRankings) only counts "rank 1" (the game's actual passing
 * leader) — a mop-up rank-2/3 appearance doesn't — since there's
 * essentially one starter per game. Rushing/receiving
 * (computeSkillPlayerRankings) pool all top-3-by-usage rows for a named
 * player instead; see that function's doc comment for the real
 * per-category sample-size numbers that motivated the difference. Defensive
 * usage isn't ranked at all — CFB's box-score-derived tackle counts are the
 * only source for it and are noisy/inconsistent enough (see
 * prepare-data.mjs's PLAYER_USAGE_CATEGORIES comment) that a ranking would
 * be more misleading than useful.
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

export type SkillPlayerCategory = "rushing" | "receiving";

export interface SkillPlayerRankingRow {
  player: string;
  team: string;
  games: number;
  /** Opponent-adjusted yards per game, relative to what an average player at this usage level does against the same-strength opponent. */
  rating: number;
  yardsPerGame: number;
  tdPerGame: number;
}

export interface SkillPlayerRankingsResult {
  rows: SkillPlayerRankingRow[];
  currentSeason: number;
  minGames: number;
}

/** Minimum qualifying games this season before a rusher/receiver gets ranked — see computeSkillPlayerRankings' doc comment for why this is the same threshold as QB despite a different qualifying rule. */
const MIN_SKILL_GAMES = 5;

/**
 * Opponent-adjusted rushing/receiving rankings — same tercile-bucketing
 * philosophy as computeQbRankings, but pools ALL top-3-by-usage rows for a
 * named player (not just rank 1) instead of requiring them to be the game's
 * outright usage leader.
 *
 * This deliberately differs from computeQbRankings' rank===1-only rule, and
 * that choice was checked against the real archive first, not assumed: a
 * rank-1-only filter already clears a healthy per-player sample for RUSHING
 * (median ~6 qualifying games/season in the 2025 NFL season, comparable to
 * QB's ~7) — but for RECEIVING it doesn't (median ~2, only ~38 NFL players
 * clearing a 5-game bar), because usage rotates across more players. Pooling
 * ranks 1-3 fixes receiving (median jumps to 5, 150+ players clear the bar)
 * without much diluting what "usage leader" means, since a real WR1/RB1
 * still lands in the top 3 almost every game they play. Applied to both
 * categories here for one consistent, well-understood method rather than
 * silently using a different rule per category.
 */
export function computeSkillPlayerRankings(
  games: Game[],
  playerUsage: PlayerUsageRow[],
  eloOptions: EloOptions,
  category: SkillPlayerCategory,
): SkillPlayerRankingsResult | null {
  if (games.length === 0 || playerUsage.length === 0) return null;
  const { ratingHistory } = runElo(games, eloOptions);
  const currentSeason = games[games.length - 1].season;

  const oppEloByGameTeam = new Map<string, number>();
  const seasonGameIds = new Set<string>();
  for (const [team, history] of ratingHistory) {
    for (const g of history) {
      if (g.season !== currentSeason || !g.gameId) continue;
      oppEloByGameTeam.set(`${g.gameId}|${team}`, g.opponentRatingBefore);
      seasonGameIds.add(g.gameId);
    }
  }

  const usageRows = playerUsage.filter((r) => r.category === category && seasonGameIds.has(r.gameId));
  if (usageRows.length === 0) return null;

  const entries = usageRows
    .map((r) => ({ ...r, oppElo: oppEloByGameTeam.get(`${r.gameId}|${r.team}`) }))
    .filter((r): r is PlayerUsageRow & { oppElo: number } => r.oppElo !== undefined);
  if (entries.length < 6) return null;

  const YARDS_INDEX = 1; // rushing: [car, yds, td]; receiving: [rec, yds, td] — yards is index 1 for both.
  const TD_INDEX = 2;
  const thresholds = tercileThresholds(entries.map((e) => e.oppElo));
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (const e of entries) {
    const b = bucketOf(e.oppElo, thresholds);
    sums[b] += e.statLine[YARDS_INDEX] ?? 0;
    counts[b]++;
  }
  const leagueAvgYards = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : s));

  const byPlayer = new Map<string, { player: string; team: string; games: number; ratingSum: number; yds: number; td: number }>();
  for (const e of entries) {
    const key = `${e.team}|${e.player}`;
    const prev = byPlayer.get(key) ?? { player: e.player, team: e.team, games: 0, ratingSum: 0, yds: 0, td: 0 };
    const bucket = bucketOf(e.oppElo, thresholds);
    const yds = e.statLine[YARDS_INDEX] ?? 0;
    byPlayer.set(key, {
      player: e.player,
      team: e.team,
      games: prev.games + 1,
      ratingSum: prev.ratingSum + (yds - leagueAvgYards[bucket]),
      yds: prev.yds + yds,
      td: prev.td + (e.statLine[TD_INDEX] ?? 0),
    });
  }

  const rows: SkillPlayerRankingRow[] = [...byPlayer.values()]
    .filter((p) => p.games >= MIN_SKILL_GAMES)
    .map((p) => ({
      player: p.player,
      team: p.team,
      games: p.games,
      rating: p.ratingSum / p.games,
      yardsPerGame: p.yds / p.games,
      tdPerGame: p.td / p.games,
    }));
  rows.sort((a, b) => b.rating - a.rating);

  return { rows, currentSeason, minGames: MIN_SKILL_GAMES };
}
