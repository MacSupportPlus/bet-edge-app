/**
 * Calibration diagnostics (Phase 4): is the model's p actually trustworthy?
 *
 * This matters more than model accuracy for this app specifically — Kelly
 * sizing is extremely sensitive to overconfident probabilities, so a model
 * that's "usually right" but poorly calibrated is more dangerous to size
 * bets off of than no model at all.
 */

/** Mean squared error between predicted probabilities and binary outcomes. Lower is better; 0 is perfect. */
export function brierScore(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0 || predictions.length !== outcomes.length) {
    throw new RangeError("predictions and outcomes must be the same non-zero length");
  }
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) sum += (predictions[i] - outcomes[i]) ** 2;
  return sum / predictions.length;
}

export interface ReliabilityBin {
  binStart: number;
  binEnd: number;
  avgPredicted: number | null;
  avgActual: number | null;
  count: number;
}

/**
 * Buckets predictions into `numBins` equal-width bins over [0, 1] and
 * compares, per bin, the average predicted probability against the actual
 * observed frequency of the outcome. A well-calibrated model tracks the
 * diagonal (avgPredicted ≈ avgActual) in every bin with enough samples.
 */
export function reliabilityBins(predictions: number[], outcomes: number[], numBins = 10): ReliabilityBin[] {
  if (predictions.length !== outcomes.length) {
    throw new RangeError("predictions and outcomes must be the same length");
  }
  const bins: { predSum: number; actualSum: number; count: number }[] = Array.from({ length: numBins }, () => ({
    predSum: 0,
    actualSum: 0,
    count: 0,
  }));

  for (let i = 0; i < predictions.length; i++) {
    const p = Math.min(1, Math.max(0, predictions[i]));
    const idx = Math.min(numBins - 1, Math.floor(p * numBins));
    bins[idx].predSum += p;
    bins[idx].actualSum += outcomes[i];
    bins[idx].count += 1;
  }

  return bins.map((bin, i) => ({
    binStart: i / numBins,
    binEnd: (i + 1) / numBins,
    avgPredicted: bin.count > 0 ? bin.predSum / bin.count : null,
    avgActual: bin.count > 0 ? bin.actualSum / bin.count : null,
    count: bin.count,
  }));
}
