"use client";

import { useMemo, useRef, useState } from "react";
import { growthCurve, growthRate, kellyFraction } from "@/lib/edge";

interface GrowthCurveChartProps {
  p: number;
  b: number;
  fractionalMultiplier: number;
}

const WIDTH = 640;
const HEIGHT = 340;
const PAD = { top: 20, right: 24, bottom: 40, left: 56 };

const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

function formatPct(x: number, digits = 0) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function GrowthCurveChart({ p, b, fractionalMultiplier }: GrowthCurveChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverF, setHoverF] = useState<number | null>(null);

  const curve = useMemo(() => growthCurve(p, b, 300), [p, b]);
  const kellyF = useMemo(() => kellyFraction(p, b), [p, b]);
  const halfKellyF = kellyF * 0.5;
  const selectedF = kellyF * fractionalMultiplier;

  const gMax = useMemo(() => {
    const finite = curve.map((pt) => pt.g).filter((g) => Number.isFinite(g));
    return Math.max(0, ...finite);
  }, [curve]);

  // Display domain: full 0-100% on x, a clamped finite band on y so the
  // -Infinity dive as f -> 100% doesn't collapse the interesting region
  // near the Kelly peak into a single pixel.
  const yMax = Math.max(gMax * 1.25, 0.01);
  const yMin = -Math.max(gMax * 3, 0.05);

  const xScale = (f: number) => PAD.left + f * plotW;
  const yScale = (g: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, g));
    return PAD.top + (1 - (clamped - yMin) / (yMax - yMin)) * plotH;
  };

  // Recomputed every render (cheap: ~300 points) — xScale/yScale close over
  // yMin/yMax so memoizing this would need them in the dep array anyway.
  const linePath = curve
    .map((pt, i) => `${i === 0 ? "M" : "L"}${xScale(pt.f).toFixed(2)},${yScale(pt.g).toFixed(2)}`)
    .join(" ");

  const zeroY = yScale(0);

  const markers = useMemo(() => {
    const base = [
      { key: "full", f: kellyF, label: "Full Kelly", accent: false },
      { key: "half", f: halfKellyF, label: "½ Kelly", accent: false },
    ];
    const isNearExisting = base.some((m) => Math.abs(m.f - selectedF) < 0.001);
    if (!isNearExisting) {
      base.push({ key: "selected", f: selectedF, label: "Your stake", accent: true });
    }
    return base.map((m) => ({ ...m, g: growthRate(p, b, m.f) }));
  }, [kellyF, halfKellyF, selectedF, p, b]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const f = Math.max(0, Math.min(1, (xPx - PAD.left) / plotW));
    setHoverF(f);
  }

  const hoverG = hoverF !== null ? growthRate(p, b, hoverF) : null;

  // X gridlines every 10%, Y gridlines at 4 even steps.
  const xTicks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + (i / 4) * (yMax - yMin));

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="Bankroll growth rate versus stake fraction"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverF(null)}
      >
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

        {/* gridlines */}
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`gx-${t}`}
            x1={xScale(t)}
            x2={xScale(t)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
        ))}

        {/* zero baseline, emphasized */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--baseline)"
          strokeWidth={1.5}
        />

        {/* axis labels */}
        {xTicks.map((t) => (
          <text
            key={`xl-${t}`}
            x={xScale(t)}
            y={HEIGHT - PAD.bottom + 18}
            fontSize={11}
            fill="var(--text-muted)"
            textAnchor="middle"
          >
            {formatPct(t)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={PAD.left - 8}
            y={yScale(t) + 4}
            fontSize={11}
            fill="var(--text-muted)"
            textAnchor="end"
          >
            {formatPct(t)}
          </text>
        ))}

        <text
          x={PAD.left}
          y={14}
          fontSize={11}
          fill="var(--text-secondary)"
        >
          growth rate g(f) per bet
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 4}
          fontSize={11}
          fill="var(--text-secondary)"
          textAnchor="end"
        >
          stake as % of bankroll (f)
        </text>

        {/* the curve */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* markers */}
        {markers.map((m) => (
          <g key={m.key}>
            <line
              x1={xScale(m.f)}
              x2={xScale(m.f)}
              y1={yScale(m.g)}
              y2={HEIGHT - PAD.bottom}
              stroke={m.accent ? "var(--series-2)" : "var(--text-muted)"}
              strokeWidth={1}
              strokeDasharray="2,3"
            />
            <circle
              cx={xScale(m.f)}
              cy={yScale(m.g)}
              r={5}
              fill={m.accent ? "var(--series-2)" : "var(--chart-surface)"}
              stroke={m.accent ? "var(--series-2)" : "var(--series-1)"}
              strokeWidth={2}
            />
            <text
              x={xScale(m.f)}
              y={yScale(m.g) - 10}
              fontSize={11}
              fontWeight={m.accent ? 600 : 400}
              fill="var(--text-primary)"
              textAnchor="middle"
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* hover crosshair */}
        {hoverF !== null && hoverG !== null && (
          <g>
            <line
              x1={xScale(hoverF)}
              x2={xScale(hoverF)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--text-secondary)"
              strokeWidth={1}
            />
            <circle
              cx={xScale(hoverF)}
              cy={yScale(hoverG)}
              r={4}
              fill="var(--series-1)"
            />
          </g>
        )}
      </svg>

      {hoverF !== null && hoverG !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `clamp(0px, ${(xScale(hoverF) / WIDTH) * 100}%, calc(100% - 140px))`,
            background: "var(--card-bg)",
            borderColor: "var(--card-border)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-medium">stake {formatPct(hoverF, 1)}</div>
          <div style={{ color: "var(--text-secondary)" }}>
            g(f) = {Number.isFinite(hoverG) ? formatPct(hoverG, 3) : "-∞"} / bet
          </div>
        </div>
      )}

      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Growth rate falls toward −∞ as the stake approaches 100% of bankroll — betting
        everything on a bet that can lose means certain eventual ruin.
      </p>
    </div>
  );
}
