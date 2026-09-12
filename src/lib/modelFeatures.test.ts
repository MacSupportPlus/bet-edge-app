import { describe, expect, it } from "vitest";
import { buildFeatureVector } from "./modelFeatures";

describe("buildFeatureVector", () => {
  it("returns just eloDiff when neither team stats nor QB value are enabled", () => {
    expect(buildFeatureVector({ eloDiff: 42, teamStats: null, qbValue: null }, false, false)).toEqual([42]);
  });

  it("appends team-stat diffs when enabled, in the fixed order", () => {
    const inputs = { eloDiff: 10, teamStats: { totalYardsDiff: 5, turnoverMarginDiff: -1, offEpaDiff: 0.2 }, qbValue: null };
    expect(buildFeatureVector(inputs, true, false)).toEqual([10, 5, -1, 0.2]);
  });

  it("appends qbValueDiff last when enabled", () => {
    const inputs = { eloDiff: 10, teamStats: null, qbValue: { qbValueDiff: 1.5 } };
    expect(buildFeatureVector(inputs, false, true)).toEqual([10, 1.5]);
  });

  it("includes both, team stats before QB value, when both are enabled", () => {
    const inputs = {
      eloDiff: 10,
      teamStats: { totalYardsDiff: 5, turnoverMarginDiff: -1, offEpaDiff: 0.2 },
      qbValue: { qbValueDiff: 1.5 },
    };
    expect(buildFeatureVector(inputs, true, true)).toEqual([10, 5, -1, 0.2, 1.5]);
  });

  it("falls back to neutral team-stat features for a row missing them, without shrinking the vector", () => {
    expect(buildFeatureVector({ eloDiff: 10, teamStats: null, qbValue: null }, true, false)).toEqual([10, 0, 0, 0]);
  });

  it("falls back to neutral QB value for a row missing it, without shrinking the vector", () => {
    expect(buildFeatureVector({ eloDiff: 10, teamStats: null, qbValue: null }, false, true)).toEqual([10, 0]);
  });
});
