/**
 * Hit-rate/traffic-light/streak math for the Player Command Page — the
 * "did they usually clear this number" view, in Outlier.bet's exact color
 * scale (verified live: green 65%+, yellow 45-65%, red under 45%).
 *
 * One deliberate departure from Outlier: a genuinely small sample (fewer
 * than MIN_SAMPLE_FOR_TIER games) gets its own "insufficient" tier instead
 * of being forced into red/yellow/green — the same sample-size honesty
 * this app applies everywhere else (situationalTrends.ts, playerRankings.ts).
 * A 2-for-2 "100% green" from two games is noise dressed as a signal.
 */

export type HitRateTier = "green" | "yellow" | "red" | "insufficient";

/** CSS var per tier, shared by every component that renders a hit-rate tier (Player Command Page, Props Edge Finder) so the traffic-light convention looks identical everywhere it appears. */
export const TIER_COLOR: Record<HitRateTier, string> = {
  green: "var(--status-good)",
  yellow: "var(--series-2)",
  red: "var(--status-critical)",
  insufficient: "var(--text-muted)",
};

export interface HitRateResult {
  hits: number;
  total: number;
  /** 0-1, NaN if total is 0. */
  rate: number;
  tier: HitRateTier;
}

/** Below this many games, a hit rate isn't color-coded as a real signal. */
export const MIN_SAMPLE_FOR_TIER = 3;

export function tierFor(rate: number, n: number): HitRateTier {
  if (n < MIN_SAMPLE_FOR_TIER || Number.isNaN(rate)) return "insufficient";
  if (rate >= 0.65) return "green";
  if (rate >= 0.45) return "yellow";
  return "red";
}

/** What fraction of `values` cleared `threshold` — "over" (>) or "under" (<). */
export function hitRate(values: number[], threshold: number, direction: "over" | "under" = "over"): HitRateResult {
  const total = values.length;
  const hits = values.filter((v) => (direction === "over" ? v > threshold : v < threshold)).length;
  const rate = total > 0 ? hits / total : NaN;
  return { hits, total, rate, tier: tierFor(rate, total) };
}

/** How many of the most recent games (in `values`' own order — pass most-recent-first) hit consecutively, starting from the front. */
export function currentStreak(values: number[], threshold: number, direction: "over" | "under" = "over"): number {
  let streak = 0;
  for (const v of values) {
    const hit = direction === "over" ? v > threshold : v < threshold;
    if (!hit) break;
    streak++;
  }
  return streak;
}
