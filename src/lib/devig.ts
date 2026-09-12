/**
 * Vig removal. A sportsbook's two raw per-side implied probabilities (see
 * espn.ts's impliedProbability) sum to MORE than 1 — the excess is the
 * book's profit margin ("vig"/"juice"), baked into both sides. Comparing a
 * model's probability against a vig-inflated market number makes every
 * market look artificially "beatable"; scanner.ts's trust guardrails
 * (MAX_TRUSTED_DISAGREEMENT/MAX_TRUSTED_RATIO) exist specifically to catch
 * when the model is the one that's wrong, so they should be measured
 * against the market's actual (vig-free) view, not its inflated one.
 *
 * This does NOT change how a bet's own payout/EV is computed (edge.ts still
 * uses the real, vigged odds — that's what the book actually pays) — de-vig
 * only sharpens the "should I trust this disagreement" check.
 *
 * Uses the standard "multiplicative" method: normalize both raw implied
 * probabilities so they sum to 1. Simpler methods exist (e.g. Shin's method)
 * that model longshot bias more precisely, but multiplicative is the
 * standard baseline and accurate enough for the trust guardrails' purpose.
 */

export interface DevigResult {
  fairHome: number;
  fairAway: number;
  /** How much the two raw implied probabilities exceed 1 (e.g. ~0.048 for standard -110/-110). */
  overround: number;
}

export function removeVig(rawHomeImplied: number, rawAwayImplied: number): DevigResult {
  const sum = rawHomeImplied + rawAwayImplied;
  if (sum <= 0) return { fairHome: rawHomeImplied, fairAway: rawAwayImplied, overround: 0 };
  return {
    fairHome: rawHomeImplied / sum,
    fairAway: rawAwayImplied / sum,
    overround: sum - 1,
  };
}
