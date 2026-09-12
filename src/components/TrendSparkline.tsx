"use client";

import { useMemo } from "react";

const WIDTH = 320;
const HEIGHT = 64;
const PAD = 4;

/**
 * Minimal cumulative-units performance chart — no axes, no ticks, just the
 * shape of the trend over time (TrendsCenter's own trend cards use exactly
 * this kind of small area chart). `values` is the running unit total after
 * each decided game, oldest to newest (situationalTrends.ts's
 * cumulativeUnits) — color follows whether the trend nets positive or
 * negative overall, since a "trend" that's actually been losing money
 * shouldn't get painted the same reassuring green as a winning one.
 */
export function TrendSparkline({ values }: { values: number[] }) {
  const { path, areaPath, color } = useMemo(() => {
    if (values.length < 2) return { path: "", areaPath: "", color: "var(--text-muted)" };
    const withZero = [0, ...values];
    const lo = Math.min(...withZero);
    const hi = Math.max(...withZero);
    const span = Math.max(hi - lo, 1e-6);
    const plotW = WIDTH - PAD * 2;
    const plotH = HEIGHT - PAD * 2;
    const xScale = (i: number) => PAD + (i / (withZero.length - 1)) * plotW;
    const yScale = (v: number) => PAD + (1 - (v - lo) / span) * plotH;

    const points = withZero.map((v, i) => [xScale(i), yScale(v)] as const);
    const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${path} L${points[points.length - 1][0].toFixed(1)},${(HEIGHT - PAD).toFixed(1)} L${points[0][0].toFixed(1)},${(HEIGHT - PAD).toFixed(1)} Z`;

    const last = values[values.length - 1];
    const color = last > 0 ? "var(--status-good)" : last < 0 ? "var(--status-critical)" : "var(--text-muted)";
    return { path, areaPath, color };
  }, [values]);

  if (values.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs" style={{ height: HEIGHT, color: "var(--text-muted)" }}>
        Not enough decided games to chart yet.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-16 w-full" role="img" aria-label="Cumulative units over time">
      <path d={areaPath} fill={color} opacity={0.14} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
