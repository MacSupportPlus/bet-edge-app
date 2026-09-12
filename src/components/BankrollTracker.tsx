"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BetEntry,
  BetOutcome,
  BetSide,
  BetType,
  drawdownSeries,
  realizedPath,
  summarizeBankroll,
  theoreticalPath,
} from "@/lib/bankroll";
import { autoGradeBets } from "@/lib/autoGradeBets";
import { ClosingLine, findClosingLine, loadClosingLines } from "@/lib/closingLines";
import { computeClv } from "@/lib/clv";
import { Game } from "@/lib/elo";
import { currency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
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
  return {
    date: today(),
    description: "",
    pPercent: 55,
    b: 1,
    stake: 100,
    homeTeam: undefined as string | undefined,
    awayTeam: undefined as string | undefined,
    betType: undefined as BetType | undefined,
    line: undefined as number | undefined,
    side: undefined as BetSide | undefined,
  };
}

export function BankrollTracker() {
  const searchParams = useSearchParams();
  const [startingBankroll, setStartingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets, setBets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState(
    "bankroll-tracker:fractional",
    0.5,
  );
  // Prefills the form when arriving from a link like /tracker?desc=...&p=...&b=...&stake=...
  // (e.g. the "Log this bet" button on the This Week tab) — read once on mount.
  const [form, setForm] = useState(() => {
    const desc = searchParams.get("desc");
    const p = searchParams.get("p");
    const b = searchParams.get("b");
    const stake = searchParams.get("stake");
    if (!desc && !p && !b && !stake) return emptyForm();
    return {
      date: today(),
      description: desc ?? "",
      pPercent: p ? Number(p) : 55,
      b: b ? Number(b) : 1,
      stake: stake ? Number(stake) : 100,
      // Carried through purely for closing-line-value lookup (clv.ts) — absent for
      // manually-typed bets or links that don't provide them.
      homeTeam: searchParams.get("homeTeam") ?? undefined,
      awayTeam: searchParams.get("awayTeam") ?? undefined,
      // Structured spread/total fields (see bankroll.ts's BetEntry) — set only by
      // a "Log this bet" link from a spread/total check (e.g. Research), so this
      // bet can auto-settle directly against the final score, no description
      // parsing needed.
      betType: (searchParams.get("betType") as BetType | null) ?? undefined,
      line: searchParams.get("line") ? Number(searchParams.get("line")) : undefined,
      side: (searchParams.get("side") as BetSide | null) ?? undefined,
    };
  });

  // Auto-settles pending bets against our own historical archives, which
  // refresh daily — this is a static, backend-less app, so "automatically
  // update when a game finishes" means "check on load," not a push
  // notification. Only touches bets logged via a "Log this bet" link (their
  // description is parseable); a manually-typed one stays manual-only.
  const [archives, setArchives] = useState<{ cfb: Game[]; nfl: Game[] } | null>(null);
  const [lastGradedCount, setLastGradedCount] = useState<number | null>(null);

  // Closing lines for CLV (clv.ts) — a separate, best-effort fetch (empty
  // arrays if the live-odds refresh hasn't captured any yet) that never
  // blocks the rest of the page.
  const [closingLines, setClosingLines] = useState<{ cfb: ClosingLine[]; nfl: ClosingLine[] }>({ cfb: [], nfl: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadClosingLines("cfb"), loadClosingLines("nfl")])
      .then(([cfb, nfl]) => {
        if (!cancelled) setClosingLines({ cfb, nfl });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames("cfb"), loadGames("nfl")])
      .then(([cfb, nfl]) => {
        if (cancelled) return;
        setArchives({ cfb, nfl });
        // setBets's updater runs synchronously as part of this same call, so
        // `count` below is already correct by the time we read it.
        let count = 0;
        setBets((prev) => {
          const result = autoGradeBets(prev, cfb, nfl);
          count = result.gradedCount;
          return result.gradedCount > 0 ? result.bets : prev;
        });
        setLastGradedCount(count);
      })
      .catch(() => {
        // No archives available — auto-grading just stays a no-op; manual Win/Loss still works.
      });
    return () => {
      cancelled = true;
    };
  }, [setBets]);

  function checkForResults() {
    if (!archives) return;
    const { bets: graded, gradedCount } = autoGradeBets(bets, archives.cfb, archives.nfl);
    setBets(graded);
    setLastGradedCount(gradedCount);
  }

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

  // Closing Line Value — only resolvable for moneyline bets logged via "Log
  // this bet" (parseable description) that also carry homeTeam/awayTeam AND
  // have a captured closing line on file; see clv.ts's doc comment for why
  // this is scoped to moneyline for now.
  const clvByBetId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeClv>>();
    for (const bet of bets) {
      if (!bet.homeTeam || !bet.awayTeam) continue;
      const lines = [...closingLines.nfl, ...closingLines.cfb];
      const line = findClosingLine(lines, bet.homeTeam, bet.awayTeam, bet.date);
      if (!line) continue;
      const clv = computeClv(bet, line);
      if (clv) map.set(bet.id, clv);
    }
    return map;
  }, [bets, closingLines]);

  const avgClvPoints = useMemo(() => {
    const values = [...clvByBetId.values()].filter((v): v is NonNullable<typeof v> => v !== null && v !== undefined);
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v.clvPoints, 0) / values.length;
  }, [clvByBetId]);

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
      homeTeam: form.homeTeam,
      awayTeam: form.awayTeam,
      betType: form.betType,
      line: form.line,
      side: form.side,
    };
    setBets((prev) => [...prev, bet]);
    setForm(emptyForm());
  }

  function settleBet(id: string, outcome: BetOutcome) {
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, outcome, settledAuto: outcome === "pending" ? undefined : b.settledAuto } : b)));
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
          Pending bets logged via a &quot;Log this bet&quot; link auto-settle here once their game
          shows up final in our own data — no push notifications (this app has no backend to send
          them from), just a check against the archive each time you open this page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {!archives && <span>Checking pending bets against final scores…</span>}
        {archives && lastGradedCount !== null && (
          <span>
            {lastGradedCount > 0
              ? `Auto-settled ${lastGradedCount} bet${lastGradedCount === 1 ? "" : "s"} just now.`
              : "No pending bets had a final score to check against."}
          </span>
        )}
        <button
          onClick={checkForResults}
          disabled={!archives}
          className="ml-auto rounded-md border px-2 py-1 disabled:opacity-50"
          style={{ borderColor: "var(--card-border)" }}
        >
          Check for results
        </button>
      </div>

      {/* starting bankroll */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border p-4"
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

      {avgClvPoints !== null && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border p-4"
          style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
        >
          <StatTile
            label="Avg. closing line value"
            value={`${avgClvPoints >= 0 ? "+" : ""}${(avgClvPoints * 100).toFixed(1)}pts`}
            sub={`${clvByBetId.size} bet${clvByBetId.size === 1 ? "" : "s"} with a captured closing line`}
            accent={avgClvPoints >= 0 ? "good" : "critical"}
          />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Positive means your price was better than the closing line, on average — the
            single most-cited long-run skill signal among sharp bettors, independent of whether
            the bet actually won. Only moneyline bets logged via a &quot;Log this bet&quot; link,
            with a closing line captured before kickoff, count toward this.
          </p>
        </div>
      )}

      {/* chart */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Realized vs. theoretical bankroll
        </h2>
        <BankrollChart realized={realized} theoretical={theoretical} startingBankroll={startingBankroll} />
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        <strong style={{ color: "var(--text-secondary)" }}>Logging a bet:</strong> &quot;p&quot;
        is your own honest guess at the win chance, as a percent (e.g. 60 means &quot;I think
        this wins 60 times out of 100&quot;) — it doesn&apos;t have to match a suggestion from
        another tab. This number is only used later to compare your actual results against
        &quot;what if I&apos;d sized every bet by the book&quot; on the chart below.
      </p>

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
                {clvByBetId.get(bet.id) && (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs tabular-nums"
                    title="Closing line value — your price vs. the closing line for the same side"
                    style={{
                      background: "var(--gridline)",
                      color: clvByBetId.get(bet.id)!.beatClose ? "var(--status-good)" : "var(--status-critical)",
                    }}
                  >
                    CLV {clvByBetId.get(bet.id)!.clvPoints >= 0 ? "+" : ""}
                    {(clvByBetId.get(bet.id)!.clvPoints * 100).toFixed(1)}pts
                  </span>
                )}
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
                  <div className="flex items-center gap-1">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        background: bet.outcome === "win" ? "var(--status-good)" : "var(--status-critical)",
                        color: "white",
                      }}
                    >
                      {bet.outcome === "win" ? `+${currency(bet.stake * bet.b)}` : `-${currency(bet.stake)}`}
                    </span>
                    {bet.settledAuto && (
                      <button
                        onClick={() => settleBet(bet.id, "pending")}
                        title="Auto-settled from final score — click if this looks wrong"
                        className="text-xs underline"
                        style={{ color: "var(--text-muted)" }}
                      >
                        auto — not right?
                      </button>
                    )}
                  </div>
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
