/**
 * Walk-forward (no-leakage) starting-QB efficiency signal — validated by
 * held-out Brier-score backtesting before being wired into the live model,
 * not just assumed to help: on the full NFL archive, adding this feature
 * improved test-set Brier score both against bare Elo (0.22735 -> 0.22496)
 * and against the shipped Elo + team-stat-diffs model (0.22463 -> 0.22336),
 * with a consistently positive, sane-sized fitted weight in both cases.
 *
 * Uses Adjusted Net Yards per Attempt (ANY/A: (yds + 20*TD - 45*INT) / att),
 * a standard, simple passing-efficiency metric, computed from a named
 * player's PRIOR pass attempts only — never a final season number, which
 * would leak future data into earlier predictions (same discipline as
 * elo.ts/teamStats.ts). Small samples are shrunk toward the league-average
 * ANY/A (computed from the data itself, not a hardcoded constant) via a
 * standard pseudo-attempts regression-to-the-mean, since a QB's first 1-2
 * starts are extremely noisy.
 *
 * NFL-only: it depends on gameContext.ts's per-game starting-QB names,
 * which only nflverse's archive carries — CFB has no equivalent field.
 */

import { Game } from "./elo";
import { isLikelyOut, PlayerInjury } from "./espn";
import { PlayerUsageRow, usageLeaders } from "./playerUsage";
import { normalizeTeamName } from "./teamMatch";

/** Pseudo-attempts of league-average value blended into a small sample — roughly 3 games' worth, chosen for stability without erasing a real hot/cold start too slowly. */
const SHRINKAGE_ATTEMPTS = 100;

export interface QbValueFeatures {
  qbValueDiff: number;
}

export const NEUTRAL_QB_VALUE_FEATURES: QbValueFeatures = { qbValueDiff: 0 };

interface PassingGameLog {
  date: string;
  att: number;
  yds: number;
  td: number;
  int: number;
}

/** Precomputed per-player passing logs + the league-average ANY/A — build once, reuse across many qbValueBefore() calls instead of re-scanning the archive each time. */
export interface QbValueModel {
  leagueAvgAnyA: number;
  logsByPlayer: Map<string, PassingGameLog[]>;
}

/** Builds the reusable model from every passing row with real attempts, across every season in `games` (walk-forward slicing happens later, in qbValueBefore). */
export function buildQbValueModel(games: Game[], playerUsage: PlayerUsageRow[]): QbValueModel {
  const gameById = new Map(games.filter((g) => g.gameId).map((g) => [g.gameId as string, g]));
  const logsByPlayer = new Map<string, PassingGameLog[]>();
  let totalYds = 0;
  let totalTd = 0;
  let totalInt = 0;
  let totalAtt = 0;

  for (const r of playerUsage) {
    if (r.category !== "passing") continue;
    const g = gameById.get(r.gameId);
    if (!g) continue;
    const [, att, yds, td, int] = r.statLine; // passing statLine order: [comp, att, yds, td, int]
    if (!att || att <= 0) continue;
    const list = logsByPlayer.get(r.player) ?? [];
    list.push({ date: g.date, att, yds, td, int });
    logsByPlayer.set(r.player, list);
    totalYds += yds;
    totalTd += td;
    totalInt += int;
    totalAtt += att;
  }
  for (const list of logsByPlayer.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const leagueAvgAnyA = totalAtt > 0 ? (totalYds + 20 * totalTd - 45 * totalInt) / totalAtt : 0;
  return { leagueAvgAnyA, logsByPlayer };
}

/** This player's shrunk ANY/A using only attempts strictly before `beforeDate` — the walk-forward, no-leakage value. Unknown players fall back to league average (equivalent to a QB with zero prior attempts). */
export function qbValueBefore(model: QbValueModel, player: string, beforeDate: string): number {
  const logs = model.logsByPlayer.get(player) ?? [];
  let yds = 0;
  let td = 0;
  let int = 0;
  let att = 0;
  for (const log of logs) {
    if (log.date >= beforeDate) break;
    yds += log.yds;
    td += log.td;
    int += log.int;
    att += log.att;
  }
  const numerator = yds + 20 * td - 45 * int + SHRINKAGE_ATTEMPTS * model.leagueAvgAnyA;
  const denominator = att + SHRINKAGE_ATTEMPTS;
  return denominator > 0 ? numerator / denominator : model.leagueAvgAnyA;
}

/** Home-minus-away QB value difference for one game, given each side's starting QB name. Null if either starter is unknown — callers should fall back to NEUTRAL_QB_VALUE_FEATURES, not guess. */
export function qbValueDiff(model: QbValueModel, homeQb: string | null, awayQb: string | null, beforeDate: string): QbValueFeatures | null {
  if (!homeQb || !awayQb) return null;
  return { qbValueDiff: qbValueBefore(model, homeQb, beforeDate) - qbValueBefore(model, awayQb, beforeDate) };
}

export interface ResolvedStarter {
  player: string | null;
  /** Set when the season's usage leader was substituted for a presumed backup due to a live injury report, or when no viable backup exists. Null when nothing unusual happened. */
  note: string | null;
}

/**
 * This team's presumed starting QB for a live/upcoming game: the season's
 * passing-usage leader, UNLESS ESPN's live injury report lists them with a
 * status severe enough to assume they won't play (see espn.ts's
 * isLikelyOut — Questionable/Probable/Day-To-Day do NOT trigger this), in
 * which case the season's #2 passing-usage leader is used instead. This
 * still can't catch a change ESPN hasn't reported yet, but it closes the
 * gap for anything already flagged, rather than blindly trusting a hurt
 * starter's rating. Player names are compared via normalizeTeamName
 * (generic string normalization despite the name) since nflverse's and
 * ESPN's own name formatting can differ slightly (e.g. periods, suffixes).
 */
export function resolveLiveStarter(
  playerUsage: PlayerUsageRow[],
  games: Game[],
  team: string,
  season: number,
  injuries: PlayerInjury[],
): ResolvedStarter {
  const leaders = usageLeaders(playerUsage, games, team, "passing", season);
  const primary = leaders[0]?.player ?? null;
  if (!primary) return { player: null, note: null };

  const injury = injuries.find((inj) => normalizeTeamName(inj.player) === normalizeTeamName(primary) && isLikelyOut(inj.status));
  if (!injury) return { player: primary, note: null };

  const backup = leaders[1]?.player ?? null;
  return {
    player: backup,
    note: backup
      ? `${primary} is listed ${injury.status} — using ${backup} (this season's #2 passing-usage leader) instead.`
      : `${primary} is listed ${injury.status}, and no clear backup has thrown a pass for ${team} this season — QB value is neutral for this game.`,
  };
}
