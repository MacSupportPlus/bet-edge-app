/**
 * Minimal logistic regression via batch gradient descent (Phase 4 model).
 *
 * No ML library — the whole point of "start simple" is that this is
 * short enough to read end-to-end and trust. Features are standardized
 * internally (zero mean, unit variance) for stable, learning-rate-tolerant
 * convergence; the fitted model undoes the standardization at predict time
 * so callers pass raw feature values in and get raw feature values out.
 */

export interface LogisticRegressionOptions {
  learningRate?: number;
  iterations?: number;
  /** L2 penalty strength (0 = none). */
  l2?: number;
}

export interface LogisticRegressionModel {
  /** Weights in the ORIGINAL (unstandardized) feature space. */
  weights: number[];
  bias: number;
  /** Binary cross-entropy loss at each iteration (for convergence checks). */
  lossHistory: number[];
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function standardize(x: number[][]): { z: number[][]; means: number[]; stds: number[] } {
  const n = x.length;
  const d = x[0]?.length ?? 0;
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(1);

  for (let j = 0; j < d; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += x[i][j];
    means[j] = sum / n;
  }
  for (let j = 0; j < d; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += (x[i][j] - means[j]) ** 2;
    const std = Math.sqrt(sumSq / n);
    stds[j] = std > 1e-12 ? std : 1;
  }

  const z = x.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  return { z, means, stds };
}

/** Trains on feature rows `x` (each row one sample) against binary labels `y` (0 or 1). */
export function trainLogisticRegression(
  x: number[][],
  y: number[],
  options: LogisticRegressionOptions = {},
): LogisticRegressionModel {
  const { learningRate = 0.5, iterations = 500, l2 = 0 } = options;
  const n = x.length;
  const d = x[0]?.length ?? 0;
  if (n === 0 || n !== y.length) throw new RangeError("x and y must be the same non-zero length");

  const { z, means, stds } = standardize(x);

  const wz = new Array(d).fill(0);
  let b = 0;
  const lossHistory: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    let loss = 0;

    for (let i = 0; i < n; i++) {
      let logit = b;
      for (let j = 0; j < d; j++) logit += wz[j] * z[i][j];
      const p = sigmoid(logit);
      const err = p - y[i];
      for (let j = 0; j < d; j++) gradW[j] += err * z[i][j];
      gradB += err;
      const eps = 1e-12;
      loss += -(y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps));
    }

    for (let j = 0; j < d; j++) {
      const reg = l2 * wz[j];
      wz[j] -= (learningRate * (gradW[j] / n + reg));
    }
    b -= learningRate * (gradB / n);
    lossHistory.push(loss / n);
  }

  // Undo standardization: p = sigmoid(b + sum wz_j * (x_j - mean_j) / std_j)
  //                          = sigmoid((b - sum wz_j*mean_j/std_j) + sum (wz_j/std_j) * x_j)
  const weights = wz.map((w, j) => w / stds[j]);
  const bias = b - wz.reduce((sum, w, j) => sum + (w * means[j]) / stds[j], 0);

  return { weights, bias, lossHistory };
}

export function predictProba(model: LogisticRegressionModel, x: number[]): number {
  let logit = model.bias;
  for (let j = 0; j < x.length; j++) logit += model.weights[j] * x[j];
  return sigmoid(logit);
}
