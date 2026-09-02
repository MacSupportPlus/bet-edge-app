"use client";

import { useMemo, useRef, useState } from "react";

interface FanChartProps {
  paths: number[][];
  meanPath: number[];
  medianPath: number[];
  startingBankroll: number;
  /** Max individual paths to actually draw (the rest still feed mean/median). */
  maxSamplePaths?: number;
}

const WIDTH = 640;
const HEIGHT = 360;
const PAD = { top: 20, right: 16, bottom: 36, left: 64 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

function currency(n: number) {
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(n >= 1 ? 0 : 2)}`;
}

export function FanChart({
  paths,
  meanPath,
  medianPath,
  startingBankroll,
  maxSamplePaths = 120,
}: FanChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const numBets = meanPath.length - 1;

  const samplePaths = useMemo(() => {
    if (paths.length <= maxSamplePaths) return paths;
    const step = paths.length / maxSamplePaths;
    const sample: number[][] = [];
    for (let i = 0; i < maxSamplePaths; i++) sample.push(paths[Math.floor(i * step)]);
    return sample;
  }, [paths, maxSamplePaths]);

  const { floor, top } = useMemo(() => {
    const allValues = [...meanPath, ...medianPath, startingBankroll];
    const maxV = Math.max(...allValues, ...samplePaths.flat());
    const floorV = Math.max(startingBankroll * 1e-3, 1e-6);
    return { floor: floorV, top: maxV * 1.15 };
  }, [meanPath, medianPath, startingBankroll, samplePaths]);

  const xScale = (t: number) => PAD.left + (t / numBets) * plotW;
  const yScale = (v: number) => {
    const clamped = Math.max(floor, Math.min(top, v));
    const logMin = Math.log10(floor);
    const logMax = Math.log10(top);
    const frac = (Math.log10(clamped) - logMin) / (logMax - logMin);
    return PAD.top + (1 - frac) * plotH;
  };

  const pathToD = (path: number[]) =>
    path.map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(2)},${yScale(v).toFixed(2)}`).join(" ");

  const yTicks = useMemo(() => {
    const logMin = Math.ceil(Math.log10(floor));
    const logMax = Math.floor(Math.log10(top));
    const ticks: number[] = [];
    for (let k = logMin; k <= logMax; k++) ticks.push(10 ** k);
    return ticks;
  }, [floor, top]);

  const xTickStep = Math.max(1, Math.round(numBets / 5));
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let t = 0; t <= numBets; t += xTickStep) ticks.push(t);
    if (ticks[ticks.length - 1] !== numBets) ticks.push(numBets);
    return ticks;
  }, [numBets, xTickStep]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const t = Math.round(Math.max(0, Math.min(1, (xPx - PAD.left) / plotW)) * numBets);
    setHoverT(t);
  }

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label="Simulated bankroll paths over time, with ensemble mean and median"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverT(null)}
      >
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--chart-surface)" />

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

        {/* starting bankroll reference */}
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
          <text
            key={`yl-${t}`}
            x={PAD.left - 8}
            y={yScale(t) + 4}
            fontSize={11}
            fill="var(--text-muted)"
            textAnchor="end"
          >
            {currency(t)}
          </text>
        ))}
        {xTicks.map((t) => (
          <text
            key={`xl-${t}`}
            x={xScale(t)}
            y={HEIGHT - PAD.bottom + 18}
            fontSize={11}
            fill="var(--text-muted)"
            textAnchor="middle"
          >
            {t}
          </text>
        ))}

        <text x={PAD.left} y={14} fontSize={11} fill="var(--text-secondary)">
          bankroll (log scale)
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 4} fontSize={11} fill="var(--text-secondary)" textAnchor="end">
          bet number
        </text>

        {/* individual sample paths — a density cloud, not an identity, so muted + low opacity */}
        {samplePaths.map((path, i) => (
          <path key={`sp-${i}`} d={pathToD(path)} fill="none" stroke="var(--text-muted)" strokeWidth={1} opacity={0.12} />
        ))}

        {/* median path */}
        <path d={pathToD(medianPath)} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinecap="round" />
        {/* mean path */}
        <path d={pathToD(meanPath)} fill="none" stroke="var(--series-2)" strokeWidth={2.5} strokeLinecap="round" />

        {hoverT !== null && (
          <line
            x1={xScale(hoverT)}
            x2={xScale(hoverT)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--text-secondary)"
            strokeWidth={1}
          />
        )}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: "var(--series-2)" }} />
          ensemble average
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: "var(--series-1)" }} />
          median (typical path)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 opacity-40" style={{ background: "var(--text-muted)" }} />
          sample paths
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 border-t border-dashed"
            style={{ borderColor: "var(--baseline)" }}
          />
          starting bankroll
        </span>
      </div>

      {hoverT !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `clamp(0px, ${(xScale(hoverT) / WIDTH) * 100}%, calc(100% - 160px))`,
            background: "var(--card-bg)",
            borderColor: "var(--card-border)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-medium">bet {hoverT}</div>
          <div style={{ color: "var(--series-2)" }}>avg: {currency(meanPath[hoverT])}</div>
          <div style={{ color: "var(--series-1)" }}>median: {currency(medianPath[hoverT])}</div>
        </div>
      )}
    </div>
  );
}
