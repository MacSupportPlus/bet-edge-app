/**
 * Core edge-sizing math (Phase 1).
 *
 * Conventions:
 *  - p: probability of winning, in [0, 1]
 *  - b: net decimal odds (a win pays b units per 1 unit staked; a loss costs 1 unit).
 *       e.g. "even money" is b = 1, "+150" American odds is b = 1.5.
 *
 * These are pure functions with no I/O so they can be unit-tested against
 * known values independent of any UI.
 */

export interface EdgeSummary {
  p: number;
  b: number;
  q: number;
  /** Expected value per 1 unit staked. */
  expectancy: number;
  /** Variance of a single bet's outcome, per 1 unit staked. */
  variance: number;
  /** Standard deviation of a single bet's outcome, per 1 unit staked. */
  stdDev: number;
  /** True if expectancy > 0 — a mathematical edge exists. */
  hasEdge: boolean;
  /** Full-Kelly fraction of bankroll to stake. Clamped to 0 when there is no edge. */
  kellyFraction: number;
}

/** Expected value per 1 unit staked: E = p*b - q. */
export function expectancy(p: number, b: number): number {
  const q = 1 - p;
  return p * b - q;
}

/** Variance of a single bet's outcome per 1 unit staked: Var = p*q*(b+1)^2. */
export function variance(p: number, b: number): number {
  const q = 1 - p;
  return p * q * (b + 1) ** 2;
}

/** Standard deviation of a single bet's outcome per 1 unit staked. */
export function stdDev(p: number, b: number): number {
  return Math.sqrt(variance(p, b));
}

/**
 * Full-Kelly fraction: f* = (b*p - q) / b.
 * Returns 0 (not negative) when there is no positive edge — Kelly never
 * recommends betting against your own edge.
 */
export function kellyFraction(p: number, b: number): number {
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

/**
 * Geometric growth rate of bankroll per bet at stake fraction f:
 * g(f) = p * ln(1 + f*b) + q * ln(1 - f)
 *
 * f must be in [0, 1). Returns -Infinity at f = 1 (certain eventual ruin
 * from staking the entire bankroll on a bet that can lose).
 */
export function growthRate(p: number, b: number, f: number): number {
  if (f < 0 || f > 1) {
    throw new RangeError(`f must be in [0, 1], got ${f}`);
  }
  const q = 1 - p;
  if (f === 1) return q > 0 ? -Infinity : p * Math.log(1 + b);
  const winTerm = p * Math.log(1 + f * b);
  const loseTerm = q > 0 ? q * Math.log(1 - f) : 0;
  return winTerm + loseTerm;
}

export interface GrowthCurvePoint {
  f: number;
  g: number;
}

/** Samples g(f) at `points + 1` evenly spaced fractions from 0 to 1 inclusive. */
export function growthCurve(p: number, b: number, points = 200): GrowthCurvePoint[] {
  const curve: GrowthCurvePoint[] = [];
  for (let i = 0; i <= points; i++) {
    const f = i / points;
    curve.push({ f, g: growthRate(p, b, f) });
  }
  return curve;
}

/** Bundles the core Phase-1 outputs for a given (p, b) into one summary. */
export function summarizeEdge(p: number, b: number): EdgeSummary {
  return {
    p,
    b,
    q: 1 - p,
    expectancy: expectancy(p, b),
    variance: variance(p, b),
    stdDev: stdDev(p, b),
    hasEdge: expectancy(p, b) > 0,
    kellyFraction: kellyFraction(p, b),
  };
}

/**
 * Recommended stake in dollars for a given bankroll, applying a fractional
 * Kelly multiplier (e.g. 0.5 for half-Kelly, 0.25 for quarter-Kelly).
 * Returns 0 when there is no edge, regardless of multiplier.
 */
export function recommendedStake(
  p: number,
  b: number,
  bankroll: number,
  fractionalMultiplier: number,
): number {
  if (expectancy(p, b) <= 0) return 0;
  return kellyFraction(p, b) * fractionalMultiplier * bankroll;
}
