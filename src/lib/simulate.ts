/**
 * Monte Carlo risk-of-ruin simulator (Phase 2).
 *
 * Unlike the closed-form ruin formula (which assumes a fixed bet size in
 * bankroll *units*), this simulates actual bettors re-sizing every bet off
 * their current bankroll — so it captures compounding, not just a random walk.
 */

/** Deterministic PRNG (mulberry32) so simulations are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SizingRule =
  /** Re-sized every bet: stake = fraction * CURRENT bankroll (e.g. Kelly-style). */
  | { type: "fraction"; fraction: number }
  /** Fixed in dollar terms: stake = fraction * STARTING bankroll, every bet. */
  | { type: "flat"; fraction: number };

export interface SimulationParams {
  p: number;
  b: number;
  startingBankroll: number;
  rule: SizingRule;
  numBets: number;
  numBettors: number;
  seed: number;
  /** Fraction of starting bankroll at/below which a path counts as "ruined". Default 1%. */
  ruinThreshold?: number;
}

export interface SimulationResult {
  /** [bettorIndex][betIndex] -> bankroll, each path length numBets + 1 (includes t=0). */
  paths: number[][];
  /** Ensemble (arithmetic) mean bankroll at each time step. */
  meanPath: number[];
  /** Median bankroll at each time step — the "typical single path". */
  medianPath: number[];
  /** Fraction of bettors whose bankroll ever hit the ruin threshold. */
  ruinFraction: number;
  terminalBankrolls: number[];
}

function stakeFor(
  bankroll: number,
  rule: SizingRule,
  startingBankroll: number,
): number {
  const desired = rule.type === "fraction" ? rule.fraction * bankroll : rule.fraction * startingBankroll;
  return Math.max(0, Math.min(desired, bankroll));
}

export function simulateOneBettorPath(params: {
  p: number;
  b: number;
  startingBankroll: number;
  rule: SizingRule;
  numBets: number;
  rng: () => number;
}): number[] {
  const { p, b, startingBankroll, rule, numBets, rng } = params;
  const path = new Array<number>(numBets + 1);
  path[0] = startingBankroll;
  let bankroll = startingBankroll;
  for (let i = 1; i <= numBets; i++) {
    if (bankroll > 0) {
      const stake = stakeFor(bankroll, rule, startingBankroll);
      const win = rng() < p;
      bankroll = win ? bankroll + stake * b : bankroll - stake;
    }
    path[i] = bankroll;
  }
  return path;
}

function mean(xs: number[]): number {
  return xs.reduce((a, x) => a + x, 0) / xs.length;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, c) => a - c);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function simulateEnsemble(params: SimulationParams): SimulationResult {
  const {
    p,
    b,
    startingBankroll,
    rule,
    numBets,
    numBettors,
    seed,
    ruinThreshold = 0.01,
  } = params;

  const rng = mulberry32(seed);
  const paths: number[][] = [];
  for (let i = 0; i < numBettors; i++) {
    paths.push(simulateOneBettorPath({ p, b, startingBankroll, rule, numBets, rng }));
  }

  const meanPath: number[] = new Array(numBets + 1);
  const medianPath: number[] = new Array(numBets + 1);
  for (let t = 0; t <= numBets; t++) {
    const valuesAtT = paths.map((path) => path[t]);
    meanPath[t] = mean(valuesAtT);
    medianPath[t] = median(valuesAtT);
  }

  const ruinLevel = ruinThreshold * startingBankroll;
  const ruinedCount = paths.filter((path) => path.some((v) => v <= ruinLevel)).length;
  const terminalBankrolls = paths.map((path) => path[path.length - 1]);

  return {
    paths,
    meanPath,
    medianPath,
    ruinFraction: ruinedCount / numBettors,
    terminalBankrolls,
  };
}
