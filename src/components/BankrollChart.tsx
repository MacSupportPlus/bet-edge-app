"use client";

import { useRef, useState } from "react";
import { BankrollPoint } from "@/lib/bankroll";
import { currency } from "@/lib/format";

interface BankrollChartProps {
  realized: BankrollPoint[];
  theoretical: BankrollPoint[];
  startingBankroll: number;
}

const WIDTH = 640;
const HEIGHT = 320;
const PAD = { top: 20, right: 16, bottom: 36, left: 64 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

export function BankrollChart({ realized, theoretical, startingBankroll }: BankrollChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverStep, setHoverStep] = useState<number | null>(null);

  const numSteps = realized.length - 1;

  if (numSteps <= 0) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-md text-sm"
        style={{ background: "var(--chart-surface)", color: "var(--text-muted)" }}
      >
        Log a settled bet to see the bankroll curve.
      </div>
    );
  }

  const allValues = [...realized.map((p) => p.bankroll), ...theoretical.map((p) => p.bankroll), startingBankroll];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const padAmount = Math.max((maxV - minV) * 0.1, maxV * 0.02, 1);
  const yMin = Math.max(0, minV - padAmount);
  const yMax = maxV + padAmount;

  const xScale = (step: number) => PAD.left + (step / numSteps) * plotW;
  const yScale = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const pathToD = (points: BankrollPoint[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.step).toFixed(2)},${yScale(p.bankroll).toFixed(2)}`).join(" ");

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => yMin + (i / yTickCount) * (yMax - yMin));

  const xTickStep = Math.max(1, Math.round(numSteps / 6));
  const xTicks: number[] = [];
  for (let s = 0; s <= numSteps; s += xTickStep) xTicks.push(s);
  if (xTicks[xTicks.length - 1] !== numSteps) xTicks.push(numSteps);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const step = Math.round(Math.max(0, Math.min(1, (xPx - PAD.left) / plotW)) * numSteps);
    setHoverStep(step);
  }

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label="Realized vs theoretical bankroll over logged bets"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverStep(null)}
      >
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
          <text key={`yl-${t}`} x={PAD.left - 8} y={yScale(t) + 4} fontSize={11} fill="var(--text-muted)" textAnchor="end">
            {currency(t)}
          </text>
        ))}
        {xTicks.map((t) => (
          <text key={`xl-${t}`} x={xScale(t)} y={HEIGHT - PAD.bottom + 18} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
            {t}
          </text>
        ))}

        <text x={PAD.left} y={14} fontSize={11} fill="var(--text-secondary)">
          bankroll
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 4} fontSize={11} fill="var(--text-secondary)" textAnchor="end">
          settled bet #
        </text>

        <path d={pathToD(theoretical)} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5,4" strokeLinecap="round" />
        <path d={pathToD(realized)} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinecap="round" />

        {hoverStep !== null && (
          <line x1={xScale(hoverStep)} x2={xScale(hoverStep)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--text-secondary)" strokeWidth={1} />
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: "var(--series-1)" }} />
          realized (what you actually staked)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} />
          theoretical (same picks, fractional-Kelly sizing)
        </span>
      </div>

      {hoverStep !== null && realized[hoverStep] && theoretical[hoverStep] && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `clamp(0px, ${(xScale(hoverStep) / WIDTH) * 100}%, calc(100% - 170px))`,
            background: "var(--card-bg)",
            borderColor: "var(--card-border)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-medium">bet #{hoverStep}</div>
          <div style={{ color: "var(--series-1)" }}>realized: {currency(realized[hoverStep].bankroll)}</div>
          <div style={{ color: "var(--series-2)" }}>theoretical: {currency(theoretical[hoverStep].bankroll)}</div>
        </div>
      )}
    </div>
  );
}
