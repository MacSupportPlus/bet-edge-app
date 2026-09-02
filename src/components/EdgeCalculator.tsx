"use client";

import { useMemo, useState } from "react";
import { recommendedStake, summarizeEdge } from "@/lib/edge";
import { GrowthCurveChart } from "./GrowthCurveChart";

const FRACTIONAL_OPTIONS = [
  { label: "Full Kelly", value: 1 },
  { label: "½ Kelly", value: 0.5 },
  { label: "¼ Kelly", value: 0.25 },
];

function currency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function EdgeCalculator() {
  const [pPercent, setPPercent] = useState(55);
  const [b, setB] = useState(1);
  const [bankroll, setBankroll] = useState(10000);
  const [fractionalMultiplier, setFractionalMultiplier] = useState(0.5);

  const p = pPercent / 100;

  const summary = useMemo(() => summarizeEdge(p, b), [p, b]);
  const stake = useMemo(
    () => recommendedStake(p, b, bankroll, fractionalMultiplier),
    [p, b, bankroll, fractionalMultiplier],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Edge Calculator
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Supply a win probability and payout odds. This tells you whether the edge is
          real, how big it is, and how much of your bankroll it&apos;s safe to stake — it
          does not predict outcomes for you.
        </p>
      </div>

      {/* Inputs */}
      <div
        className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-3"
        style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Win probability (p)</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={99}
              step={0.5}
              value={pPercent}
              onChange={(e) => setPPercent(Number(e.target.value))}
              className="w-full"
            />
            <span
              className="w-14 shrink-0 text-right tabular-nums"
              style={{ color: "var(--text-primary)" }}
            >
              {pPercent.toFixed(1)}%
            </span>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>
            Net odds (b) — win pays b×stake
          </span>
          <input
            type="number"
            min={0.01}
            step={0.05}
            value={b}
            onChange={(e) => setB(Math.max(0.01, Number(e.target.value)))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Bankroll</span>
          <input
            type="number"
            min={0}
            step={100}
            value={bankroll}
            onChange={(e) => setBankroll(Math.max(0, Number(e.target.value)))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
      </div>

      {/* No-edge warning */}
      {!summary.hasEdge && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--status-critical)",
            color: "var(--status-critical)",
            background: "var(--card-bg)",
          }}
        >
          <strong>No edge — do not bet.</strong> At p = {pPercent.toFixed(1)}% and b = {b},
          expected value per unit staked is {summary.expectancy.toFixed(4)} (≤ 0). Kelly
          sizing is undefined without a positive edge.
        </div>
      )}

      {/* Outputs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Expectancy (per unit)"
          value={summary.expectancy.toFixed(4)}
          sub={summary.hasEdge ? "positive edge" : "no edge"}
        />
        <StatTile label="Std. dev (per unit)" value={summary.stdDev.toFixed(4)} />
        <StatTile
          label="Kelly fraction (f*)"
          value={`${(summary.kellyFraction * 100).toFixed(2)}%`}
          sub="of bankroll, full Kelly"
        />
        <StatTile
          label="Recommended stake"
          value={summary.hasEdge ? currency(stake) : "$0"}
          sub={
            summary.hasEdge
              ? `${FRACTIONAL_OPTIONS.find((o) => o.value === fractionalMultiplier)?.label ?? "custom"}`
              : "no bet"
          }
        />
      </div>

      {/* Fractional Kelly toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Stake sizing:
        </span>
        <div className="flex gap-1">
          {FRACTIONAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFractionalMultiplier(opt.value)}
              className="rounded-full border px-3 py-1 text-xs transition-colors"
              style={{
                borderColor:
                  fractionalMultiplier === opt.value
                    ? "var(--series-1)"
                    : "var(--card-border)",
                background:
                  fractionalMultiplier === opt.value ? "var(--series-1)" : "transparent",
                color: fractionalMultiplier === opt.value ? "white" : "var(--text-secondary)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Real p estimates carry error — fractional Kelly is the standard defense
          against overbetting a wrong edge.
        </span>
      </div>

      {/* Growth curve chart */}
      <div
        className="rounded-lg border p-4"
        style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
      >
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Geometric growth rate vs. stake size
        </h2>
        <GrowthCurveChart p={p} b={b} fractionalMultiplier={fractionalMultiplier} />
      </div>
    </div>
  );
}
