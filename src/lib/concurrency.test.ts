import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in the results regardless of completion order", async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("works when limit exceeds item count", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (n) => n * 2);
    expect(results).toEqual([2, 4]);
  });

  it("works fully sequentially at limit=1", async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns an empty array for empty input without hanging", async () => {
    const results = await mapWithConcurrency([], 5, async (n: number) => n);
    expect(results).toEqual([]);
  });

  it("propagates a thrown error from fn", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
