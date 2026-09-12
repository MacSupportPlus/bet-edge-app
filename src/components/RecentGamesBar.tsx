"use client";

import { useMemo } from "react";

export interface RecentGameBar {
  label: string; // e.g. "vs NE" or "9/13"
  value: number;
}

interface RecentGamesBarProps {
  games: RecentGameBar[]; // oldest first (left to right), so this reads like a timeline
  line: number | null;
  ariaLabel: string;
  valueFormat?: (v: number) => string;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 34, left: 44 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

const identity = (v: number) => `${Math.round(v)}`;

/** Props.Cash-style bar chart: one bar per recent game, colored by whether it cleared `line`. */
export function RecentGamesBar({ games, line, ariaLabel, valueFormat = identity }: RecentGamesBarProps) {
  const { yMax, barW, gap } = useMemo(() => {
    const values = games.map((g) => g.value).concat(line !== null ? [line] : []);
    const hi = Math.max(1, ...values);
    const n = Math.max(1, games.length);
    const gap = plotW / n / 4;
    const barW = (plotW - gap * (n + 1)) / n;
    return { yMax: hi * 1.15, barW: Math.max(barW, 6), gap };
  }, [games, line]);

  if (games.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md text-sm" style={{ background: "var(--chart-surface)", color: "var(--text-muted)" }}>
        No games on file yet.
      </div>
    );
  }

  const yScale = (v: number) => PAD.top + (1 - v / yMax) * plotH;
  const lineY = line !== null ? yScale(line) : null;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(0)} y2={yScale(0)} stroke="var(--gridline)" strokeWidth={1} />

        {games.map((g, i) => {
          const x = PAD.left + gap + i * (barW + gap);
          const barTop = yScale(g.value);
          const hit = line !== null && g.value > line;
          const miss = line !== null && g.value < line;
          const color = hit ? "var(--status-good)" : miss ? "var(--status-critical)" : "var(--series-1)";
          return (
            <g key={`${g.label}-${i}`}>
              <rect x={x} y={barTop} width={barW} height={Math.max(0, yScale(0) - barTop)} fill={color} rx={2} />
              <text x={x + barW / 2} y={barTop - 5} fontSize={10} fill="var(--text-secondary)" textAnchor="middle">
                {valueFormat(g.value)}
              </text>
              <text x={x + barW / 2} y={HEIGHT - PAD.bottom + 16} fontSize={9} fill="var(--text-muted)" textAnchor="middle">
                {g.label}
              </text>
            </g>
          );
        })}

        {lineY !== null && (
          <>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={lineY} y2={lineY} stroke="var(--baseline)" strokeWidth={1.5} strokeDasharray="4,3" />
            <text x={WIDTH - PAD.right} y={lineY - 4} fontSize={10} fill="var(--text-muted)" textAnchor="end">
              line {valueFormat(line as number)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
