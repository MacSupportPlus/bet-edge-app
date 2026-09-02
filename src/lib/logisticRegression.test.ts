import { describe, expect, it } from "vitest";
import { mulberry32 } from "./simulate";
import { predictProba, trainLogisticRegression } from "./logisticRegression";

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Generates n samples of x ~ U(-3,3) and y ~ Bernoulli(sigmoid(bias + weight*x)). */
function generate1D(n: number, bias: number, weight: number, seed: number) {
  const rng = mulberry32(seed);
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = (rng() - 0.5) * 6;
    const p = sigmoid(bias + weight * xi);
    x.push([xi]);
    y.push(rng() < p ? 1 : 0);
  }
  return { x, y };
}

describe("trainLogisticRegression", () => {
  it("recovers approximately the true bias/weight on a large synthetic dataset", () => {
    const trueBias = 0.5;
    const trueWeight = 1.2;
    const { x, y } = generate1D(5000, trueBias, trueWeight, 42);
    const model = trainLogisticRegression(x, y, { iterations: 300, learningRate: 0.5 });
    expect(Math.abs(model.bias - trueBias)).toBeLessThan(0.15);
    expect(Math.abs(model.weights[0] - trueWeight)).toBeLessThan(0.15);
  });

  it("loss decreases over training (learns something)", () => {
    const { x, y } = generate1D(1000, 0, 1.5, 7);
    const model = trainLogisticRegression(x, y, { iterations: 200 });
    expect(model.lossHistory[model.lossHistory.length - 1]).toBeLessThan(model.lossHistory[0]);
  });

  it("fits multi-feature input without error", () => {
    const rng = mulberry32(3);
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = (rng() - 0.5) * 4;
      const b = (rng() - 0.5) * 4;
      const p = sigmoid(0.3 + 0.8 * a - 0.6 * b);
      x.push([a, b]);
      y.push(rng() < p ? 1 : 0);
    }
    const model = trainLogisticRegression(x, y, { iterations: 200 });
    expect(model.weights).toHaveLength(2);
    expect(model.weights[0]).toBeGreaterThan(0); // positive relationship recovered in sign
    expect(model.weights[1]).toBeLessThan(0); // negative relationship recovered in sign
  });

  it("throws on empty or mismatched input", () => {
    expect(() => trainLogisticRegression([], [])).toThrow(RangeError);
    expect(() => trainLogisticRegression([[1]], [0, 1])).toThrow(RangeError);
  });
});

describe("predictProba", () => {
  it("always returns a value in (0, 1)", () => {
    const model = { weights: [1000], bias: -1000, lossHistory: [] };
    expect(predictProba(model, [1000])).toBeGreaterThan(0);
    expect(predictProba(model, [1000])).toBeLessThanOrEqual(1);
    expect(predictProba(model, [-1000])).toBeGreaterThanOrEqual(0);
  });

  it("is monotonically increasing in x for a positive weight", () => {
    const model = { weights: [2], bias: 0, lossHistory: [] };
    const low = predictProba(model, [-1]);
    const mid = predictProba(model, [0]);
    const high = predictProba(model, [1]);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("returns 0.5 at bias=0, x=0", () => {
    const model = { weights: [3], bias: 0, lossHistory: [] };
    expect(predictProba(model, [0])).toBeCloseTo(0.5, 10);
  });
});
