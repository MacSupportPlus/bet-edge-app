"use client";

import { ReliabilityBin } from "@/lib/calibration";

interface ReliabilityChartProps {
  bins: ReliabilityBin[];
}

const WIDTH = 400;
const HEIGHT = 400;
const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

export function ReliabilityChart({ bins }: ReliabilityChartProps) {
  const scale = (v: number) => v; // domain is already [0,1]
  const x = (v: number) => PAD.left + scale(v) * plotW;
  const y = (v: number) => PAD.top + (1 - scale(v)) * plotH;

  const populated = bins.filter((b) => b.count > 0);
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Reliability diagram: predicted probability vs. actual outcome frequency">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

        {ticks.map((t) => (
          <g key={`g-${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--gridline)" strokeWidth={1} />
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--gridline)" strokeWidth={1} />
            <text x={x(t)} y={HEIGHT - PAD.bottom + 16} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
              {(t * 100).toFixed(0)}%
            </text>
            <text x={PAD.left - 8} y={y(t) + 3} fontSize={10} fill="var(--text-muted)" textAnchor="end">
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* perfect-calibration diagonal */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--baseline)" strokeWidth={1.5} strokeDasharray="4,4" />

        {/* connecting line through actual bins */}
        <path
          d={populated.map((b, i) => `${i === 0 ? "M" : "L"}${x(b.avgPredicted!).toFixed(2)},${y(b.avgActual!).toFixed(2)}`).join(" ")}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
        />

        {populated.map((b) => (
          <circle
            key={`${b.binStart}`}
            cx={x(b.avgPredicted!)}
            cy={y(b.avgActual!)}
            r={Math.max(4, Math.sqrt(b.count / maxCount) * 12)}
            fill="var(--series-1)"
            fillOpacity={0.85}
            stroke="var(--chart-surface)"
            strokeWidth={1.5}
          />
        ))}

        <text x={WIDTH / 2} y={HEIGHT - 4} fontSize={11} fill="var(--text-secondary)" textAnchor="middle">
          predicted probability
        </text>
        <text x={14} y={HEIGHT / 2} fontSize={11} fill="var(--text-secondary)" textAnchor="middle" transform={`rotate(-90 14 ${HEIGHT / 2})`}>
          actual win frequency
        </text>
      </svg>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Dot size = number of games in that bucket. On the dashed diagonal = perfectly calibrated;
        above it = underconfident; below it = overconfident (dangerous for Kelly sizing).
      </p>
    </div>
  );
}
