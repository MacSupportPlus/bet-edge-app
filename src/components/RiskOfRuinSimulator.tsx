"use client";

import { useMemo, useState } from "react";
import { kellyFraction } from "@/lib/edge";
import { currency } from "@/lib/format";
import { SizingRule, simulateEnsemble } from "@/lib/simulate";
import { FanChart } from "./FanChart";
import { StatTile } from "./StatTile";

export function RiskOfRuinSimulator() {
  const [pPercent, setPPercent] = useState(55);
  const [b, setB] = useState(1);
  const [bankroll, setBankroll] = useState(10000);
  const [numBets, setNumBets] = useState(300);
  const [numBettors, setNumBettors] = useState(1000);
  const [selectedRuleKey, setSelectedRuleKey] = useState<"full" | "half" | "flat" | "double">("half");

  const p = pPercent / 100;
  const fStar = useMemo(() => kellyFraction(p, b), [p, b]);

  const rules: { key: typeof selectedRuleKey; label: string; rule: SizingRule }[] = useMemo(
    () => [
      { key: "full", label: "Full Kelly", rule: { type: "fraction", fraction: fStar } },
      { key: "half", label: "½ Kelly", rule: { type: "fraction", fraction: fStar * 0.5 } },
      { key: "flat", label: "Flat (½-Kelly stake, fixed $)", rule: { type: "flat", fraction: fStar * 0.5 } },
      { key: "double", label: "2× Kelly (over-betting)", rule: { type: "fraction", fraction: fStar * 2 } },
    ],
    [fStar],
  );

  const comparisons = useMemo(
    () =>
      rules.map((r, i) => ({
        ...r,
        result: simulateEnsemble({
          p,
          b,
          startingBankroll: bankroll,
          rule: r.rule,
          numBets,
          numBettors,
          seed: 1000 + i,
        }),
      })),
    [rules, p, b, bankroll, numBets, numBettors],
  );

  const selected = comparisons.find((c) => c.key === selectedRuleKey) ?? comparisons[0];
  const maxRuin = Math.max(...comparisons.map((c) => c.result.ruinFraction), 0.0001);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Risk-of-Ruin Simulator
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Simulates many independent bettors making many sequential bets under a chosen
          sizing rule. The ensemble average and the median (typical single path) visibly
          diverge — the average is not what any one bettor actually experiences.
        </p>
      </div>

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
            <span className="w-14 shrink-0 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
              {pPercent.toFixed(1)}%
            </span>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Net odds (b)</span>
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
          <span style={{ color: "var(--text-secondary)" }}>Starting bankroll</span>
          <input
            type="number"
            min={0}
            step={100}
            value={bankroll}
            onChange={(e) => setBankroll(Math.max(1, Number(e.target.value)))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Bets per bettor (M)</span>
          <input
            type="number"
            min={10}
            max={2000}
            step={10}
            value={numBets}
            onChange={(e) => setNumBets(Math.min(2000, Math.max(10, Number(e.target.value))))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Simulated bettors (N)</span>
          <input
            type="number"
            min={50}
            max={5000}
            step={50}
            value={numBettors}
            onChange={(e) => setNumBettors(Math.min(5000, Math.max(50, Number(e.target.value))))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
      </div>

      {/* rule selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Visualize:
        </span>
        <div className="flex flex-wrap gap-1">
          {comparisons.map((c) => (
            <button
              key={c.key}
              onClick={() => setSelectedRuleKey(c.key)}
              className="rounded-full border px-3 py-1 text-xs transition-colors"
              style={{
                borderColor: selectedRuleKey === c.key ? "var(--series-1)" : "var(--card-border)",
                background: selectedRuleKey === c.key ? "var(--series-1)" : "transparent",
                color: selectedRuleKey === c.key ? "white" : "var(--text-secondary)",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* stats for selected rule */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Ruin rate" value={`${(selected.result.ruinFraction * 100).toFixed(1)}%`} sub="of simulated bettors" />
        <StatTile label="Median terminal bankroll" value={currency(selected.result.medianPath[selected.result.medianPath.length - 1])} sub="typical single path" />
        <StatTile label="Average terminal bankroll" value={currency(selected.result.meanPath[selected.result.meanPath.length - 1])} sub="ensemble average" />
        <StatTile
          label="Avg ÷ median"
          value={`${(
            selected.result.meanPath[selected.result.meanPath.length - 1] /
            Math.max(1, selected.result.medianPath[selected.result.medianPath.length - 1])
          ).toFixed(2)}×`}
          sub="how much the average overstates the typical outcome"
        />
      </div>

      {/* fan chart */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {comparisons.find((c) => c.key === selectedRuleKey)?.label} — simulated bankroll paths
        </h2>
        <FanChart
          paths={selected.result.paths}
          meanPath={selected.result.meanPath}
          medianPath={selected.result.medianPath}
          startingBankroll={bankroll}
        />
      </div>

      {/* ruin rate comparison across rules */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Ruin rate by sizing rule
        </h2>
        <div className="flex flex-col gap-2">
          {comparisons.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <span className="w-56 shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
                {c.label}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full" style={{ background: "var(--gridline)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (c.result.ruinFraction / maxRuin) * 100)}%`,
                    background: c.key === selectedRuleKey ? "var(--series-1)" : "var(--text-muted)",
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--text-primary)" }}>
                {(c.result.ruinFraction * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Ruin = bankroll ever dropping to ≤1% of starting bankroll during the simulation.
        </p>
      </div>
    </div>
  );
}
