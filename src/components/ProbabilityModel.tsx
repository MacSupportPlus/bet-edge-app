"use client";

import { useEffect, useMemo, useState } from "react";
import { brierScore, reliabilityBins } from "@/lib/calibration";
import { computeEloDataset, EloOptions, Game } from "@/lib/elo";
import { compactCurrency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { BacktestStrategy, runBacktest } from "@/lib/backtest";
import { BacktestChart } from "./BacktestChart";
import { ReliabilityChart } from "./ReliabilityChart";
import { StatTile } from "./StatTile";

type Dataset = "nfl" | "cfb";

const DATASET_LABELS: Record<Dataset, string> = { nfl: "NFL (1999–present)", cfb: "College Football (2004–present)" };
const ODDS_B = 100 / 110; // standard -110 both sides, assumed uniformly (no real historical odds in this dataset)
const TEST_FRACTION = 0.2;

const STRATEGIES: { key: BacktestStrategy; label: string; color: string }[] = [
  { key: "flat", label: "Flat betting", color: "var(--text-muted)" },
  { key: "full-kelly", label: "Full Kelly", color: "var(--series-2)" },
  { key: "half-kelly", label: "Half Kelly", color: "var(--series-1)" },
];

export function ProbabilityModel() {
  const [dataset, setDataset] = useState<Dataset>("nfl");
  // Keyed by which dataset it resolved for, so `loading`/`error`/`games` can
  // be derived by comparing against the currently selected `dataset` rather
  // than tracked as separate state written synchronously in the effect body.
  const [fetchResult, setFetchResult] = useState<{ dataset: Dataset; games: Game[] | null; error: string | null }>({
    dataset: "nfl",
    games: null,
    error: null,
  });

  const [kFactor, setKFactor] = useState(20);
  const [homeAdvantage, setHomeAdvantage] = useState(65);
  const [startingBankroll, setStartingBankroll] = useState(10000);

  useEffect(() => {
    let cancelled = false;
    loadGames(dataset)
      .then((g) => {
        if (!cancelled) setFetchResult({ dataset, games: g, error: null });
      })
      .catch((e) => {
        if (!cancelled) setFetchResult({ dataset, games: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  const loading = fetchResult.dataset !== dataset;
  const games = fetchResult.dataset === dataset ? fetchResult.games : null;
  const error = fetchResult.dataset === dataset ? fetchResult.error : null;

  const eloOptions: EloOptions = useMemo(
    () => ({ kFactor, initialRating: 1500, homeAdvantage }),
    [kFactor, homeAdvantage],
  );

  const analysis = useMemo(() => {
    if (!games) return null;
    const records = computeEloDataset(games, eloOptions);
    const splitIndex = Math.floor(records.length * (1 - TEST_FRACTION));
    const train = records.slice(0, splitIndex);
    const test = records.slice(splitIndex);
    if (train.length < 10 || test.length < 10) return null;

    const model = trainLogisticRegression(
      train.map((r) => [r.eloDiff]),
      train.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const testPredictions = test.map((r) => predictProba(model, [r.eloDiff]));
    const testOutcomes = test.map((r) => r.homeWin);
    const brier = brierScore(testPredictions, testOutcomes);

    const trainHomeWinRate = train.reduce((s, r) => s + r.homeWin, 0) / train.length;
    const naiveBrier = brierScore(
      testOutcomes.map(() => trainHomeWinRate),
      testOutcomes,
    );

    const bins = reliabilityBins(testPredictions, testOutcomes, 10);

    const backtestRows = test.map((r, i) => ({ pHome: testPredictions[i], homeWin: r.homeWin }));
    const backtests = STRATEGIES.map((s) => {
      const result = runBacktest(backtestRows, ODDS_B, startingBankroll, s.key);
      // Per-bet geometric growth rate — the same g from Phase 1, backed out
      // of the backtest's actual bet count. Far more readable than the raw
      // dollar figure once compounding runs over 1,000+ bets.
      const growthRatePerBet =
        result.betsPlaced > 0 ? Math.log(Math.max(result.finalBankroll, 1e-9) / startingBankroll) / result.betsPlaced : 0;
      return { ...s, result, growthRatePerBet };
    });

    // Illustrative sensitivity: how much does +200 Elo points move predicted p?
    const pAtEven = predictProba(model, [0]);
    const pAt200 = predictProba(model, [200]);

    return {
      trainCount: train.length,
      testCount: test.length,
      trainDateRange: [train[0].date, train[train.length - 1].date] as const,
      testDateRange: [test[0].date, test[test.length - 1].date] as const,
      brier,
      naiveBrier,
      bins,
      backtests,
      pAtEven,
      pAt200,
    };
  }, [games, eloOptions, startingBankroll]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Probability Model
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          A simple, transparent model: Elo ratings built game-by-game from raw historical
          scores (no vegas lines used), then a logistic regression turning the pregame Elo
          gap into a calibrated win probability. Trained on the earliest {(100 - TEST_FRACTION * 100).toFixed(0)}%
          of games and evaluated only on the most recent {(TEST_FRACTION * 100).toFixed(0)}% it never saw.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(DATASET_LABELS) as Dataset[]).map((d) => (
          <button
            key={d}
            onClick={() => setDataset(d)}
            className="rounded-full border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: dataset === d ? "var(--series-1)" : "var(--card-border)",
              background: dataset === d ? "var(--series-1)" : "transparent",
              color: dataset === d ? "white" : "var(--text-secondary)",
            }}
          >
            {DATASET_LABELS[d]}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {DATASET_LABELS[dataset]} game data…
        </p>
      )}
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Failed to load game data: {error}
        </div>
      )}

      {!loading && !error && analysis && (
        <>
          <div
            className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-3"
            style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Elo K-factor</span>
              <input
                type="number"
                min={1}
                max={100}
                value={kFactor}
                onChange={(e) => setKFactor(Math.max(1, Number(e.target.value)))}
                className="rounded-md border px-2 py-1.5 tabular-nums"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Home advantage (Elo pts)</span>
              <input
                type="number"
                min={0}
                max={200}
                value={homeAdvantage}
                onChange={(e) => setHomeAdvantage(Math.max(0, Number(e.target.value)))}
                className="rounded-md border px-2 py-1.5 tabular-nums"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Backtest starting bankroll</span>
              <input
                type="number"
                min={0}
                step={100}
                value={startingBankroll}
                onChange={(e) => setStartingBankroll(Math.max(1, Number(e.target.value)))}
                className="rounded-md border px-2 py-1.5 tabular-nums"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
              />
            </label>
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Trained on {analysis.trainCount.toLocaleString()} games ({analysis.trainDateRange[0]} to{" "}
            {analysis.trainDateRange[1]}) · evaluated on {analysis.testCount.toLocaleString()} held-out games (
            {analysis.testDateRange[0]} to {analysis.testDateRange[1]}) · a home team {(analysis.pAtEven * 100).toFixed(0)}%
            favorite grows to {(analysis.pAt200 * 100).toFixed(0)}% with a +200 Elo edge.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <StatTile label="Brier score (test set)" value={analysis.brier.toFixed(4)} sub="lower is better; 0 = perfect" />
            <StatTile
              label="vs. naive baseline"
              value={analysis.brier < analysis.naiveBrier ? "better" : "worse"}
              sub={`naive (constant p): ${analysis.naiveBrier.toFixed(4)}`}
              accent={analysis.brier < analysis.naiveBrier ? "good" : "critical"}
            />
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Calibration (reliability diagram, out-of-sample)
            </h2>
            <ReliabilityChart bins={analysis.bins} />
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Backtest: flat vs. full-Kelly vs. half-Kelly sizing
            </h2>
            <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Every held-out game is offered at standard -110 odds on both sides (b ≈ 0.909) — this
              dataset has no real historical sportsbook lines, so this is a simplifying assumption,
              not an actual market price. A bet is placed only when the model shows positive
              expectancy at those odds, and every single bet is capped at 25% of the current
              bankroll regardless of how large Kelly&apos;s raw recommendation is (even half-Kelly can
              still be ~50% on a very confident prediction — a hard cap is the real defense).
            </p>
            <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Full-Kelly&apos;s bankroll figure below can still look absurd (sometimes far beyond
              anything a real bankroll could reach) — that&apos;s genuine, expected Kelly math
              compounding a sustained edge over {analysis.testCount.toLocaleString()} consecutive bets, not a bug. No real
              market would let anyone re-bet an ever-growing bankroll at unchanged odds for that
              many years without limiting the account, so treat it as an illustration of Kelly&apos;s
              compounding power, not a real projection. The <strong>per-bet growth rate</strong> below is
              the honest number to compare across strategies.
            </p>
            <BacktestChart
              series={analysis.backtests.map((b) => ({ label: b.label, color: b.color, path: b.result.path }))}
              startingBankroll={startingBankroll}
            />
            <div className="mt-4 grid grid-cols-3 gap-3">
              {analysis.backtests.map((b) => (
                <StatTile
                  key={b.key}
                  label={b.label}
                  value={compactCurrency(b.result.finalBankroll)}
                  sub={`${b.result.betsPlaced} bets, ${b.result.betsWon} won · max DD ${(b.result.maxDrawdown * 100).toFixed(0)}%`}
                  accent={b.result.finalBankroll >= startingBankroll ? "good" : "critical"}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {analysis.backtests.map((b) => (
                <StatTile
                  key={`${b.key}-growth`}
                  label={`${b.label} — per-bet growth`}
                  value={`${b.growthRatePerBet >= 0 ? "+" : ""}${(b.growthRatePerBet * 100).toFixed(3)}%`}
                  sub="g(f) per bet, the honest comparison"
                  accent={b.growthRatePerBet >= 0 ? "good" : "critical"}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
