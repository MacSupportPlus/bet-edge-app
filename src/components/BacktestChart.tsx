"use client";

import { useMemo } from "react";
import { BacktestPoint } from "@/lib/backtest";
import { compactCurrency } from "@/lib/format";

interface Series {
  label: string;
  color: string;
  path: BacktestPoint[];
}

interface BacktestChartProps {
  series: Series[];
  startingBankroll: number;
}

const WIDTH = 640;
const HEIGHT = 320;
const PAD = { top: 20, right: 16, bottom: 36, left: 76 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

export function BacktestChart({ series, startingBankroll }: BacktestChartProps) {
  const numSteps = (series[0]?.path.length ?? 1) - 1;

  const { floor, top } = useMemo(() => {
    const allValues = series.flatMap((s) => s.path.map((p) => p.bankroll)).concat(startingBankroll);
    const maxV = Math.max(...allValues, startingBankroll);
    return { floor: Math.max(startingBankroll * 1e-3, 1e-6), top: maxV * 1.15 };
  }, [series, startingBankroll]);

  const yTicks = useMemo(() => {
    const logMin = Math.ceil(Math.log10(floor));
    const logMax = Math.floor(Math.log10(top));
    const ticks: number[] = [];
    // Log-scale range can span dozens of orders of magnitude here — sample
    // at most ~6 evenly-spaced powers of ten rather than every single one.
    const span = logMax - logMin;
    const step = Math.max(1, Math.ceil(span / 6));
    for (let k = logMin; k <= logMax; k += step) ticks.push(10 ** k);
    return ticks;
  }, [floor, top]);

  if (numSteps <= 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md text-sm" style={{ background: "var(--chart-surface)", color: "var(--text-muted)" }}>
        No test-set games to backtest yet.
      </div>
    );
  }

  const xScale = (step: number) => PAD.left + (step / numSteps) * plotW;
  const yScale = (v: number) => {
    const clamped = Math.max(floor, Math.min(top, v));
    const logMin = Math.log10(floor);
    const logMax = Math.log10(top);
    const frac = (Math.log10(clamped) - logMin) / (logMax - logMin);
    return PAD.top + (1 - frac) * plotH;
  };

  const pathToD = (points: BacktestPoint[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.step).toFixed(2)},${yScale(p.bankroll).toFixed(2)}`).join(" ");

  const xTickStep = Math.max(1, Math.round(numSteps / 6));
  const xTicks: number[] = [];
  for (let s = 0; s <= numSteps; s += xTickStep) xTicks.push(s);
  if (xTicks[xTicks.length - 1] !== numSteps) xTicks.push(numSteps);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Backtested bankroll by staking strategy, log scale">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

        {yTicks.map((t) => (
          <line key={`gy-${t}`} x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(t)} y2={yScale(t)} stroke="var(--gridline)" strokeWidth={1} />
        ))}
        {xTicks.map((t) => (
          <line key={`gx-${t}`} x1={xScale(t)} x2={xScale(t)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--gridline)" strokeWidth={1} />
        ))}

        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={yScale(startingBankroll)}
          y2={yScale(startingBankroll)}
          stroke="var(--baseline)"
          strokeWidth={1.5}
          strokeDasharray="3,3"
        />

        {yTicks.map((t) => (
          <text key={`yl-${t}`} x={PAD.left - 8} y={yScale(t) + 4} fontSize={10} fill="var(--text-muted)" textAnchor="end">
            {compactCurrency(t)}
          </text>
        ))}
        {xTicks.map((t) => (
          <text key={`xl-${t}`} x={xScale(t)} y={HEIGHT - PAD.bottom + 18} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
            {t}
          </text>
        ))}

        <text x={PAD.left} y={14} fontSize={11} fill="var(--text-secondary)">
          bankroll (log scale)
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 4} fontSize={11} fill="var(--text-secondary)" textAnchor="end">
          test-set game #
        </text>

        {series.map((s) => (
          <path key={s.label} d={pathToD(s.path)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round" />
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
