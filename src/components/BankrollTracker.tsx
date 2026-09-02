"use client";

import { useMemo, useState } from "react";
import {
  BetEntry,
  drawdownSeries,
  realizedPath,
  summarizeBankroll,
  theoreticalPath,
} from "@/lib/bankroll";
import { currency } from "@/lib/format";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { BankrollChart } from "./BankrollChart";
import { StatTile } from "./StatTile";

const FRACTIONAL_OPTIONS = [
  { label: "Full Kelly", value: 1 },
  { label: "½ Kelly", value: 0.5 },
  { label: "¼ Kelly", value: 0.25 },
];

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm() {
  return { date: today(), description: "", pPercent: 55, b: 1, stake: 100 };
}

export function BankrollTracker() {
  const [startingBankroll, setStartingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets, setBets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState(
    "bankroll-tracker:fractional",
    0.5,
  );
  const [form, setForm] = useState(emptyForm());

  const realized = useMemo(() => realizedPath(startingBankroll, bets), [startingBankroll, bets]);
  const theoretical = useMemo(
    () => theoreticalPath(startingBankroll, bets, fractionalMultiplier),
    [startingBankroll, bets, fractionalMultiplier],
  );
  const drawdown = useMemo(() => drawdownSeries(realized), [realized]);
  const summary = useMemo(() => summarizeBankroll(startingBankroll, bets), [startingBankroll, bets]);

  const sortedBets = useMemo(
    () => [...bets].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [bets],
  );

  function addBet() {
    if (!form.description.trim() || form.stake <= 0) return;
    const bet: BetEntry = {
      id: newId(),
      date: form.date,
      description: form.description.trim(),
      p: form.pPercent / 100,
      b: form.b,
      stake: form.stake,
      outcome: "pending",
    };
    setBets((prev) => [...prev, bet]);
    setForm(emptyForm());
  }

  function settleBet(id: string, outcome: "win" | "loss") {
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, outcome } : b)));
  }

  function deleteBet(id: string) {
    setBets((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Bankroll Tracker
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Log real bets and compare your realized bankroll against what fractional-Kelly
          sizing would have produced with the same picks. Saved locally in this browser.
        </p>
      </div>

      {/* starting bankroll */}
      <div
        className="flex items-center gap-3 rounded-lg border p-4"
        style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
      >
        <label className="flex items-center gap-2 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Starting bankroll</span>
          <input
            type="number"
            min={0}
            step={100}
            value={startingBankroll}
            onChange={(e) => setStartingBankroll(Math.max(0, Number(e.target.value)))}
            className="w-32 rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Theoretical sizing:
          </span>
          {FRACTIONAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFractionalMultiplier(opt.value)}
              className="rounded-full border px-3 py-1 text-xs transition-colors"
              style={{
                borderColor: fractionalMultiplier === opt.value ? "var(--series-1)" : "var(--card-border)",
                background: fractionalMultiplier === opt.value ? "var(--series-1)" : "transparent",
                color: fractionalMultiplier === opt.value ? "white" : "var(--text-secondary)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Current bankroll" value={currency(summary.currentBankroll)} />
        <StatTile
          label="Total P&L"
          value={`${summary.totalProfit >= 0 ? "+" : ""}${currency(summary.totalProfit)}`}
          accent={summary.totalProfit >= 0 ? "good" : "critical"}
        />
        <StatTile label="Win rate" value={`${(summary.winRate * 100).toFixed(0)}%`} sub={`${summary.settledCount} settled`} />
        <StatTile
          label="Current drawdown"
          value={`${(summary.currentDrawdown * 100).toFixed(1)}%`}
          accent={summary.currentDrawdown > 0 ? "critical" : undefined}
        />
        <StatTile label="Max drawdown" value={`${(summary.maxDrawdown * 100).toFixed(1)}%`} />
      </div>

      {/* chart */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Realized vs. theoretical bankroll
        </h2>
        <BankrollChart realized={realized} theoretical={theoretical} startingBankroll={startingBankroll} />
      </div>

      {/* add bet form */}
      <div
        className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-6"
        style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
      >
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-2">
          <span style={{ color: "var(--text-secondary)" }}>Description</span>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="e.g. Lakers -4.5"
            className="rounded-md border px-2 py-1.5"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Date</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="rounded-md border px-2 py-1.5"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>p (%)</span>
          <input
            type="number"
            min={1}
            max={99}
            step={0.5}
            value={form.pPercent}
            onChange={(e) => setForm((f) => ({ ...f, pPercent: Number(e.target.value) }))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Odds (b)</span>
          <input
            type="number"
            min={0.01}
            step={0.05}
            value={form.b}
            onChange={(e) => setForm((f) => ({ ...f, b: Math.max(0.01, Number(e.target.value)) }))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Stake ($)</span>
          <input
            type="number"
            min={0}
            step={10}
            value={form.stake}
            onChange={(e) => setForm((f) => ({ ...f, stake: Math.max(0, Number(e.target.value)) }))}
            className="rounded-md border px-2 py-1.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <button
            onClick={addBet}
            className="w-full rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors"
            style={{ background: "var(--series-1)" }}
          >
            Log bet
          </button>
        </div>
      </div>

      {/* bet list */}
      <div className="rounded-lg border" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="border-b px-4 py-3 text-sm font-medium" style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}>
          Logged bets
        </h2>
        {sortedBets.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No bets logged yet.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
            {sortedBets.map((bet) => (
              <div key={bet.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-24 shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {bet.date}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                  {bet.description}
                </span>
                <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  p={(bet.p * 100).toFixed(0)}% b={bet.b}
                </span>
                <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {currency(bet.stake)}
                </span>
                {bet.outcome === "pending" ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      pending
                    </span>
                    <button
                      onClick={() => settleBet(bet.id, "win")}
                      className="rounded-md border px-2 py-0.5 text-xs"
                      style={{ borderColor: "var(--status-good)", color: "var(--status-good)" }}
                    >
                      Win
                    </button>
                    <button
                      onClick={() => settleBet(bet.id, "loss")}
                      className="rounded-md border px-2 py-0.5 text-xs"
                      style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
                    >
                      Loss
                    </button>
                  </div>
                ) : (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      background: bet.outcome === "win" ? "var(--status-good)" : "var(--status-critical)",
                      color: "white",
                    }}
                  >
                    {bet.outcome === "win" ? `+${currency(bet.stake * bet.b)}` : `-${currency(bet.stake)}`}
                  </span>
                )}
                <button
                  onClick={() => deleteBet(bet.id)}
                  className="ml-auto text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Peak bankroll so far: {currency(drawdown[drawdown.length - 1]?.peak ?? startingBankroll)}
      </p>
    </div>
  );
}
