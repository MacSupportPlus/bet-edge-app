"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { brierScore } from "@/lib/calibration";
import { EloGameRecord, EloHistoryPoint, Game, runElo } from "@/lib/elo";
import {
  fetchOddsForGames,
  fetchTeamStatsForIds,
  fetchUpcomingGames,
  GameOdds,
  isStaleSeasonStats,
  Sport,
  TeamSeasonStats,
  UpcomingGame,
} from "@/lib/espn";
import { currency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { FRACTIONAL_OPTIONS, formatMoneyline, parseMoneyline } from "@/lib/odds";
import { headToHead, headToHeadRecord, seasonAverage, teamStatTrend } from "@/lib/research";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickSide, PickResult } from "@/lib/scanner";
import { SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";
import { matchTeamName } from "@/lib/teamMatch";
import { computeTeamStatDiffs, loadTeamStats, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "@/lib/teamStats";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Callout } from "./Callout";
import { StatTile } from "./StatTile";

/** How far back "games already played this week" reaches — wide enough to cover a full game week for either sport. */
const RETRO_LOOKBACK_DAYS = 10;

/** How far ahead to look for upcoming games. NFL weeks run Thu-Mon (needs a wider window); CFB's are tighter. */
const SCHEDULE_LOOKAHEAD_DAYS: Record<Sport, number> = { cfb: 8, nfl: 13 };

interface Snapshot {
  requestId: number;
  sport: Sport;
  historicalGames: Game[];
  teamGameStats: TeamGameStat[] | null;
  upcomingGames: UpcomingGame[];
  currentWeek: number | null;
  oddsByEspnId: Map<string, GameOdds | null>;
  teamStatsByTeamId: Map<string, TeamSeasonStats | null>;
  retroOddsByGameId: Map<string, GameOdds | null>;
  error: string | null;
}

type Row =
  | { game: UpcomingGame; status: "edge"; pick: PickResult; stake: number; provider: string; matchedHome: string; matchedAway: string }
  | { game: UpcomingGame; status: "flagged"; pick: PickResult; provider: string; matchedHome: string; matchedAway: string }
  | { game: UpcomingGame; status: "no-edge"; pHome: number; provider: string; matchedHome: string; matchedAway: string }
  | { game: UpcomingGame; status: "no-odds"; pHome: number; matchedHome: string; matchedAway: string }
  | { game: UpcomingGame; status: "unmatched" };

type RetroRow =
  | { record: EloGameRecord; pHome: number; actualHomeWin: boolean; status: "edge"; pick: PickResult; stake: number; won: boolean; profit: number }
  | { record: EloGameRecord; pHome: number; actualHomeWin: boolean; status: "flagged"; pick: PickResult }
  | { record: EloGameRecord; pHome: number; actualHomeWin: boolean; status: "no-edge" }
  | { record: EloGameRecord; pHome: number; actualHomeWin: boolean; status: "no-odds" };

function formatKickoff(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Builds a link to the Game Research page for two historical-dataset team names. */
function researchUrl(sport: Sport, home: string, away: string, espnId?: string): string {
  const query = new URLSearchParams({ dataset: sport, home, away });
  if (espnId) query.set("espnId", espnId);
  return `/research?${query.toString()}`;
}

/** "W-L-W-W-L" style summary of a team's last few results, most recent last. */
function recentFormString(ratingHistory: Map<string, EloHistoryPoint[]>, team: string, n = 5): string {
  const history = ratingHistory.get(team);
  if (!history || history.length === 0) return "no games yet";
  return history
    .slice(-n)
    .map((g) => g.result)
    .join("-");
}

/** Compact "33.4 ppg · 422.6 ypg · +4 TO" summary, or null if there was nothing usable for this team. */
function formatTeamStatsLine(stats: TeamSeasonStats | null | undefined): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  if (stats.pointsPerGame !== null) parts.push(`${stats.pointsPerGame.toFixed(1)} ppg`);
  if (stats.yardsPerGame !== null) parts.push(`${stats.yardsPerGame.toFixed(0)} ypg`);
  if (stats.turnoverMargin !== null) parts.push(`${stats.turnoverMargin >= 0 ? "+" : ""}${stats.turnoverMargin.toFixed(0)} TO`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The ESPN name to match against the historical dataset: NFL matches on abbreviation (e.g. "SEA"), CFB on the full school name. */
function matchKeyFor(sport: Sport, game: UpcomingGame, side: "home" | "away"): string {
  if (sport === "nfl") {
    return side === "home" ? (game.homeTeamAbbr ?? game.homeTeam) : (game.awayTeamAbbr ?? game.awayTeam);
  }
  return side === "home" ? game.homeTeam : game.awayTeam;
}

const OTHER_SPORT: Record<Sport, Sport> = { cfb: "nfl", nfl: "cfb" };

/**
 * Every posted price here comes from one sportsbook via ESPN — if you're
 * actually betting somewhere else, the number in front of you can be
 * different enough to flip the verdict. This re-runs the exact same
 * pick/classify pipeline against whatever price you type in, so "the model
 * likes this" can be checked against the book you're actually using, not
 * just the one ESPN happened to track.
 */
function OddsRecheck({
  pHome,
  homeTeam,
  awayTeam,
  defaultHomeMl,
  defaultAwayMl,
  currentBankroll,
  fractionalMultiplier,
}: {
  pHome: number;
  homeTeam: string;
  awayTeam: string;
  defaultHomeMl: number | null;
  defaultAwayMl: number | null;
  currentBankroll: number;
  fractionalMultiplier: number;
}) {
  const [homeInput, setHomeInput] = useState(defaultHomeMl !== null ? String(defaultHomeMl) : "");
  const [awayInput, setAwayInput] = useState(defaultAwayMl !== null ? String(defaultAwayMl) : "");

  const homeMl = parseMoneyline(homeInput);
  const awayMl = parseMoneyline(awayInput);
  const result =
    homeMl !== null && awayMl !== null
      ? classifyPick(pickSide(pHome, homeMl, awayMl, homeTeam, awayTeam), currentBankroll, fractionalMultiplier)
      : null;

  return (
    <details className="mt-2 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: "var(--card-border)" }}>
      <summary className="cursor-pointer" style={{ color: "var(--text-muted)" }}>
        Betting at a different book? Check your own price
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <span style={{ color: "var(--text-muted)" }}>{awayTeam}</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. +130"
            value={awayInput}
            onChange={(e) => setAwayInput(e.target.value)}
            className="w-16 rounded border px-1.5 py-0.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
        <label className="flex items-center gap-1">
          <span style={{ color: "var(--text-muted)" }}>{homeTeam}</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. -150"
            value={homeInput}
            onChange={(e) => setHomeInput(e.target.value)}
            className="w-16 rounded border px-1.5 py-0.5 tabular-nums"
            style={{ borderColor: "var(--card-border)", color: "var(--text-primary)" }}
          />
        </label>
      </div>
      {result && (
        <p
          className="mt-1.5"
          style={{
            color:
              result.status === "edge"
                ? "var(--status-good)"
                : result.status === "flagged"
                  ? "var(--status-critical)"
                  : "var(--text-muted)",
          }}
        >
          {result.status === "edge" &&
            `Still a bet at this price: ${result.pick.team} ${formatMoneyline(result.pick.moneyline)}, stake ${currency(result.stake)}.`}
          {result.status === "flagged" && `Flagged at this price too — model disagrees with the market by too much to trust.`}
          {result.status === "no-edge" && `No edge at this price.`}
        </p>
      )}
    </details>
  );
}

export function WeeklyEdges({ sport }: { sport: Sport }) {
  const [requestId, setRequestId] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const [startingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState("weekly-edges:fractional", 0.5);

  const currentBankroll = useMemo(
    () => summarizeBankroll(startingBankroll, bets).currentBankroll,
    [startingBankroll, bets],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [historicalGames, teamGameStats, schedule] = await Promise.all([
          loadGames(sport),
          loadTeamStats(sport),
          fetchUpcomingGames(sport, SCHEDULE_LOOKAHEAD_DAYS[sport]),
        ]);
        const { games: upcomingGames, currentWeek } = schedule;

        const retroCutoff = new Date();
        retroCutoff.setDate(retroCutoff.getDate() - RETRO_LOOKBACK_DAYS);
        const retroCutoffStr = retroCutoff.toISOString().slice(0, 10);
        const retroGameIds = historicalGames
          .filter((g) => g.gameId && g.date >= retroCutoffStr)
          .map((g) => g.gameId!);

        const teamIds =
          sport === "cfb"
            ? upcomingGames.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((id): id is string => id !== null)
            : [];
        const [oddsByEspnId, teamStatsByTeamId, retroOddsByGameId] = await Promise.all([
          fetchOddsForGames(sport, upcomingGames.map((g) => g.espnId)),
          sport === "cfb" ? fetchTeamStatsForIds(sport, teamIds) : Promise.resolve(new Map()),
          fetchOddsForGames(sport, retroGameIds),
        ]);
        if (!cancelled) {
          setSnapshot({
            requestId,
            sport,
            historicalGames,
            teamGameStats,
            upcomingGames,
            currentWeek,
            oddsByEspnId,
            teamStatsByTeamId,
            retroOddsByGameId,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setSnapshot({
            requestId,
            sport,
            historicalGames: [],
            teamGameStats: null,
            upcomingGames: [],
            currentWeek: null,
            oddsByEspnId: new Map(),
            teamStatsByTeamId: new Map(),
            retroOddsByGameId: new Map(),
            error: String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, sport]);

  const loading = snapshot === null || snapshot.requestId !== requestId || snapshot.sport !== sport;

  const analysis = useMemo(() => {
    if (loading || !snapshot || snapshot.error) return null;
    const { historicalGames, teamGameStats, upcomingGames, oddsByEspnId } = snapshot;
    if (historicalGames.length === 0) return null;

    const knownTeams = new Set<string>();
    for (const g of historicalGames) {
      knownTeams.add(g.homeTeam);
      knownTeams.add(g.awayTeam);
    }

    const eloOptions = SPORT_ELO_OPTIONS[sport];
    const { records, finalRatings, ratingHistory } = runElo(historicalGames, eloOptions);

    // Both sports train Elo + real team-stat features (yards, turnover margin) when
    // an archive is available; NFL also gets offensive EPA (ESPN's CFB box scores
    // don't publish it, so that feature stays 0 for CFB) — see teamStats.ts.
    const statDiffs = teamGameStats ? computeTeamStatDiffs(historicalGames, teamGameStats) : new Map();
    const hasTeamStats = statDiffs.size > 0;
    const statFeaturesFor = (r: { gameId?: string }) => (r.gameId && statDiffs.get(r.gameId)) || NEUTRAL_TEAM_STAT_FEATURES;
    const featuresFor = (r: (typeof records)[number]) => {
      if (!hasTeamStats) return [r.eloDiff];
      const f = statFeaturesFor(r);
      return [r.eloDiff, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
    };

    const model = trainLogisticRegression(
      records.map(featuresFor),
      records.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    // Each team's current-season-to-date stat average, computed once per team
    // and cached — used both as a live prediction feature and for the "season
    // so far" display line, so what's shown matches what the model actually saw.
    const currentSeason = historicalGames[historicalGames.length - 1].season;
    const seasonAvgCache = new Map<string, ReturnType<typeof seasonAverage>>();
    const seasonAvgFor = (team: string) => {
      if (!seasonAvgCache.has(team)) {
        seasonAvgCache.set(team, teamGameStats ? seasonAverage(teamStatTrend(historicalGames, teamGameStats, team), currentSeason) : null);
      }
      return seasonAvgCache.get(team) ?? null;
    };
    const teamStatsDisplayFor = (team: string): TeamSeasonStats | null => {
      const history = ratingHistory.get(team)?.filter((g) => g.season === currentSeason);
      if (!history || history.length === 0) return null;
      const avg = seasonAvgFor(team);
      return {
        pointsPerGame: history.reduce((s, g) => s + g.pointsFor, 0) / history.length,
        yardsPerGame: avg?.totalYards ?? null,
        turnoverMargin: avg?.turnoverMargin ?? null,
        gamesPlayed: history.length,
      };
    };

    const rows: Row[] = upcomingGames.map((game) => {
      const matchedHome = matchTeamName(matchKeyFor(sport, game, "home"), knownTeams);
      const matchedAway = matchTeamName(matchKeyFor(sport, game, "away"), knownTeams);
      if (!matchedHome || !matchedAway) {
        return { game, status: "unmatched" };
      }

      const homeElo = finalRatings.get(matchedHome) ?? eloOptions.initialRating;
      const awayElo = finalRatings.get(matchedAway) ?? eloOptions.initialRating;
      const homeAdv = game.neutralSite ? 0 : eloOptions.homeAdvantage;
      const eloDiff = homeElo + homeAdv - awayElo;
      let features = [eloDiff];
      if (hasTeamStats) {
        const homeAvg = seasonAvgFor(matchedHome);
        const awayAvg = seasonAvgFor(matchedAway);
        const f =
          homeAvg && awayAvg
            ? {
                totalYardsDiff: homeAvg.totalYards - awayAvg.totalYards,
                turnoverMarginDiff: homeAvg.turnoverMargin - awayAvg.turnoverMargin,
                offEpaDiff: homeAvg.offEpa - awayAvg.offEpa,
              }
            : NEUTRAL_TEAM_STAT_FEATURES;
        features = [eloDiff, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
      }
      const pHome = predictProba(model, features);

      const odds = oddsByEspnId.get(game.espnId);
      if (!odds || odds.homeMoneyline === null || odds.awayMoneyline === null) {
        return { game, status: "no-odds", pHome, matchedHome, matchedAway };
      }

      const pick = pickSide(pHome, odds.homeMoneyline, odds.awayMoneyline, matchedHome, matchedAway);
      const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);

      if (classification.status === "no-edge")
        return { game, status: "no-edge", pHome, provider: odds.provider, matchedHome, matchedAway };
      if (classification.status === "flagged")
        return { game, status: "flagged", pick, provider: odds.provider, matchedHome, matchedAway };
      return { game, status: "edge", pick, stake: classification.stake, provider: odds.provider, matchedHome, matchedAway };
    });

    const edgeRows = rows.filter((r): r is Extract<Row, { status: "edge" }> => r.status === "edge");
    edgeRows.sort((a, b) => b.pick.summary.expectancy - a.pick.summary.expectancy);
    const flaggedRows = rows.filter((r): r is Extract<Row, { status: "flagged" }> => r.status === "flagged");
    const noEdgeRows = rows.filter((r): r is Extract<Row, { status: "no-edge" }> => r.status === "no-edge");
    const unavailableRows = rows.filter((r) => r.status === "no-odds" || r.status === "unmatched");

    return {
      edgeRows,
      flaggedRows,
      noEdgeRows,
      unavailableRows,
      gameCount: upcomingGames.length,
      ratingHistory,
      historicalGames,
      hasTeamStats,
      teamStatsDisplayFor,
    };
  }, [snapshot, loading, sport, currentBankroll, fractionalMultiplier]);

  // "How would we have done?" — replays games already played in the last
  // RETRO_LOOKBACK_DAYS days as if predicting them beforehand. The model is
  // trained ONLY on games before that window (no leakage from the very
  // outcomes being graded); Elo's pregame ratings are inherently leak-free
  // already, since runElo only ever reads each team's rating as it stood
  // immediately before that specific game.
  const reportCard = useMemo(() => {
    if (loading || !snapshot || snapshot.error) return null;
    const { historicalGames, teamGameStats, retroOddsByGameId } = snapshot;
    if (historicalGames.length === 0) return null;

    const retroCutoff = new Date();
    retroCutoff.setDate(retroCutoff.getDate() - RETRO_LOOKBACK_DAYS);
    const retroCutoffStr = retroCutoff.toISOString().slice(0, 10);

    const eloOptions = SPORT_ELO_OPTIONS[sport];
    const { records } = runElo(historicalGames, eloOptions);
    const statDiffs = teamGameStats ? computeTeamStatDiffs(historicalGames, teamGameStats) : new Map();
    const hasTeamStats = statDiffs.size > 0;
    const statFeaturesFor = (r: { gameId?: string }) => (r.gameId && statDiffs.get(r.gameId)) || NEUTRAL_TEAM_STAT_FEATURES;
    const featuresFor = (r: (typeof records)[number]) => {
      if (!hasTeamStats) return [r.eloDiff];
      const f = statFeaturesFor(r);
      return [r.eloDiff, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
    };

    const priorRecords = records.filter((r) => r.date < retroCutoffStr);
    const retroRecords = records.filter((r) => r.gameId && r.date >= retroCutoffStr);
    if (priorRecords.length < 50 || retroRecords.length === 0) return null;

    const model = trainLogisticRegression(
      priorRecords.map(featuresFor),
      priorRecords.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const rows: RetroRow[] = retroRecords.map((record) => {
      const pHome = predictProba(model, featuresFor(record));
      const actualHomeWin = record.homeWin === 1;
      const odds = record.gameId ? (retroOddsByGameId.get(record.gameId) ?? null) : null;
      if (!odds || odds.homeMoneyline === null || odds.awayMoneyline === null) {
        return { record, pHome, actualHomeWin, status: "no-odds" };
      }
      const pick = pickSide(pHome, odds.homeMoneyline, odds.awayMoneyline, record.homeTeam, record.awayTeam);
      const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);
      if (classification.status === "no-edge") return { record, pHome, actualHomeWin, status: "no-edge" };
      if (classification.status === "flagged") return { record, pHome, actualHomeWin, status: "flagged", pick };
      const won = pick.side === "home" ? actualHomeWin : !actualHomeWin;
      const profit = won ? classification.stake * pick.b : -classification.stake;
      return { record, pHome, actualHomeWin, status: "edge", pick, stake: classification.stake, won, profit };
    });

    const graded = rows.filter((r): r is Extract<RetroRow, { status: "edge" }> => r.status === "edge");
    const wins = graded.filter((r) => r.won).length;
    const totalProfit = graded.reduce((s, r) => s + r.profit, 0);
    const totalStaked = graded.reduce((s, r) => s + r.stake, 0);

    // Overall calibration across EVERY completed game this window, not just
    // recommended ones — the honest self-check ("if it says 65%, did that
    // side really win about 65% of the time?") independent of betting at all.
    const allPredictions = rows.map((r) => r.pHome);
    const allOutcomes = rows.map((r) => (r.actualHomeWin ? 1 : 0));
    const brier = brierScore(allPredictions, allOutcomes);
    const accuratePicks = rows.filter((r) => (r.pHome >= 0.5) === r.actualHomeWin).length;

    rows.sort((a, b) => new Date(b.record.date).getTime() - new Date(a.record.date).getTime());

    return {
      rows,
      gameCount: rows.length,
      edgeCount: graded.length,
      wins,
      losses: graded.length - wins,
      totalProfit,
      totalStaked,
      brier,
      accuracy: rows.length > 0 ? accuratePicks / rows.length : 0,
      windowStart: retroCutoffStr,
    };
  }, [snapshot, loading, sport, currentBankroll, fractionalMultiplier]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          This Week&apos;s Edges — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pulls this week&apos;s upcoming games and live odds automatically, runs them through the
          same Elo{analysis?.hasTeamStats ? " + team-stat" : ""} probability model from the Model
          tab, and shows only the ones with a positive-EV edge — sized at your current bankroll.
          Nothing here is entered by hand.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/this-week" className="underline" style={{ color: "var(--text-muted)" }}>
          ← All sports
        </Link>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <Link href={`/this-week/${OTHER_SPORT[sport]}`} className="underline" style={{ color: "var(--series-1)" }}>
          Switch to {SPORT_LABELS[OTHER_SPORT[sport]]} →
        </Link>
      </div>

      <Callout kind="warning">
        A simple model that disagrees wildly with a real sportsbook&apos;s price is far more
        likely to be wrong than to have found free money — especially on lopsided &quot;buy
        game&quot; matchups. Picks where the model differs from the market by more than{" "}
        {(MAX_TRUSTED_DISAGREEMENT * 100).toFixed(0)} points, <em>or</em> where it thinks a team
        is more than {MAX_TRUSTED_RATIO}× as likely to win as the market does (a near-certain
        market price still has real information the model can miss), are never shown as a bet
        recommendation — they land in the flagged list below instead, as a limitation to
        understand, not an opportunity to act on.
      </Callout>

      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border p-4"
        style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
      >
        <StatTile label="Bankroll (from tracker)" value={currency(currentBankroll)} />
        <div className="flex items-center gap-1">
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
        <button
          onClick={() => setRequestId((n) => n + 1)}
          disabled={loading}
          className="ml-auto rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--card-border)", color: "var(--text-secondary)" }}
        >
          {loading ? "Loading…" : "Refresh odds"}
        </button>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Fetching this week&apos;s schedule and odds from ESPN — this can take a few seconds
          since odds are checked one game at a time.
        </p>
      )}

      {snapshot?.error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
        >
          Couldn&apos;t load this week&apos;s data: {snapshot.error}. ESPN&apos;s API is
          unofficial and can change or go down without notice — try refreshing in a bit.
        </div>
      )}

      {analysis && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {analysis.edgeRows.length > 0
                ? `${analysis.edgeRows.length} edge${analysis.edgeRows.length === 1 ? "" : "s"} found`
                : "No trustworthy edges found this week"}
            </h2>
            {analysis.edgeRows.length === 0 && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Out of {analysis.gameCount} games checked, none show a positive-EV edge within a
                trusted range of the posted odds right now. That&apos;s normal — most weeks,
                most games are priced efficiently. Check back as lines move closer to kickoff.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-3">
              {analysis.edgeRows.map((row) => {
                const query = new URLSearchParams({
                  desc: `${row.pick.team} ML (${formatMoneyline(row.pick.moneyline)}) — ${row.game.awayTeam} @ ${row.game.homeTeam}`,
                  p: (row.pick.summary.p * 100).toFixed(1),
                  b: row.pick.b.toFixed(4),
                  stake: row.stake.toFixed(0),
                }).toString();
                const homeStats =
                  sport === "nfl" ? analysis.teamStatsDisplayFor(row.matchedHome) : snapshot?.teamStatsByTeamId.get(row.game.homeTeamId ?? "");
                const awayStats =
                  sport === "nfl" ? analysis.teamStatsDisplayFor(row.matchedAway) : snapshot?.teamStatsByTeamId.get(row.game.awayTeamId ?? "");
                const homeStatsLine = formatTeamStatsLine(homeStats);
                const awayStatsLine = formatTeamStatsLine(awayStats);
                const statsAreStale =
                  sport === "cfb" &&
                  (isStaleSeasonStats(homeStats ?? null, snapshot?.currentWeek ?? null) ||
                    isStaleSeasonStats(awayStats ?? null, snapshot?.currentWeek ?? null));
                const h2h = analysis.historicalGames.length > 0 ? headToHead(analysis.historicalGames, row.matchedHome, row.matchedAway) : [];
                const h2hRecord = headToHeadRecord(h2h, row.matchedHome);
                return (
                  <div
                    key={row.game.espnId}
                    className="rounded-lg border p-4"
                    style={{ background: "var(--card-bg)", borderColor: "var(--status-good)" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {row.game.awayTeam} at {row.game.homeTeam}
                        </div>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {formatKickoff(row.game.date)} · odds via {row.provider}
                        </div>
                        {(homeStatsLine || awayStatsLine) && (
                          <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                            <strong style={{ color: "var(--text-secondary)" }}>
                              {statsAreStale ? "Last season (final):" : "Season so far:"}
                            </strong>{" "}
                            {row.game.awayTeam} {awayStatsLine ?? "no stats yet"} · {row.game.homeTeam}{" "}
                            {homeStatsLine ?? "no stats yet"}
                            {statsAreStale && " — too early in the new season for ESPN to have current stats"}
                          </div>
                        )}
                      </div>
                      <span
                        className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                        style={{ background: "var(--status-good)" }}
                      >
                        BET {row.pick.team} {formatMoneyline(row.pick.moneyline)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <StatTile label="Model prob." value={`${(row.pick.summary.p * 100).toFixed(1)}%`} />
                      <StatTile label="Market implied" value={`${(row.pick.marketImplied * 100).toFixed(1)}%`} sub="includes vig" />
                      <StatTile label="Expected value" value={`+${(row.pick.summary.expectancy * 100).toFixed(1)}%`} accent="good" />
                      <StatTile label="Recommended stake" value={currency(row.stake)} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/tracker?${query}`}
                        className="inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
                        style={{ background: "var(--series-1)" }}
                      >
                        Log this bet in the Tracker →
                      </Link>
                      <Link
                        href={researchUrl(sport, row.matchedHome, row.matchedAway, row.game.espnId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block rounded-md border px-3 py-1.5 text-xs font-medium"
                        style={{ borderColor: "var(--card-border)", color: "var(--text-secondary)" }}
                      >
                        Research this game →
                      </Link>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs" style={{ color: "var(--text-muted)" }}>
                        Quick look: recent form &amp; head-to-head
                      </summary>
                      <div className="mt-1.5 flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                        <div>
                          {row.matchedAway} last 5: {recentFormString(analysis.ratingHistory, row.matchedAway)}
                        </div>
                        <div>
                          {row.matchedHome} last 5: {recentFormString(analysis.ratingHistory, row.matchedHome)}
                        </div>
                        <div>
                          {h2h.length > 0
                            ? `Head-to-head: ${row.matchedHome} is ${h2hRecord.wins}-${h2hRecord.losses}${h2hRecord.ties > 0 ? `-${h2hRecord.ties}` : ""} all-time vs. ${row.matchedAway} (${h2h.length} meeting${h2h.length === 1 ? "" : "s"})`
                            : "Head-to-head: no prior meetings in the dataset"}
                        </div>
                      </div>
                    </details>
                    <OddsRecheck
                      pHome={row.pick.side === "home" ? row.pick.summary.p : 1 - row.pick.summary.p}
                      homeTeam={row.matchedHome}
                      awayTeam={row.matchedAway}
                      defaultHomeMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.homeMoneyline ?? null}
                      defaultAwayMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.awayMoneyline ?? null}
                      currentBankroll={currentBankroll}
                      fractionalMultiplier={fractionalMultiplier}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {analysis.flaggedRows.length > 0 && (
            <details className="rounded-lg border p-3" style={{ borderColor: "var(--status-critical)" }}>
              <summary className="cursor-pointer text-sm" style={{ color: "var(--status-critical)" }}>
                {analysis.flaggedRows.length} game{analysis.flaggedRows.length === 1 ? "" : "s"} flagged — model
                disagrees too much with the market to trust
              </summary>
              <div className="mt-2 flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {analysis.flaggedRows.map((row) => (
                  <div key={row.game.espnId} className="flex flex-col gap-1 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--card-border)" }}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span>
                        {row.game.awayTeam} at {row.game.homeTeam} — model says {row.pick.team}{" "}
                        {(row.pick.summary.p * 100).toFixed(0)}%, market implies only{" "}
                        {(row.pick.marketImplied * 100).toFixed(0)}% ({formatMoneyline(row.pick.moneyline)}). Not shown
                        as a bet — this gap almost certainly means the model is missing something.
                      </span>
                      <Link
                        href={researchUrl(sport, row.matchedHome, row.matchedAway, row.game.espnId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--series-1)" }}
                      >
                        Research →
                      </Link>
                    </div>
                    <OddsRecheck
                      pHome={row.pick.side === "home" ? row.pick.summary.p : 1 - row.pick.summary.p}
                      homeTeam={row.matchedHome}
                      awayTeam={row.matchedAway}
                      defaultHomeMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.homeMoneyline ?? null}
                      defaultAwayMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.awayMoneyline ?? null}
                      currentBankroll={currentBankroll}
                      fractionalMultiplier={fractionalMultiplier}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}

          {analysis.noEdgeRows.length > 0 && (
            <details className="rounded-lg border p-3" style={{ borderColor: "var(--card-border)" }}>
              <summary className="cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
                {analysis.noEdgeRows.length} game{analysis.noEdgeRows.length === 1 ? "" : "s"} checked, no edge
              </summary>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                &quot;No edge&quot; only means <em>this model, priced against this market</em>, doesn&apos;t see
                one — it&apos;s not a claim that nothing is worth a closer look. These are exactly the games
                worth your own research if you have an angle the model doesn&apos;t.
              </p>
              <div className="mt-2 flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {analysis.noEdgeRows.map((row) => (
                  <div key={row.game.espnId} className="flex flex-col gap-1 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--card-border)" }}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span>
                        {row.game.awayTeam} at {row.game.homeTeam} — model {(row.pHome * 100).toFixed(0)}% home, priced
                        efficiently at {row.provider}
                      </span>
                      <Link
                        href={researchUrl(sport, row.matchedHome, row.matchedAway, row.game.espnId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--series-1)" }}
                      >
                        Research →
                      </Link>
                    </div>
                    <OddsRecheck
                      pHome={row.pHome}
                      homeTeam={row.matchedHome}
                      awayTeam={row.matchedAway}
                      defaultHomeMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.homeMoneyline ?? null}
                      defaultAwayMl={snapshot?.oddsByEspnId.get(row.game.espnId)?.awayMoneyline ?? null}
                      currentBankroll={currentBankroll}
                      fractionalMultiplier={fractionalMultiplier}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}

          {analysis.unavailableRows.length > 0 && (
            <details className="rounded-lg border p-3" style={{ borderColor: "var(--card-border)" }}>
              <summary className="cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
                {analysis.unavailableRows.length} game{analysis.unavailableRows.length === 1 ? "" : "s"} skipped
                (no odds yet or unrecognized team)
              </summary>
              <div className="mt-2 flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {analysis.unavailableRows.map((row) => (
                  <div key={row.game.espnId} className="flex flex-col gap-1 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--card-border)" }}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span>
                        {row.game.awayTeam} at {row.game.homeTeam} —{" "}
                        {row.status === "unmatched" ? "team not found in historical data" : "odds not posted yet"}
                      </span>
                      {row.status === "no-odds" && (
                        <Link
                          href={researchUrl(sport, row.matchedHome, row.matchedAway, row.game.espnId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--series-1)" }}
                        >
                          Research →
                        </Link>
                      )}
                    </div>
                    {row.status === "no-odds" && (
                      <OddsRecheck
                        pHome={row.pHome}
                        homeTeam={row.matchedHome}
                        awayTeam={row.matchedAway}
                        defaultHomeMl={null}
                        defaultAwayMl={null}
                        currentBankroll={currentBankroll}
                        fractionalMultiplier={fractionalMultiplier}
                      />
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {reportCard && (
        <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            How would we have done? — last {RETRO_LOOKBACK_DAYS} days
          </h2>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Replays the {reportCard.gameCount} completed game{reportCard.gameCount === 1 ? "" : "s"} since{" "}
            {reportCard.windowStart} exactly like a real bet would have gone: the model here was trained ONLY on
            games before that date (it never saw these outcomes), then scored against the closing odds and the
            actual final score. This is the honest test — not a promise the next window looks the same.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Model accuracy" value={`${(reportCard.accuracy * 100).toFixed(0)}%`} sub={`${reportCard.gameCount} games, picking the side it favored`} />
            <StatTile label="Brier score" value={reportCard.brier.toFixed(4)} sub="lower is better; 0 = perfect" />
            <StatTile
              label="Recommended-edge record"
              value={reportCard.edgeCount > 0 ? `${reportCard.wins}-${reportCard.losses}` : "no edges found"}
              sub={`${reportCard.edgeCount} game${reportCard.edgeCount === 1 ? "" : "s"} would've been flagged as a bet`}
            />
            <StatTile
              label="Would-be P&L"
              value={reportCard.edgeCount > 0 ? currency(reportCard.totalProfit) : "$0"}
              sub={reportCard.edgeCount > 0 ? `on ${currency(reportCard.totalStaked)} staked` : "nothing recommended"}
              accent={reportCard.edgeCount > 0 ? (reportCard.totalProfit >= 0 ? "good" : "critical") : undefined}
            />
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs" style={{ color: "var(--text-secondary)" }}>
              Game-by-game breakdown
            </summary>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              {reportCard.rows.map((row) => {
                const predictedHome = row.pHome >= 0.5;
                const correct = predictedHome === row.actualHomeWin;
                return (
                  <div
                    key={row.record.gameId ?? `${row.record.homeTeam}-${row.record.date}`}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-2 py-1.5"
                    style={{ borderColor: "var(--card-border)" }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>
                      {row.record.awayTeam} at {row.record.homeTeam} — model{" "}
                      {(predictedHome ? row.pHome : 1 - row.pHome) * 100 | 0}%{" "}
                      {predictedHome ? row.record.homeTeam : row.record.awayTeam}, actual winner:{" "}
                      {row.actualHomeWin ? row.record.homeTeam : row.record.awayTeam}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 font-medium"
                      style={{
                        color: "white",
                        background: correct ? "var(--status-good)" : "var(--status-critical)",
                      }}
                    >
                      {correct ? "called it" : "missed"}
                    </span>
                    {row.status === "edge" && (
                      <span style={{ color: row.won ? "var(--status-good)" : "var(--status-critical)" }}>
                        would&apos;ve bet {row.pick.team} {formatMoneyline(row.pick.moneyline)} for{" "}
                        {currency(row.stake)} — {row.won ? `won ${currency(row.profit)}` : `lost ${currency(-row.profit)}`}
                      </span>
                    )}
                    {row.status === "flagged" && <span style={{ color: "var(--text-muted)" }}>flagged, not bet</span>}
                    {row.status === "no-odds" && <span style={{ color: "var(--text-muted)" }}>no odds available</span>}
                    <Link
                      href={researchUrl(sport, row.record.homeTeam, row.record.awayTeam, row.record.gameId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--series-1)" }}
                    >
                      Research →
                    </Link>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        This reuses the same simplified probability model from the Model tab — no injuries,
        weather, or roster changes factored in. Odds come from one sportsbook via ESPN&apos;s
        public (unofficial) API, which can change or go down without notice. Treat every row here
        as a starting point to sanity-check, not a guarantee.{" "}
        {sport === "cfb"
          ? `The "Season so far" line under each matchup is informational context pulled live from ESPN — it can differ slightly from what the model saw, which trains on our own box-score archive (FBS games, backfilled from ESPN) rather than this live feed.`
          : `The "Season so far" line under each matchup is computed from the same archive the model trains on, so it always matches what actually drove the prediction.`}
      </p>
    </div>
  );
}
