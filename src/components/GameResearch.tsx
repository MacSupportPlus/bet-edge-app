"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { DEFAULT_ELO_OPTIONS, Game, runElo } from "@/lib/elo";
import { fetchGameOdds, GameOdds } from "@/lib/espn";
import { currency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
import { predictProba, sigmoid, trainLogisticRegression } from "@/lib/logisticRegression";
import { FRACTIONAL_OPTIONS, formatMoneyline, parseMoneyline } from "@/lib/odds";
import { headToHead, headToHeadRecord, seasonAverage, teamStatTrend } from "@/lib/research";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickSide } from "@/lib/scanner";
import { SPORT_ELO_OPTIONS } from "@/lib/sportConfig";
import { computeTeamStatDiffs, loadTeamStats, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "@/lib/teamStats";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { LineChart } from "./LineChart";
import { StatTile } from "./StatTile";

type Dataset = "nfl" | "cfb";

const RECENT_GAMES_SHOWN = 8;

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return iso;
  }
}

export function GameResearch() {
  const router = useRouter();
  const params = useSearchParams();
  const dataset: Dataset = params.get("dataset") === "nfl" ? "nfl" : "cfb";
  const home = params.get("home") ?? "";
  const away = params.get("away") ?? "";
  const espnId = params.get("espnId");

  const [fetchResult, setFetchResult] = useState<{
    dataset: Dataset;
    games: Game[] | null;
    teamStats: TeamGameStat[] | null;
    error: string | null;
  }>({ dataset: "cfb", games: null, teamStats: null, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(dataset), loadTeamStats(dataset)])
      .then(([g, ts]) => {
        if (!cancelled) setFetchResult({ dataset, games: g, teamStats: ts, error: null });
      })
      .catch((e) => {
        if (!cancelled) setFetchResult({ dataset, games: null, teamStats: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  // Manual odds entry — always editable, so this works for a matchup ESPN
  // isn't live-tracking too, not just ones opened from This Week.
  const [homeMoneylineInput, setHomeMoneylineInput] = useState("");
  const [awayMoneylineInput, setAwayMoneylineInput] = useState("");
  const [spreadInput, setSpreadInput] = useState("");
  const [totalInput, setTotalInput] = useState("");

  // Keyed by which espnId it resolved for, so a stale result never renders
  // as if it belonged to a different (or absent) game id. Also pre-fills the
  // manual inputs above the first (and only the first) time live odds show up
  // for this matchup — this effect only re-fires when espnId/dataset actually
  // change to a different game, so a user's own edits afterward are never
  // clobbered by a later re-render.
  const [oddsResult, setOddsResult] = useState<{ espnId: string; odds: GameOdds | null } | null>(null);
  useEffect(() => {
    if (!espnId) return;
    let cancelled = false;
    fetchGameOdds(dataset, espnId)
      .then((fetchedOdds) => {
        if (cancelled) return;
        setOddsResult({ espnId, odds: fetchedOdds });
        if (fetchedOdds?.homeMoneyline !== null && fetchedOdds?.homeMoneyline !== undefined) {
          setHomeMoneylineInput(String(fetchedOdds.homeMoneyline));
        }
        if (fetchedOdds?.awayMoneyline !== null && fetchedOdds?.awayMoneyline !== undefined) {
          setAwayMoneylineInput(String(fetchedOdds.awayMoneyline));
        }
        if (fetchedOdds?.spread !== null && fetchedOdds?.spread !== undefined) {
          setSpreadInput(String(fetchedOdds.spread));
        }
      })
      .catch(() => {
        if (!cancelled) setOddsResult({ espnId, odds: null });
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, espnId]);
  const odds = oddsResult?.espnId === espnId ? oddsResult.odds : null;

  const [startingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState("weekly-edges:fractional", 0.5);
  const currentBankroll = useMemo(() => summarizeBankroll(startingBankroll, bets).currentBankroll, [startingBankroll, bets]);

  // fetchResult's initial `dataset` value matches the default dataset, so a
  // plain `fetchResult.dataset !== dataset` check reads false before the
  // very first fetch has even resolved — also require games/error to be
  // populated, or this briefly renders "team not found" instead of loading.
  const games = fetchResult.dataset === dataset ? fetchResult.games : null;
  const teamStats = fetchResult.dataset === dataset ? fetchResult.teamStats : null;
  const error = fetchResult.dataset === dataset ? fetchResult.error : null;
  const loading = fetchResult.dataset !== dataset || (games === null && error === null);

  const analysis = useMemo(() => {
    if (!games || !home || !away) return null;
    const eloOptions = SPORT_ELO_OPTIONS[dataset];
    const { records, finalRatings, ratingHistory } = runElo(games, eloOptions);
    const homeHistory = ratingHistory.get(home);
    const awayHistory = ratingHistory.get(away);
    if (!homeHistory || !awayHistory) return null;

    const statDiffs = teamStats ? computeTeamStatDiffs(games, teamStats) : new Map();
    const hasTeamStats = statDiffs.size > 0;
    const statFeaturesFor = (r: { gameId?: string }) => (r.gameId && statDiffs.get(r.gameId)) || NEUTRAL_TEAM_STAT_FEATURES;
    const featuresFor = (r: (typeof records)[number]) => {
      const base = [r.eloDiff];
      if (!hasTeamStats) return base;
      const f = statFeaturesFor(r);
      return [...base, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
    };

    const model = trainLogisticRegression(
      records.map(featuresFor),
      records.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const homeElo = finalRatings.get(home) ?? eloOptions.initialRating;
    const awayElo = finalRatings.get(away) ?? eloOptions.initialRating;
    const eloDiff = homeElo + eloOptions.homeAdvantage - awayElo;

    const currentSeason = games[games.length - 1].season;
    let statFeatures = NEUTRAL_TEAM_STAT_FEATURES;
    if (hasTeamStats && teamStats) {
      const homeAvg = seasonAverage(teamStatTrend(games, teamStats, home), currentSeason);
      const awayAvg = seasonAverage(teamStatTrend(games, teamStats, away), currentSeason);
      if (homeAvg && awayAvg) {
        statFeatures = {
          totalYardsDiff: homeAvg.totalYards - awayAvg.totalYards,
          turnoverMarginDiff: homeAvg.turnoverMargin - awayAvg.turnoverMargin,
          offEpaDiff: homeAvg.offEpa - awayAvg.offEpa,
        };
      }
    }

    const fullFeatures = hasTeamStats
      ? [eloDiff, statFeatures.totalYardsDiff, statFeatures.turnoverMarginDiff, statFeatures.offEpaDiff]
      : [eloDiff];
    const pHome = predictProba(model, fullFeatures);
    // Elo-alone probability, holding every other feature at neutral (0) — isolates how much of
    // the final number came from Elo vs. the added team-stat features.
    const pEloOnly = sigmoid(model.bias + model.weights[0] * eloDiff);

    const h2h = headToHead(games, home, away);
    const h2hRecordHome = headToHeadRecord(h2h, home);

    const recentGames = (history: typeof homeHistory) => [...history].reverse().slice(0, RECENT_GAMES_SHOWN);

    return {
      homeElo,
      awayElo,
      eloDiff,
      pHome,
      pEloOnly,
      hasTeamStats,
      statFeatures,
      homeHistory,
      awayHistory,
      recentHome: recentGames(homeHistory),
      recentAway: recentGames(awayHistory),
      h2h,
      h2hRecordHome,
      homeStatTrend: hasTeamStats && teamStats ? teamStatTrend(games, teamStats, home) : [],
      awayStatTrend: hasTeamStats && teamStats ? teamStatTrend(games, teamStats, away) : [],
    };
  }, [games, teamStats, home, away, dataset]);

  // The exact same pick/classify pipeline as This Week, but for whatever
  // odds are typed in above — so any matchup you can research is also one
  // you can check for a real edge, not just the ones ESPN is tracking live.
  const betCheck = useMemo(() => {
    if (!analysis) return null;
    const homeMl = parseMoneyline(homeMoneylineInput);
    const awayMl = parseMoneyline(awayMoneylineInput);
    if (homeMl === null || awayMl === null) return null;
    const pick = pickSide(analysis.pHome, homeMl, awayMl, home, away);
    const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);
    return { pick, classification };
  }, [analysis, homeMoneylineInput, awayMoneylineInput, home, away, currentBankroll, fractionalMultiplier]);

  const teamOptions = useMemo(() => {
    if (!games) return [];
    return [...new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))].sort();
  }, [games]);

  const [pickHome, setPickHome] = useState("");
  const [pickAway, setPickAway] = useState("");

  function switchDataset(next: Dataset) {
    router.push(`/research?dataset=${next}`);
  }

  function goToPicked() {
    if (!pickHome || !pickAway || pickHome === pickAway) return;
    router.push(`/research?${new URLSearchParams({ dataset, home: pickHome, away: pickAway }).toString()}`);
  }

  if (!home || !away) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Game Research
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Opened from a card in This Week or the Probability Model tab, this brings both teams
          straight in. You can also just pick two teams yourself below — useful for digging into
          any matchup, not just the ones the model flagged.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(["cfb", "nfl"] as Dataset[]).map((d) => (
            <button
              key={d}
              onClick={() => switchDataset(d)}
              className="rounded-full border px-3 py-1.5 text-sm transition-colors"
              style={{
                borderColor: dataset === d ? "var(--series-1)" : "var(--card-border)",
                background: dataset === d ? "var(--series-1)" : "transparent",
                color: dataset === d ? "white" : "var(--text-secondary)",
              }}
            >
              {d === "nfl" ? "NFL" : "College Football"}
            </button>
          ))}
        </div>

        {loading && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading team list…
          </p>
        )}
        {error && (
          <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
            Failed to load game data: {error}
          </div>
        )}

        {!loading && !error && teamOptions.length > 0 && (
          <div
            className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-3"
            style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Away team</span>
              <select
                value={pickAway}
                onChange={(e) => setPickAway(e.target.value)}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
              >
                <option value="">Choose…</option>
                {teamOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Home team</span>
              <select
                value={pickHome}
                onChange={(e) => setPickHome(e.target.value)}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
              >
                <option value="">Choose…</option>
                {teamOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                onClick={goToPicked}
                disabled={!pickHome || !pickAway || pickHome === pickAway}
                className="w-full rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--series-1)" }}
              >
                View research →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {away} at {home}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Everything the model itself sees for this matchup, laid out so you can form your own read
          before trusting (or overriding) its number — rating trends, recent form, head-to-head
          history, and exactly how it arrived at its probability.
        </p>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {dataset === "nfl" ? "NFL" : "college football"} history…
        </p>
      )}
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Failed to load game data: {error}
        </div>
      )}
      {!loading && !error && !analysis && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t find one or both of these teams in the historical data — the link that brought
          you here may be using a name that doesn&apos;t match our records.
        </div>
      )}

      {!loading && !error && analysis && (
        <>
          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              What the model says, and why
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={`${home} Elo`} value={analysis.homeElo.toFixed(0)} sub="current rating" />
              <StatTile label={`${away} Elo`} value={analysis.awayElo.toFixed(0)} sub="current rating" />
              <StatTile label="Model probability" value={`${(analysis.pHome * 100).toFixed(1)}%`} sub={`${home} to win`} accent="good" />
              <StatTile
                label="From Elo alone"
                value={`${(analysis.pEloOnly * 100).toFixed(1)}%`}
                sub={analysis.hasTeamStats ? "before team stats are added" : "the whole model"}
              />
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {home} rates {Math.abs(analysis.eloDiff).toFixed(0)} Elo points {analysis.eloDiff >= 0 ? "above" : "below"}{" "}
              {away} once home field is factored in — on its own, that gap alone implies a{" "}
              {(analysis.pEloOnly * 100).toFixed(0)}% chance for {home}.
              {analysis.hasTeamStats && (
                <>
                  {" "}
                  Adding this season&apos;s total yards, turnover margin, and offensive efficiency moves that to{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>{(analysis.pHome * 100).toFixed(0)}%</strong> — a{" "}
                  {Math.abs(analysis.pHome - analysis.pEloOnly) * 100 < 0.5
                    ? "negligible"
                    : `${((analysis.pHome - analysis.pEloOnly) * 100).toFixed(1)}-point`}{" "}
                  swing from those extra stats alone.
                </>
              )}{" "}
              This is the same Elo + logistic regression model as the Probability Model tab — no injuries,
              weather, or lineup news factored in.
            </p>
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Is this a good bet?
            </h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {odds
                ? `Pre-filled from live odds via ${odds.provider} — edit any of these if you found a better number elsewhere, or if you're checking a hypothetical line.`
                : "Type in the moneyline for each side (from any sportsbook) to run this matchup through the same check as This Week — spread and total are just for your own reference and aren't used in the calculation below."}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>{away} moneyline</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. +150"
                  value={awayMoneylineInput}
                  onChange={(e) => setAwayMoneylineInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>{home} moneyline</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. -180"
                  value={homeMoneylineInput}
                  onChange={(e) => setHomeMoneylineInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Spread (reference)</span>
                <input
                  type="text"
                  placeholder={`e.g. ${home} -3.5`}
                  value={spreadInput}
                  onChange={(e) => setSpreadInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Total / O-U (reference)</span>
                <input
                  type="text"
                  placeholder="e.g. 44.5"
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Stake sizing:
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

            {!betCheck && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Enter both moneylines above to check this matchup for an edge.
              </p>
            )}

            {betCheck && betCheck.classification.status === "no-edge" && (
              <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                No edge at these odds — the model&apos;s probability doesn&apos;t beat what the market
                is already pricing in.
              </p>
            )}

            {betCheck && betCheck.classification.status === "flagged" && (
              <div
                className="mt-3 rounded-lg border px-4 py-3 text-sm"
                style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
              >
                <strong>Flagged, not a recommendation.</strong> The model says {betCheck.pick.team}{" "}
                {(betCheck.pick.summary.p * 100).toFixed(0)}%, but the market only implies{" "}
                {(betCheck.pick.marketImplied * 100).toFixed(0)}% — a gap this big (past{" "}
                {(MAX_TRUSTED_DISAGREEMENT * 100).toFixed(0)} points or {MAX_TRUSTED_RATIO}× the market&apos;s
                own number) is far more likely to mean the model is missing something real than that
                free money was found.
              </div>
            )}

            {betCheck && betCheck.classification.status === "edge" && (
              <div className="mt-3 rounded-lg border p-4" style={{ borderColor: "var(--status-good)" }}>
                <span
                  className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ background: "var(--status-good)" }}
                >
                  BET {betCheck.pick.team} {formatMoneyline(betCheck.pick.moneyline)}
                </span>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Model prob." value={`${(betCheck.pick.summary.p * 100).toFixed(1)}%`} />
                  <StatTile label="Market implied" value={`${(betCheck.pick.marketImplied * 100).toFixed(1)}%`} sub="includes vig" />
                  <StatTile label="Expected value" value={`+${(betCheck.pick.summary.expectancy * 100).toFixed(1)}%`} accent="good" />
                  <StatTile label="Recommended stake" value={currency(betCheck.classification.stake)} />
                </div>
                <Link
                  href={`/tracker?${new URLSearchParams({
                    desc: `${betCheck.pick.team} ML (${formatMoneyline(betCheck.pick.moneyline)}) — ${away} @ ${home}`,
                    p: (betCheck.pick.summary.p * 100).toFixed(1),
                    b: betCheck.pick.b.toFixed(4),
                    stake: betCheck.classification.stake.toFixed(0),
                  }).toString()}`}
                  className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: "var(--series-1)" }}
                >
                  Log this bet in the Tracker →
                </Link>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Elo rating trend — last {RECENT_GAMES_SHOWN} games each
            </h2>
            <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Each point is that team&apos;s rating right after a game — climbing means it&apos;s been
              beating expectations lately, flattening or dropping means the opposite.
            </p>
            <LineChart
              ariaLabel="Elo rating trend for both teams"
              baseline={DEFAULT_ELO_OPTIONS.initialRating}
              yFormat={(v) => v.toFixed(0)}
              xFormat={(v) => fmtDate(new Date(v).toISOString())}
              series={[
                {
                  label: home,
                  color: "var(--series-1)",
                  points: [...analysis.recentHome].reverse().map((p) => ({ x: new Date(p.date).getTime(), y: p.ratingAfter })),
                },
                {
                  label: away,
                  color: "var(--series-2)",
                  points: [...analysis.recentAway].reverse().map((p) => ({ x: new Date(p.date).getTime(), y: p.ratingAfter })),
                },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { team: home, recent: analysis.recentHome },
              { team: away, recent: analysis.recentAway },
            ].map(({ team, recent }) => (
              <div key={team} className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {team} — recent form
                </h2>
                <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  The number after each opponent is <em>their</em> Elo rating going into that game —
                  a win over a 1650-rated team says a lot more than a win over a 1350 one, and
                  that&apos;s already what moved this team&apos;s own rating, not just the final score.
                </p>
                <div className="flex flex-col gap-1 text-xs">
                  {recent.map((g, i) => (
                    <div key={i} className="flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span>
                        {fmtDate(g.date)} {g.isHome ? "vs" : "at"} {g.opponent} ({g.opponentRatingBefore.toFixed(0)})
                      </span>
                      <span
                        className="font-medium"
                        style={{ color: g.result === "W" ? "var(--status-good)" : g.result === "L" ? "var(--status-critical)" : "var(--text-muted)" }}
                      >
                        {g.result} {g.pointsFor}-{g.pointsAgainst}
                      </span>
                    </div>
                  ))}
                  {recent.length === 0 && <span style={{ color: "var(--text-muted)" }}>No games in the dataset yet.</span>}
                  {recent.length > 0 && (
                    <div className="mt-1 pt-1" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--card-border)" }}>
                      Avg. opponent rating (these {recent.length}): {(recent.reduce((s, g) => s + g.opponentRatingBefore, 0) / recent.length).toFixed(0)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Head-to-head
            </h2>
            {analysis.h2h.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                No meetings between these two teams in the dataset.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {home} is {analysis.h2hRecordHome.wins}-{analysis.h2hRecordHome.losses}
                  {analysis.h2hRecordHome.ties > 0 ? `-${analysis.h2hRecordHome.ties}` : ""} all-time against {away}.
                </p>
                <div className="flex flex-col gap-1 text-xs">
                  {analysis.h2h.slice(0, 6).map((g, i) => (
                    <div key={i} style={{ color: "var(--text-secondary)" }}>
                      {fmtDate(g.date)}: {g.awayTeam} {g.awayScore} at {g.homeTeam} {g.homeScore}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {analysis.hasTeamStats && (analysis.homeStatTrend.length > 0 || analysis.awayStatTrend.length > 0) && (
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Team stat trends (NFL only)
              </h2>
              <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Same stats the model trains on for NFL games — total yards, turnover margin, and
                offensive efficiency (EPA), one point per game played.
              </p>
              {[
                {
                  label: "Total yards",
                  key: "totalYards" as const,
                  description: "Yards gained that game, offense + special teams. The raw measure of output — higher is generally better, but it doesn't capture efficiency: a team can pile up yards without scoring.",
                },
                {
                  label: "Turnover margin",
                  key: "turnoverMargin" as const,
                  baseline: 0,
                  description: "Takeaways minus giveaways. Positive (above the dashed line) means they gained the ball more than they lost it — one of the strongest single predictors of winning, since turnovers hand the opponent free scoring chances.",
                },
                {
                  label: "Offensive EPA",
                  key: "offEpa" as const,
                  baseline: 0,
                  description: "Expected Points Added per play, summed across the game. Unlike total yards, EPA credits a play for how much it actually helped — a 5-yard gain on 3rd-and-3 counts far more than the same 5 yards on 3rd-and-15. Positive (above the dashed line) means the offense added value on average; negative means it lost value relative to what an average play would do in that situation.",
                },
              ].map(({ label, key, baseline, description }) => (
                <div key={key} className="mb-4 last:mb-0">
                  <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </div>
                  <p className="mb-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {description}
                  </p>
                  <LineChart
                    ariaLabel={`${label} trend for both teams`}
                    baseline={baseline}
                    yFormat={(v) => v.toFixed(key === "totalYards" ? 0 : 1)}
                    xFormat={(v) => fmtDate(new Date(v).toISOString())}
                    series={[
                      {
                        label: home,
                        color: "var(--series-1)",
                        points: analysis.homeStatTrend.slice(-RECENT_GAMES_SHOWN).map((p) => ({ x: new Date(p.date).getTime(), y: p[key] })),
                      },
                      {
                        label: away,
                        color: "var(--series-2)",
                        points: analysis.awayStatTrend.slice(-RECENT_GAMES_SHOWN).map((p) => ({ x: new Date(p.date).getTime(), y: p[key] })),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
