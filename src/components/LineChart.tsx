"use client";

import { useMemo } from "react";

export interface LineChartSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

interface LineChartProps {
  series: LineChartSeries[];
  ariaLabel: string;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  /** Optional dashed horizontal reference line (e.g. the Elo starting rating, or 0 for turnover margin). */
  baseline?: number;
}

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 30, left: 56 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

const identity = (v: number) => `${Math.round(v)}`;

export function LineChart({ series, ariaLabel, yFormat = identity, xFormat = identity, baseline }: LineChartProps) {
  const nonEmpty = series.filter((s) => s.points.length > 0);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const allX = nonEmpty.flatMap((s) => s.points.map((p) => p.x));
    const allY = nonEmpty.flatMap((s) => s.points.map((p) => p.y)).concat(baseline !== undefined ? [baseline] : []);
    if (allX.length === 0 || allY.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const yLo = Math.min(...allY);
    const yHi = Math.max(...allY);
    const yPad = Math.max((yHi - yLo) * 0.1, 1);
    return { xMin: Math.min(...allX), xMax: Math.max(...allX), yMin: yLo - yPad, yMax: yHi + yPad };
  }, [nonEmpty, baseline]);

  const yTicks = useMemo(() => {
    const count = 4;
    return Array.from({ length: count + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / count);
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    const count = Math.min(5, Math.max(2, nonEmpty[0]?.points.length ?? 2) - 1);
    return Array.from({ length: count + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / count);
  }, [xMin, xMax, nonEmpty]);

  if (nonEmpty.length === 0) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-md text-sm"
        style={{ background: "var(--chart-surface)", color: "var(--text-muted)" }}
      >
        Not enough games yet to chart.
      </div>
    );
  }

  const xScale = (x: number) => PAD.left + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * plotW;
  const yScale = (y: number) => PAD.top + (1 - (yMax === yMin ? 0.5 : (y - yMin) / (yMax - yMin))) * plotH;

  const pathToD = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x).toFixed(2)},${yScale(p.y).toFixed(2)}`).join(" ");

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

        {yTicks.map((t, i) => (
          <line key={`gy-${i}`} x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(t)} y2={yScale(t)} stroke="var(--gridline)" strokeWidth={1} />
        ))}

        {baseline !== undefined && (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={yScale(baseline)}
            y2={yScale(baseline)}
            stroke="var(--baseline)"
            strokeWidth={1.5}
            strokeDasharray="3,3"
          />
        )}

        {yTicks.map((t, i) => (
          <text key={`yl-${i}`} x={PAD.left - 8} y={yScale(t) + 4} fontSize={10} fill="var(--text-muted)" textAnchor="end">
            {yFormat(t)}
          </text>
        ))}
        {xTicks.map((t, i) => (
          <text key={`xl-${i}`} x={xScale(t)} y={HEIGHT - PAD.bottom + 18} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}

        {nonEmpty.map((s) => (
          <path key={s.label} d={pathToD(s.points)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round" />
        ))}
        {nonEmpty.map((s) =>
          s.points.map((p, i) => (
            <circle key={`${s.label}-${i}`} cx={xScale(p.x)} cy={yScale(p.y)} r={2.5} fill={s.color} />
          )),
        )}
      </svg>

      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
