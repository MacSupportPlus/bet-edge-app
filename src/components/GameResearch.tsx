"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { DEFAULT_ELO_OPTIONS, Game, runElo } from "@/lib/elo";
import { fetchGameSummary, GameOdds, PlayerInjury } from "@/lib/espn";
import { currency } from "@/lib/format";
import { NflGameContext, loadNflGameContext } from "@/lib/gameContext";
import { loadGames } from "@/lib/loadGames";
import { predictProba, sigmoid, trainLogisticRegression } from "@/lib/logisticRegression";
import { buildFeatureVector } from "@/lib/modelFeatures";
import { FRACTIONAL_OPTIONS, formatMoneyline, parseMoneyline } from "@/lib/odds";
import { computeQbRankings } from "@/lib/playerRankings";
import { loadPlayerUsage, primaryStarter, PlayerUsageRow, UsageCategory, USAGE_CATEGORY_LABELS, formatStatLine } from "@/lib/playerUsage";
import { buildQbValueModel, qbValueDiff, resolveLiveStarter } from "@/lib/qbValue";
import { computeRankings } from "@/lib/rankings";
import { headToHead, headToHeadRecord, seasonAverage, teamStatTrend } from "@/lib/research";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickOverUnder, pickSide } from "@/lib/scanner";
import { SPORT_ELO_OPTIONS } from "@/lib/sportConfig";
import {
  empiricalCoverProbability,
  empiricalOverProbability,
  fitMarginModel,
  formatSpread,
  historicalTotalResiduals,
  MIN_RESIDUALS_FOR_EMPIRICAL,
  predictMargin,
  predictTotal,
  residualStdDev,
  seasonScoringAverage,
} from "@/lib/spreadModel";
import { computeTeamStatDiffs, loadTeamStats, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "@/lib/teamStats";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { LineChart } from "./LineChart";
import { StatTile } from "./StatTile";

type Dataset = "nfl" | "cfb";

// Stable reference for the "no data yet" fallback, so it doesn't retrigger
// downstream useMemo hooks on every render the way a fresh `[]` would.
const EMPTY_PLAYER_USAGE: PlayerUsageRow[] = [];

const RECENT_GAMES_SHOWN = 8;

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return iso;
  }
}

/** This one side's OWN spread number, in the sign it would actually be posted at (e.g. the underdog gets a "+"), given a home-favored-convention line — unlike spreadModel.ts's formatSpread, which always shows whoever's favored. */
function sideSpreadLabel(homeTeam: string, awayTeam: string, line: number, side: "home" | "away"): string {
  const teamLine = side === "home" ? -line : line;
  const team = side === "home" ? homeTeam : awayTeam;
  return `${team} ${teamLine >= 0 ? "+" : ""}${teamLine.toFixed(1)}`;
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
    playerUsage: PlayerUsageRow[];
    gameContext: Map<string, NflGameContext> | null;
    error: string | null;
  }>({ dataset: "cfb", games: null, teamStats: null, playerUsage: [], gameContext: null, error: null });

  useEffect(() => {
    let cancelled = false;
    // gameContext (per-game starting-QB names) only exists for NFL — see gameContext.ts.
    const gameContextPromise = dataset === "nfl" ? loadNflGameContext() : Promise.resolve(new Map<string, NflGameContext>());
    Promise.all([loadGames(dataset), loadTeamStats(dataset), loadPlayerUsage(dataset), gameContextPromise])
      .then(([g, ts, pu, gc]) => {
        if (!cancelled) setFetchResult({ dataset, games: g, teamStats: ts, playerUsage: pu, gameContext: gc, error: null });
      })
      .catch((e) => {
        if (!cancelled) setFetchResult({ dataset, games: null, teamStats: null, playerUsage: [], gameContext: null, error: String(e) });
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
  const [spreadHomeOddsInput, setSpreadHomeOddsInput] = useState("-110");
  const [spreadAwayOddsInput, setSpreadAwayOddsInput] = useState("-110");
  const [totalOverOddsInput, setTotalOverOddsInput] = useState("-110");
  const [totalUnderOddsInput, setTotalUnderOddsInput] = useState("-110");

  // Keyed by which espnId it resolved for, so a stale result never renders
  // as if it belonged to a different (or absent) game id. Also pre-fills the
  // manual inputs above the first (and only the first) time live odds show up
  // for this matchup — this effect only re-fires when espnId/dataset actually
  // change to a different game, so a user's own edits afterward are never
  // clobbered by a later re-render.
  const [oddsResult, setOddsResult] = useState<{ espnId: string; odds: GameOdds | null; injuries: PlayerInjury[] } | null>(null);
  useEffect(() => {
    if (!espnId) return;
    let cancelled = false;
    fetchGameSummary(dataset, espnId)
      .then(({ odds: fetchedOdds, injuries }) => {
        if (cancelled) return;
        setOddsResult({ espnId, odds: fetchedOdds, injuries });
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
        if (!cancelled) setOddsResult({ espnId, odds: null, injuries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, espnId]);
  const odds = oddsResult?.espnId === espnId ? oddsResult.odds : null;
  const injuries = oddsResult?.espnId === espnId ? oddsResult.injuries : [];

  const [startingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState("weekly-edges:fractional", 0.5);
  const currentBankroll = useMemo(() => summarizeBankroll(startingBankroll, bets).currentBankroll, [startingBankroll, bets]);
  // Optional override for "what if my bankroll were different" — never
  // written back to bankroll-tracker:starting, so it can't drift from what
  // the Tracker page actually shows.
  const [bankrollOverrideInput, setBankrollOverrideInput] = useState("");
  const effectiveBankroll =
    bankrollOverrideInput.trim() !== "" && !Number.isNaN(Number(bankrollOverrideInput))
      ? Math.max(0, Number(bankrollOverrideInput))
      : currentBankroll;

  // fetchResult's initial `dataset` value matches the default dataset, so a
  // plain `fetchResult.dataset !== dataset` check reads false before the
  // very first fetch has even resolved — also require games/error to be
  // populated, or this briefly renders "team not found" instead of loading.
  const games = fetchResult.dataset === dataset ? fetchResult.games : null;
  const teamStats = fetchResult.dataset === dataset ? fetchResult.teamStats : null;
  const playerUsage = fetchResult.dataset === dataset ? fetchResult.playerUsage : EMPTY_PLAYER_USAGE;
  const gameContext = fetchResult.dataset === dataset ? fetchResult.gameContext : null;
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

    // Starting-QB value (walk-forward, no-leakage) — validated by held-out
    // Brier-score backtesting (see qbValue.ts's doc comment) before being
    // wired in here. NFL-only: depends on gameContext.ts's per-game
    // starting-QB names, which only nflverse's archive carries.
    const qbModel = dataset === "nfl" ? buildQbValueModel(games, playerUsage) : null;
    const hasQbValue = dataset === "nfl" && !!gameContext && gameContext.size > 0 && !!qbModel;
    const qbValueFor = (r: { gameId?: string; date: string }) => {
      if (!qbModel || !r.gameId || !gameContext) return null;
      const ctx = gameContext.get(r.gameId);
      if (!ctx) return null;
      return qbValueDiff(qbModel, ctx.homeQbName, ctx.awayQbName, r.date);
    };

    const featuresFor = (r: (typeof records)[number]) =>
      buildFeatureVector(
        { eloDiff: r.eloDiff, teamStats: r.gameId ? (statDiffs.get(r.gameId) ?? null) : null, qbValue: qbValueFor(r) },
        hasTeamStats,
        hasQbValue,
      );

    const model = trainLogisticRegression(
      records.map(featuresFor),
      records.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const homeElo = finalRatings.get(home) ?? eloOptions.initialRating;
    const awayElo = finalRatings.get(away) ?? eloOptions.initialRating;
    const eloDiff = homeElo + eloOptions.homeAdvantage - awayElo;

    const currentSeason = games[games.length - 1].season;
    let statFeatures: typeof NEUTRAL_TEAM_STAT_FEATURES | null = null;
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

    // Live QB value: today's presumed starters (this season's usage leader
    // in passing for each team), valued as of today — UNLESS that presumed
    // starter shows up on ESPN's live injury report (fetched alongside odds
    // when this page is opened from a live game) with a status severe
    // enough to assume they won't play, in which case the season's #2
    // passing-usage leader is used instead. This still can't catch a change
    // ESPN hasn't reported yet, but it closes the gap for anything already
    // flagged — better than blindly trusting a hurt starter's rating.
    let liveQbValue: ReturnType<typeof qbValueDiff> = null;
    let liveHomeQb: string | null = null;
    let liveAwayQb: string | null = null;
    let homeQbInjuryNote: string | null = null;
    let awayQbInjuryNote: string | null = null;
    if (hasQbValue && qbModel) {
      const homeResolved = resolveLiveStarter(playerUsage, games, home, currentSeason, injuries);
      const awayResolved = resolveLiveStarter(playerUsage, games, away, currentSeason, injuries);
      liveHomeQb = homeResolved.player;
      liveAwayQb = awayResolved.player;
      homeQbInjuryNote = homeResolved.note;
      awayQbInjuryNote = awayResolved.note;
      liveQbValue = qbValueDiff(qbModel, liveHomeQb, liveAwayQb, new Date().toISOString().slice(0, 10));
    }

    const fullFeatures = buildFeatureVector({ eloDiff, teamStats: statFeatures, qbValue: liveQbValue }, hasTeamStats, hasQbValue);
    const pHome = predictProba(model, fullFeatures);
    // Elo-alone probability, holding every other feature at neutral (0) — isolates how much of
    // the final number came from Elo vs. the added team-stat/QB-value features.
    const pEloOnly = sigmoid(model.bias + model.weights[0] * eloDiff);
    // Elo + team stats, but before QB value — isolates QB value's own contribution, same idea as pEloOnly.
    const pBeforeQb = hasQbValue
      ? predictProba(model, buildFeatureVector({ eloDiff, teamStats: statFeatures, qbValue: null }, hasTeamStats, false))
      : pHome;

    const h2h = headToHead(games, home, away);
    const h2hRecordHome = headToHeadRecord(h2h, home);

    const recentGames = (history: typeof homeHistory) => [...history].reverse().slice(0, RECENT_GAMES_SHOWN);

    // See spreadModel.ts for the honest accuracy numbers behind these
    // (measured against real historical market lines). The residuals below
    // (actual vs. predicted, walk-forward for totals) are what let the
    // spread/total check further down turn these into a real cover/over
    // probability instead of just a bare number.
    const marginModel = fitMarginModel(records);
    const predictedMargin = predictMargin(marginModel, eloDiff);
    const marginPredictedActual = records.map((r) => ({ predicted: predictMargin(marginModel, r.eloDiff), actual: r.margin }));
    const marginResiduals = marginPredictedActual.map((r) => r.actual - r.predicted);
    const marginSigma = residualStdDev(marginPredictedActual);

    const homeScoringAvg = seasonScoringAverage(homeHistory, currentSeason);
    const awayScoringAvg = seasonScoringAverage(awayHistory, currentSeason);
    const predictedTotal = homeScoringAvg && awayScoringAvg ? predictTotal(homeScoringAvg, awayScoringAvg) : null;
    const totalResidualPairs = historicalTotalResiduals(games);
    const totalResiduals = totalResidualPairs.map((r) => r.actual - r.predicted);
    const totalSigma = residualStdDev(totalResidualPairs);

    // Who's actually been playing, from real box scores — context for a
    // human to weigh, not a model feature (see playerUsage.ts for why).
    const USAGE_CATEGORIES: UsageCategory[] = ["passing", "rushing", "receiving", "defensive"];
    const qbRankings = computeQbRankings(games, playerUsage, eloOptions);
    const qbRankFor = (team: string, player: string): number | null => {
      const idx = qbRankings?.rows.findIndex((r) => r.team === team && r.player === player) ?? -1;
      return idx >= 0 ? idx + 1 : null;
    };
    const qbRankOf = qbRankings?.rows.length ?? null;

    const keyPlayers = USAGE_CATEGORIES.map((category) => ({
      category,
      homeStarter: primaryStarter(playerUsage, games, home, category, currentSeason),
      awayStarter: primaryStarter(playerUsage, games, away, category, currentSeason),
    })).filter((k) => k.homeStarter !== null || k.awayStarter !== null);

    const ranked = computeRankings(dataset, games, teamStats, eloOptions);
    const rankFor = (team: string) => {
      const idx = ranked?.rows.findIndex((r) => r.team === team) ?? -1;
      return idx >= 0 ? { rank: idx + 1, of: ranked!.rows.length } : null;
    };
    const homeRank = rankFor(home);
    const awayRank = rankFor(away);
    const offDefFor = (team: string) => {
      const row = ranked?.rows.find((r) => r.team === team);
      return row ? { offenseRank: row.offenseRank, offenseRating: row.offenseRating, defenseRank: row.defenseRank, defenseRating: row.defenseRating, of: ranked!.rows.length } : null;
    };
    const homeOffDef = offDefFor(home);
    const awayOffDef = offDefFor(away);

    return {
      homeElo,
      awayElo,
      eloDiff,
      pHome,
      pEloOnly,
      pBeforeQb,
      hasTeamStats,
      statFeatures,
      hasQbValue,
      liveHomeQb,
      liveAwayQb,
      liveQbValue,
      homeQbInjuryNote,
      awayQbInjuryNote,
      homeHistory,
      awayHistory,
      recentHome: recentGames(homeHistory),
      recentAway: recentGames(awayHistory),
      keyPlayers,
      qbRankFor,
      qbRankOf,
      homeRank,
      awayRank,
      homeOffDef,
      awayOffDef,
      h2h,
      h2hRecordHome,
      homeStatTrend: hasTeamStats && teamStats ? teamStatTrend(games, teamStats, home) : [],
      awayStatTrend: hasTeamStats && teamStats ? teamStatTrend(games, teamStats, away) : [],
      predictedMargin,
      marginResiduals,
      marginSigma,
      predictedTotal,
      totalResiduals,
      totalSigma,
    };
  }, [games, teamStats, playerUsage, gameContext, injuries, home, away, dataset]);

  // The exact same pick/classify pipeline as This Week, but for whatever
  // odds are typed in above — so any matchup you can research is also one
  // you can check for a real edge, not just the ones ESPN is tracking live.
  const betCheck = useMemo(() => {
    if (!analysis) return null;
    const homeMl = parseMoneyline(homeMoneylineInput);
    const awayMl = parseMoneyline(awayMoneylineInput);
    if (homeMl === null || awayMl === null) return null;
    const pick = pickSide(analysis.pHome, homeMl, awayMl, home, away);
    const classification = classifyPick(pick, effectiveBankroll, fractionalMultiplier);
    return { pick, classification };
  }, [analysis, homeMoneylineInput, awayMoneylineInput, home, away, effectiveBankroll, fractionalMultiplier]);

  // Same idea as betCheck, for the spread — using the empirical (conformal-
  // style) cover probability from real held-out residuals rather than a
  // Normal-distribution assumption, so this now gets a genuine Kelly-sized
  // recommendation instead of just an "informational" number. Both sides
  // default to standard -110 juice, editable if you have the real book price.
  const spreadCheck = useMemo(() => {
    if (!analysis) return null;
    const line = parseFloat(spreadInput);
    if (Number.isNaN(line)) return null;
    const homeOdds = parseMoneyline(spreadHomeOddsInput) ?? -110;
    const awayOdds = parseMoneyline(spreadAwayOddsInput) ?? -110;
    const pHomeCovers = empiricalCoverProbability(analysis.predictedMargin, line, analysis.marginResiduals, analysis.marginSigma);
    const pick = pickOverUnder(pHomeCovers, homeOdds, awayOdds); // "over" = home covers, "under" = away covers
    const classification = classifyPick(pick, effectiveBankroll, fractionalMultiplier);
    return { pick, classification, pHomeCovers, usedEmpirical: analysis.marginResiduals.length >= MIN_RESIDUALS_FOR_EMPIRICAL };
  }, [analysis, spreadInput, spreadHomeOddsInput, spreadAwayOddsInput, effectiveBankroll, fractionalMultiplier]);

  const totalCheck = useMemo(() => {
    if (!analysis || analysis.predictedTotal === null) return null;
    const line = parseFloat(totalInput);
    if (Number.isNaN(line)) return null;
    const overOdds = parseMoneyline(totalOverOddsInput) ?? -110;
    const underOdds = parseMoneyline(totalUnderOddsInput) ?? -110;
    const pOver = empiricalOverProbability(analysis.predictedTotal, line, analysis.totalResiduals, analysis.totalSigma);
    const pick = pickOverUnder(pOver, overOdds, underOdds);
    const classification = classifyPick(pick, effectiveBankroll, fractionalMultiplier);
    return { pick, classification, pOver, usedEmpirical: analysis.totalResiduals.length >= MIN_RESIDUALS_FOR_EMPIRICAL };
  }, [analysis, totalInput, totalOverOddsInput, totalUnderOddsInput, effectiveBankroll, fractionalMultiplier]);

  const teamOptions = useMemo(() => {
    if (!games) return [];
    return [...new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))].sort();
  }, [games]);

  const [pickHome, setPickHome] = useState("");
  const [pickAway, setPickAway] = useState("");

  function switchDataset(next: Dataset) {
    router.push(`/research?dataset=${next}`);
  }

  const teamOptionSet = useMemo(() => new Set(teamOptions), [teamOptions]);
  const pickHomeValid = pickHome !== "" && teamOptionSet.has(pickHome);
  const pickAwayValid = pickAway !== "" && teamOptionSet.has(pickAway);

  function goToPicked() {
    if (!pickHomeValid || !pickAwayValid || pickHome === pickAway) return;
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
              <input
                type="text"
                list="research-team-options"
                value={pickAway}
                onChange={(e) => setPickAway(e.target.value)}
                placeholder="Type or choose…"
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Home team</span>
              <input
                type="text"
                list="research-team-options"
                value={pickHome}
                onChange={(e) => setPickHome(e.target.value)}
                placeholder="Type or choose…"
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
              />
            </label>
            <datalist id="research-team-options">
              {teamOptions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="flex items-end">
              <button
                onClick={goToPicked}
                disabled={!pickHomeValid || !pickAwayValid || pickHome === pickAway}
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
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Just want one team on its own?{" "}
          <Link href={`/team?${new URLSearchParams({ sport: dataset, name: away }).toString()}`} className="underline" style={{ color: "var(--series-1)" }}>
            {away} →
          </Link>{" "}
          ·{" "}
          <Link href={`/team?${new URLSearchParams({ sport: dataset, name: home }).toString()}`} className="underline" style={{ color: "var(--series-1)" }}>
            {home} →
          </Link>
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
              <StatTile
                label={`${home} Elo`}
                value={analysis.homeElo.toFixed(0)}
                sub={analysis.homeRank ? `#${analysis.homeRank.rank} of ${analysis.homeRank.of} this season` : "current rating"}
              />
              <StatTile
                label={`${away} Elo`}
                value={analysis.awayElo.toFixed(0)}
                sub={analysis.awayRank ? `#${analysis.awayRank.rank} of ${analysis.awayRank.of} this season` : "current rating"}
              />
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
                  <strong style={{ color: "var(--text-secondary)" }}>
                    {((analysis.hasQbValue ? analysis.pBeforeQb : analysis.pHome) * 100).toFixed(0)}%
                  </strong>{" "}
                  — a{" "}
                  {Math.abs((analysis.hasQbValue ? analysis.pBeforeQb : analysis.pHome) - analysis.pEloOnly) * 100 < 0.5
                    ? "negligible"
                    : `${(((analysis.hasQbValue ? analysis.pBeforeQb : analysis.pHome) - analysis.pEloOnly) * 100).toFixed(1)}-point`}{" "}
                  swing from those extra stats alone.
                </>
              )}
              {analysis.hasQbValue && analysis.liveHomeQb && analysis.liveAwayQb && (
                <>
                  {" "}
                  Factoring in the presumed starters —{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>{analysis.liveHomeQb}</strong> vs.{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>{analysis.liveAwayQb}</strong> — moves it to{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>{(analysis.pHome * 100).toFixed(0)}%</strong>, based on
                  each QB&apos;s season-to-date efficiency (never using games not yet played).
                </>
              )}{" "}
              This is the same Elo + logistic regression model behind{" "}
              <Link href="/model" className="underline" style={{ color: "var(--series-1)" }}>
                the full calibration backtest
              </Link>{" "}
              — no weather factored in, and presumed starters come from this season&apos;s usage data
              cross-checked against ESPN&apos;s live injury report (only available once this page is opened
              from a live game) — a change neither has caught yet won&apos;t be reflected.
            </p>
            {(analysis.homeQbInjuryNote || analysis.awayQbInjuryNote) && (
              <p
                className="mt-2 rounded-md border px-2 py-1.5 text-xs"
                style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
              >
                {analysis.homeQbInjuryNote && <>{analysis.homeQbInjuryNote}</>}
                {analysis.homeQbInjuryNote && analysis.awayQbInjuryNote && <br />}
                {analysis.awayQbInjuryNote && <>{analysis.awayQbInjuryNote}</>}
              </p>
            )}
            {(analysis.homeOffDef || analysis.awayOffDef) && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <strong style={{ color: "var(--text-secondary)" }}>Season rank (opponent-adjusted):</strong>{" "}
                {analysis.homeOffDef && (
                  <>
                    {home} offense #{analysis.homeOffDef.offenseRank} of {analysis.homeOffDef.of}, defense #
                    {analysis.homeOffDef.defenseRank} of {analysis.homeOffDef.of}
                  </>
                )}
                {analysis.homeOffDef && analysis.awayOffDef && " · "}
                {analysis.awayOffDef && (
                  <>
                    {away} offense #{analysis.awayOffDef.offenseRank} of {analysis.awayOffDef.of}, defense #
                    {analysis.awayOffDef.defenseRank} of {analysis.awayOffDef.of}
                  </>
                )}{" "}
                — see Rankings for the full board.
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Is this a good bet?
            </h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {odds
                ? `Pre-filled from live odds via ${odds.provider} — edit any of these if you found a better number elsewhere, or if you're checking a hypothetical line.`
                : "Type in the moneyline for each side (from any sportsbook) to run this matchup through the same check as This Week. Add a spread and/or total line below to check those too — each gets its own real cover/over probability now, not just a bare number."}
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
                <span style={{ color: "var(--text-secondary)" }}>Spread ({home}, home-favored convention)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`e.g. 3.5 (${home} favored by 3.5)`}
                  value={spreadInput}
                  onChange={(e) => setSpreadInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Total / O-U line</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 44.5"
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>{away} spread odds</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="-110"
                  value={spreadAwayOddsInput}
                  onChange={(e) => setSpreadAwayOddsInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>{home} spread odds</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="-110"
                  value={spreadHomeOddsInput}
                  onChange={(e) => setSpreadHomeOddsInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Over odds</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="-110"
                  value={totalOverOddsInput}
                  onChange={(e) => setTotalOverOddsInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Under odds</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="-110"
                  value={totalUnderOddsInput}
                  onChange={(e) => setTotalUnderOddsInput(e.target.value)}
                  className="rounded-md border px-2 py-1.5 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
            </div>

            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--text-secondary)" }}>Model implies:</strong>{" "}
              {formatSpread(home, away, analysis.predictedMargin)}
              {analysis.predictedTotal !== null && <> · O/U {analysis.predictedTotal.toFixed(1)}</>}. This point
              estimate alone runs ~8 spread points / ~4 total points off the real market number on average
              (sometimes much more) — the cover/over check below doesn&apos;t pretend otherwise: it asks how far
              the LINE sits from the model&apos;s whole spread of likely outcomes (from real historical{" "}
              {analysis.marginResiduals.length >= MIN_RESIDUALS_FOR_EMPIRICAL ? "outcomes, not a bell-curve assumption" : "residuals"}
              ), so it only shows a real edge when the gap is large enough to survive that uncertainty.
            </p>

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
              <label className="ml-auto flex items-center gap-1.5 text-xs">
                <span style={{ color: "var(--text-muted)" }}>Bankroll:</span>
                <input
                  type="number"
                  min={0}
                  placeholder={currency(currentBankroll)}
                  value={bankrollOverrideInput}
                  onChange={(e) => setBankrollOverrideInput(e.target.value)}
                  className="w-24 rounded-md border px-1.5 py-1 tabular-nums"
                  style={{ borderColor: "var(--card-border)", color: "var(--text-primary)", background: "var(--card-bg)" }}
                />
              </label>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Defaults to your real Tracker bankroll ({currency(currentBankroll)}) — type a number
              above to size this pick against a hypothetical bankroll instead. Doesn&apos;t change
              what the Tracker itself shows.
            </p>

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

            {spreadCheck && spreadCheck.classification.status === "no-edge" && (
              <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                Spread: no edge at these odds ({(spreadCheck.pHomeCovers * 100).toFixed(0)}% {home} covers).
              </p>
            )}
            {spreadCheck && spreadCheck.classification.status === "flagged" && (
              <div className="mt-3 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
                <strong>Spread flagged, not a recommendation.</strong> The model and the market disagree by more
                than the trust threshold — see the moneyline explanation above; same logic applies here.
              </div>
            )}
            {spreadCheck && spreadCheck.classification.status === "edge" && (
              <div className="mt-3 rounded-lg border p-4" style={{ borderColor: "var(--status-good)" }}>
                <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: "var(--status-good)" }}>
                  BET {sideSpreadLabel(home, away, parseFloat(spreadInput), spreadCheck.pick.side === "over" ? "home" : "away")}
                </span>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Model prob." value={`${(spreadCheck.pick.summary.p * 100).toFixed(1)}%`} sub={spreadCheck.usedEmpirical ? "empirical" : "Normal (small sample)"} />
                  <StatTile label="Market implied" value={`${(spreadCheck.pick.marketImplied * 100).toFixed(1)}%`} sub="includes vig" />
                  <StatTile label="Expected value" value={`+${(spreadCheck.pick.summary.expectancy * 100).toFixed(1)}%`} accent="good" />
                  <StatTile label="Recommended stake" value={currency(spreadCheck.classification.stake)} />
                </div>
                <Link
                  href={`/tracker?${new URLSearchParams({
                    desc: `${spreadCheck.pick.side === "over" ? home : away} spread (${formatMoneyline(spreadCheck.pick.side === "over" ? parseMoneyline(spreadHomeOddsInput) ?? -110 : parseMoneyline(spreadAwayOddsInput) ?? -110)}) — ${away} @ ${home}`,
                    p: (spreadCheck.pick.summary.p * 100).toFixed(1),
                    b: spreadCheck.pick.b.toFixed(4),
                    stake: spreadCheck.classification.stake.toFixed(0),
                    homeTeam: home,
                    awayTeam: away,
                    betType: "spread",
                    line: spreadInput,
                    side: spreadCheck.pick.side === "over" ? "home" : "away",
                  }).toString()}`}
                  className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: "var(--series-1)" }}
                >
                  Log this bet in the Tracker →
                </Link>
              </div>
            )}

            {totalCheck && totalCheck.classification.status === "no-edge" && (
              <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                Total: no edge at these odds ({(totalCheck.pOver * 100).toFixed(0)}% over).
              </p>
            )}
            {totalCheck && totalCheck.classification.status === "flagged" && (
              <div className="mt-3 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
                <strong>Total flagged, not a recommendation.</strong> The model and the market disagree by more
                than the trust threshold — see the moneyline explanation above; same logic applies here.
              </div>
            )}
            {totalCheck && totalCheck.classification.status === "edge" && (
              <div className="mt-3 rounded-lg border p-4" style={{ borderColor: "var(--status-good)" }}>
                <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: "var(--status-good)" }}>
                  BET {totalCheck.pick.side.toUpperCase()} {totalInput}
                </span>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Model prob." value={`${(totalCheck.pick.summary.p * 100).toFixed(1)}%`} sub={totalCheck.usedEmpirical ? "empirical, walk-forward" : "Normal (small sample)"} />
                  <StatTile label="Market implied" value={`${(totalCheck.pick.marketImplied * 100).toFixed(1)}%`} sub="includes vig" />
                  <StatTile label="Expected value" value={`+${(totalCheck.pick.summary.expectancy * 100).toFixed(1)}%`} accent="good" />
                  <StatTile label="Recommended stake" value={currency(totalCheck.classification.stake)} />
                </div>
                <Link
                  href={`/tracker?${new URLSearchParams({
                    desc: `${totalCheck.pick.side.toUpperCase()} ${totalInput} (${formatMoneyline(totalCheck.pick.side === "over" ? parseMoneyline(totalOverOddsInput) ?? -110 : parseMoneyline(totalUnderOddsInput) ?? -110)}) — ${away} @ ${home}`,
                    p: (totalCheck.pick.summary.p * 100).toFixed(1),
                    b: totalCheck.pick.b.toFixed(4),
                    stake: totalCheck.classification.stake.toFixed(0),
                    homeTeam: home,
                    awayTeam: away,
                    betType: "total",
                    line: totalInput,
                    side: totalCheck.pick.side,
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

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Key players this season
            </h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Who&apos;s actually been on the field, from real box scores — not fed into the
              model (there&apos;s no reliable way to know before kickoff whether this week&apos;s
              usual leader is playing), just context for you to weigh yourself.
            </p>
            {analysis.keyPlayers.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Neither team has played a game yet this season — check back once they have.
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-xs">
                {analysis.keyPlayers.map(({ category, homeStarter, awayStarter }) => (
                  <div key={category} className="rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--card-border)" }}>
                    <div className="mb-1" style={{ color: "var(--text-muted)" }}>
                      {USAGE_CATEGORY_LABELS[category]}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {[
                        { team: away, starter: awayStarter },
                        { team: home, starter: homeStarter },
                      ].map(({ team, starter }) => (
                        <div key={team}>
                          {starter ? (
                            <>
                              <div>
                                <strong style={{ color: "var(--text-primary)" }}>{starter.player}</strong>{" "}
                                <span style={{ color: "var(--text-muted)" }}>({team})</span>
                              </div>
                              <div style={{ color: "var(--text-secondary)" }}>{formatStatLine(category, starter.statLine)}</div>
                              <div style={{ color: "var(--text-muted)" }}>
                                led {starter.gamesLed} of {starter.totalGames} game{starter.totalGames === 1 ? "" : "s"}
                                {!starter.ledMostRecentGame && (
                                  <span style={{ color: "var(--status-critical)" }}> · someone else led most recently</span>
                                )}
                                {category === "passing" &&
                                  (() => {
                                    const qbRank = analysis.qbRankFor(team, starter.player);
                                    return qbRank ? (
                                      <>
                                        {" "}
                                        ·{" "}
                                        <Link href={`/players/${dataset}`} style={{ color: "var(--series-1)" }}>
                                          #{qbRank} of {analysis.qbRankOf} QBs
                                        </Link>
                                      </>
                                    ) : null;
                                  })()}
                              </div>
                            </>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>{team}: no data yet</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {analysis.hasTeamStats && (analysis.homeStatTrend.length > 0 || analysis.awayStatTrend.length > 0) && (
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Team stat trends
              </h2>
              <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Same stats the model trains on — total yards, turnover margin, and (NFL only)
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
                // CFB's archive has no EPA figure (ESPN's box score doesn't publish it), so
                // every point is exactly 0 for a CFB matchup — a flat, uninformative line, not
                // a real trend. Only include this chart when at least one team's game actually
                // has a nonzero value.
                ...(analysis.homeStatTrend.some((p) => p.offEpa !== 0) || analysis.awayStatTrend.some((p) => p.offEpa !== 0)
                  ? [
                      {
                        label: "Offensive EPA",
                        key: "offEpa" as const,
                        baseline: 0,
                        description:
                          "Expected Points Added per play, summed across the game. Unlike total yards, EPA credits a play for how much it actually helped — a 5-yard gain on 3rd-and-3 counts far more than the same 5 yards on 3rd-and-15. Positive (above the dashed line) means the offense added value on average; negative means it lost value relative to what an average play would do in that situation.",
                      },
                    ]
                  : []),
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
