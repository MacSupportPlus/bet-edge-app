import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_FILTERS } from "./customTrends";
import { isTrendSaved, removeSavedTrend, SavedTrend, SavedTrendDescriptor, toggleSavedTrend } from "./savedTrends";

const curated: SavedTrendDescriptor = { kind: "curated", sport: "nfl", situationId: "home-favorite" };
const custom: SavedTrendDescriptor = { kind: "custom", sport: "nfl", label: "SEA at home", filters: { ...DEFAULT_CUSTOM_FILTERS, team: "SEA", location: "home" } };

describe("toggleSavedTrend / isTrendSaved", () => {
  it("is not saved by default", () => {
    expect(isTrendSaved([], curated)).toBe(false);
  });

  it("toggling adds a curated trend not already saved", () => {
    const result = toggleSavedTrend([], curated);
    expect(result).toHaveLength(1);
    expect(isTrendSaved(result, curated)).toBe(true);
  });

  it("toggling removes a curated trend already saved", () => {
    const added = toggleSavedTrend([], curated);
    const removed = toggleSavedTrend(added, curated);
    expect(removed).toEqual([]);
  });

  it("distinguishes the same curated situation across sports", () => {
    const nflSaved = toggleSavedTrend([], curated);
    expect(isTrendSaved(nflSaved, { ...curated, sport: "cfb" })).toBe(false);
  });

  it("treats two custom trends with different filters as distinct", () => {
    const other: SavedTrendDescriptor = { ...custom, filters: { ...custom.filters, location: "away" } };
    const saved = toggleSavedTrend([], custom);
    expect(isTrendSaved(saved, other)).toBe(false);
  });

  it("treats two custom trends with identical filters as the same, regardless of label", () => {
    const relabeled: SavedTrendDescriptor = { ...custom, label: "Different label, same filters" };
    const saved = toggleSavedTrend([], custom);
    expect(isTrendSaved(saved, relabeled)).toBe(true);
  });

  it("can hold both a curated and a custom trend at once", () => {
    const saved = toggleSavedTrend(toggleSavedTrend([], curated), custom);
    expect(saved).toHaveLength(2);
  });
});

describe("removeSavedTrend", () => {
  it("removes by id, leaving the rest untouched", () => {
    const saved: SavedTrend[] = [
      { id: "a", savedAt: "2024-01-01", descriptor: curated },
      { id: "b", savedAt: "2024-01-02", descriptor: custom },
    ];
    const result = removeSavedTrend(saved, "a");
    expect(result).toEqual([saved[1]]);
  });
});
