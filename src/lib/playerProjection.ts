/**
 * Walk-forward (no-leakage) player-yardage projection — validated per
 * category before being wired into anything, same discipline as qbValue.ts:
 * a player's own season-to-date yards/game average (using only PRIOR games,
 * min. 5 to start projecting) beats a naive league-average baseline for
 * every category, but by very different margins — checked individually,
 * not assumed to carry over:
 *
 *   - Rushing:   correlation 0.588, cuts MSE ~34% (1054.5 vs. 1592.0)
 *   - Receiving: correlation 0.407, cuts MSE ~14% (1186.9 vs. 1373.0)
 *   - Passing:   correlation 0.382, cuts MSE ~10% (6597.1 vs. 7334.9)
 *
 * All three are real, walk-forward-validated signals — but receiving and
 * passing are noticeably noisier than rushing, and any UI built on this
 * should weight confidence accordingly rather than treating all three the
 * same. This one function backs all three; only the stat-line index and
 * the resulting sigma (fit separately per category) differ.
 *
 * Uses the same "pool all top-3 usage rows for a named player" methodology
 * as computeSkillPlayerRankings (see that function's doc comment for the
 * real sample-size numbers behind that choice — rank-1-only leaves most
 * WR/TE below a usable sample). Passing pools all attempts credited to the
 * named player, not just their starts.
 *
 * Known, disclosed limitation: rushing/receiving yards are right-skewed (a
 * few big games), so a player's mean trailing average sits slightly ABOVE
 * their median game — in the rushing validation data, only 44.4% of games
 * exceeded the player's own trailing mean, not 50%. The Normal-distribution
 * over/under model this feeds (spreadModel.ts's overProbability) doesn't
 * capture that skew, so it will be very slightly optimistic about the OVER
 * and pessimistic about the UNDER — a real, disclosed imprecision, same
 * spirit as spreadModel.ts's own accuracy disclosures, not a hidden one.
 */

import { Game } from "./elo";
import { PlayerUsageRow } from "./playerUsage";
import { residualStdDev } from "./spreadModel";

export type ProjectionCategory = "passing" | "rushing" | "receiving";

/** statLine field order per category (see prepare-data.mjs's PLAYER_USAGE_CATEGORIES): passing yards is index 2 of [comp, att, yds, td, int]; rushing/receiving yards is index 1 of [car|rec, yds, td]. Exported so other modules reading raw statLines (e.g. the Player Command Page) use the same indices rather than re-guessing them. */
export const YARDS_INDEX: Record<ProjectionCategory, number> = { passing: 2, rushing: 1, receiving: 1 };

interface YardageLog {
  date: string;
  season: number;
  yards: number;
}

export interface PlayerProjectionModel {
  /** Population std dev of (actual - projected) over real walk-forward validation residuals — kept for a Normal fallback when `residuals` is too small (see spreadModel.ts's empiricalOverProbability). */
  sigma: number;
  /** The raw walk-forward (actual - predicted) residuals themselves — already no-leakage, so these feed spreadModel.ts's empiricalOverProbability directly, capturing this category's real skew (see module doc comment) instead of assuming a symmetric Normal distribution around sigma. */
  residuals: number[];
  logsByPlayer: Map<string, YardageLog[]>;
}

/** Minimum prior games this season before a projection is offered — matches the validation script exactly, so the shipped sigma is the one actually measured. */
const MIN_PRIOR_GAMES = 5;

export function buildPlayerProjectionModel(games: Game[], playerUsage: PlayerUsageRow[], category: ProjectionCategory): PlayerProjectionModel {
  const gameById = new Map(games.filter((g) => g.gameId).map((g) => [g.gameId as string, g]));
  const logsByPlayer = new Map<string, YardageLog[]>();
  const yardsIndex = YARDS_INDEX[category];
  for (const r of playerUsage) {
    if (r.category !== category) continue;
    const g = gameById.get(r.gameId);
    if (!g) continue;
    const yards = r.statLine[yardsIndex] ?? 0;
    const list = logsByPlayer.get(r.player) ?? [];
    list.push({ date: g.date, season: g.season, yards });
    logsByPlayer.set(r.player, list);
  }
  for (const list of logsByPlayer.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Fit sigma from the SAME walk-forward, no-leakage residuals a live
  // prediction would use — not from raw game-to-game variance, which would
  // measure something subtly different (and typically smaller).
  const residuals: { predicted: number; actual: number }[] = [];
  for (const list of logsByPlayer.values()) {
    let seasonGames: YardageLog[] = [];
    let curSeason: number | null = null;
    for (const g of list) {
      if (g.season !== curSeason) {
        curSeason = g.season;
        seasonGames = [];
      }
      if (seasonGames.length >= MIN_PRIOR_GAMES) {
        const predicted = seasonGames.reduce((s, x) => s + x.yards, 0) / seasonGames.length;
        residuals.push({ predicted, actual: g.yards });
      }
      seasonGames.push(g);
    }
  }

  return { sigma: residualStdDev(residuals), residuals: residuals.map((r) => r.actual - r.predicted), logsByPlayer };
}

/** This player's season-to-date yards/game average using only games strictly before `beforeDate` in `season` — null if they haven't cleared MIN_PRIOR_GAMES yet this season. */
export function projectedYardsBefore(model: PlayerProjectionModel, player: string, season: number, beforeDate: string): number | null {
  const logs = (model.logsByPlayer.get(player) ?? []).filter((l) => l.season === season && l.date < beforeDate);
  if (logs.length < MIN_PRIOR_GAMES) return null;
  return logs.reduce((s, l) => s + l.yards, 0) / logs.length;
}
