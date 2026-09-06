"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { brierScore } from "@/lib/calibration";
import { Game, runElo } from "@/lib/elo";
import { fetchUpcomingGames, Sport, UpcomingGame } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { computeRankings } from "@/lib/rankings";
import { seasonAverage, teamStatTrend } from "@/lib/research";
import { SCHEDULE_LOOKAHEAD_DAYS, SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";
import { fitMarginModel, formatSpread, predictMargin, predictTotal, seasonScoringAverage } from "@/lib/spreadModel";
import { matchKeyFor, matchTeamName } from "@/lib/teamMatch";
import { computeTeamStatDiffs, loadTeamStats, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "@/lib/teamStats";
import { StatTile } from "./StatTile";

/** How far back to show already-completed games in the flat list — matches This Week's report card window. */
const RECENT_DAYS = 10;

const OTHER_SPORT: Record<Sport, Sport> = { cfb: "nfl", nfl: "cfb" };

function fmtKickoff(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function researchUrl(sport: Sport, home: string, away: string, espnId?: string): string {
  const query = new URLSearchParams({ dataset: sport, home, away });
  if (espnId) query.set("espnId", espnId);
  return `/research?${query.toString()}`;
}

interface Snapshot {
  sport: Sport;
  historicalGames: Game[];
  teamGameStats: TeamGameStat[] | null;
  upcomingGames: UpcomingGame[];
  error: string | null;
}

interface PickRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  pHome: number;
  predictedMargin: number;
  predictedTotal: number | null;
  homeRank: number | null;
  awayRank: number | null;
  espnId?: string;
  status: "graded" | "upcoming";
  homeScore?: number;
  awayScore?: number;
  correct?: boolean;
}

export function PicksPage({ sport }: { sport: Sport }) {
  const [requestId, setRequestId] = useState(0);
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), loadTeamStats(sport), fetchUpcomingGames(sport, SCHEDULE_LOOKAHEAD_DAYS[sport])])
      .then(([historicalGames, teamGameStats, schedule]) => {
        if (!cancelled) setSnapshot({ sport, historicalGames, teamGameStats, upcomingGames: schedule.games, error: null });
      })
      .catch((e) => {
        if (!cancelled) setSnapshot({ sport, historicalGames: [], teamGameStats: null, upcomingGames: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport, requestId]);

  const loading = snapshot === null || snapshot.sport !== sport || (snapshot.historicalGames.length === 0 && snapshot.error === null);

  const analysis = useMemo(() => {
    if (loading || !snapshot || snapshot.error) return null;
    const { historicalGames, teamGameStats, upcomingGames } = snapshot;
    if (historicalGames.length === 0) return null;

    const eloOptions = SPORT_ELO_OPTIONS[sport];
    const { records, finalRatings, ratingHistory } = runElo(historicalGames, eloOptions);
    const statDiffs = teamGameStats ? computeTeamStatDiffs(historicalGames, teamGameStats) : new Map();
    const hasTeamStats = statDiffs.size > 0;
    const featuresFor = (r: (typeof records)[number]) => {
      if (!hasTeamStats) return [r.eloDiff];
      const f = statDiffs.get(r.gameId ?? "") ?? NEUTRAL_TEAM_STAT_FEATURES;
      return [r.eloDiff, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
    };

    // Season-long, no-leakage walk-forward record: trained ONLY on games
    // before this season started, then graded against every game since,
    // using each game's own pregame Elo (already leak-free). Odds-independent
    // on purpose — straight-up right/wrong, not "would this have been a bet."
    const currentSeason = historicalGames[historicalGames.length - 1].season;
    const seasonGames = historicalGames.filter((g) => g.season === currentSeason);
    const seasonStartStr = seasonGames.length > 0 ? seasonGames[0].date : historicalGames[historicalGames.length - 1].date;
    const priorRecords = records.filter((r) => r.date < seasonStartStr);
    const seasonRecords = records.filter((r) => r.date >= seasonStartStr);

    let seasonRecord: { wins: number; losses: number; brier: number; gamesGraded: number } | null = null;
    let gradedByGameId = new Map<string, { pHome: number; correct: boolean }>();
    if (priorRecords.length >= 50 && seasonRecords.length > 0) {
      const seasonModel = trainLogisticRegression(priorRecords.map(featuresFor), priorRecords.map((r) => r.homeWin), {
        iterations: 300,
        learningRate: 0.5,
      });
      const graded = seasonRecords.map((r) => {
        const pHome = predictProba(seasonModel, featuresFor(r));
        return { record: r, pHome, correct: (pHome >= 0.5) === (r.homeWin === 1) };
      });
      const wins = graded.filter((g) => g.correct).length;
      seasonRecord = {
        wins,
        losses: graded.length - wins,
        brier: brierScore(
          graded.map((g) => g.pHome),
          seasonRecords.map((r) => r.homeWin),
        ),
        gamesGraded: graded.length,
      };
      gradedByGameId = new Map(graded.filter((g) => g.record.gameId).map((g) => [g.record.gameId!, { pHome: g.pHome, correct: g.correct }]));
    }

    // Live model — trained on ALL history, for upcoming games (freshest
    // possible prediction, same as This Week/Research).
    const liveModel = trainLogisticRegression(records.map(featuresFor), records.map((r) => r.homeWin), {
      iterations: 300,
      learningRate: 0.5,
    });
    const marginModel = fitMarginModel(records);
    const ranked = computeRankings(sport, historicalGames, teamGameStats, eloOptions);
    const rankOf = (team: string) => {
      const idx = ranked?.rows.findIndex((r) => r.team === team) ?? -1;
      return idx >= 0 ? idx + 1 : null;
    };

    const rows: PickRow[] = [];

    // Recently completed games (within RECENT_DAYS), graded straight-up.
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - RECENT_DAYS);
    const recentCutoffStr = recentCutoff.toISOString().slice(0, 10);
    for (const g of historicalGames) {
      if (g.date < recentCutoffStr || !g.gameId) continue;
      const graded = gradedByGameId.get(g.gameId);
      if (!graded) continue;
      const eloDiff = records.find((r) => r.gameId === g.gameId)?.eloDiff ?? 0;
      rows.push({
        date: g.date,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        pHome: graded.pHome,
        predictedMargin: predictMargin(marginModel, eloDiff),
        predictedTotal: null,
        homeRank: rankOf(g.homeTeam),
        awayRank: rankOf(g.awayTeam),
        status: "graded",
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        correct: graded.correct,
      });
    }

    // Upcoming games, matched against the historical dataset the same way This Week does.
    const knownTeams = new Set<string>();
    for (const g of historicalGames) {
      knownTeams.add(g.homeTeam);
      knownTeams.add(g.awayTeam);
    }
    const currentSzn = historicalGames[historicalGames.length - 1].season;
    const statAvgCache = new Map<string, ReturnType<typeof seasonAverage>>();
    const statAvgFor = (team: string) => {
      if (!statAvgCache.has(team)) {
        statAvgCache.set(team, teamGameStats ? seasonAverage(teamStatTrend(historicalGames, teamGameStats, team), currentSzn) : null);
      }
      return statAvgCache.get(team) ?? null;
    };
    const scoringAvgCache = new Map<string, ReturnType<typeof seasonScoringAverage>>();
    const scoringAvgFor = (team: string) => {
      if (!scoringAvgCache.has(team)) scoringAvgCache.set(team, seasonScoringAverage(ratingHistory.get(team), currentSzn));
      return scoringAvgCache.get(team) ?? null;
    };

    for (const game of upcomingGames) {
      const matchedHome = matchTeamName(matchKeyFor(sport, game, "home"), knownTeams);
      const matchedAway = matchTeamName(matchKeyFor(sport, game, "away"), knownTeams);
      if (!matchedHome || !matchedAway) continue;
      const homeElo = finalRatings.get(matchedHome) ?? eloOptions.initialRating;
      const awayElo = finalRatings.get(matchedAway) ?? eloOptions.initialRating;
      const homeAdv = game.neutralSite ? 0 : eloOptions.homeAdvantage;
      const eloDiff = homeElo + homeAdv - awayElo;
      let features = [eloDiff];
      if (hasTeamStats) {
        const homeAvg = statAvgFor(matchedHome);
        const awayAvg = statAvgFor(matchedAway);
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
      const pHome = predictProba(liveModel, features);
      const homeScoringAvg = scoringAvgFor(matchedHome);
      const awayScoringAvg = scoringAvgFor(matchedAway);
      const predictedTotal = homeScoringAvg && awayScoringAvg ? predictTotal(homeScoringAvg, awayScoringAvg) : null;
      rows.push({
        date: game.date,
        homeTeam: matchedHome,
        awayTeam: matchedAway,
        pHome,
        predictedMargin: predictMargin(marginModel, eloDiff),
        predictedTotal,
        homeRank: rankOf(matchedHome),
        awayRank: rankOf(matchedAway),
        espnId: game.espnId,
        status: "upcoming",
      });
    }

    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return { seasonRecord, rows, hasTeamStats };
  }, [snapshot, loading, sport]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Straight-Up Picks — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          No stake sizing, no bankroll math — just who the model picks to win, the probability,
          and its own rough spread/total estimate, in one flat list. For the full edge-check with
          real odds and recommended bet size, see This Week.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/picks" className="underline" style={{ color: "var(--text-muted)" }}>
          ← All sports
        </Link>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <Link href={`/picks/${OTHER_SPORT[sport]}`} className="underline" style={{ color: "var(--series-1)" }}>
          Switch to {SPORT_LABELS[OTHER_SPORT[sport]]} →
        </Link>
        <button
          onClick={() => setRequestId((n) => n + 1)}
          disabled={loading}
          className="ml-auto rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--card-border)", color: "var(--text-secondary)" }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {SPORT_LABELS[sport]} history and this week&apos;s schedule…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Failed to load data: {snapshot.error}
        </div>
      )}

      {analysis?.seasonRecord && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Season record (straight-up)"
            value={`${analysis.seasonRecord.wins}-${analysis.seasonRecord.losses}`}
            sub={`${analysis.seasonRecord.gamesGraded} games graded`}
          />
          <StatTile
            label="Accuracy"
            value={`${((analysis.seasonRecord.wins / analysis.seasonRecord.gamesGraded) * 100).toFixed(1)}%`}
            accent="good"
          />
          <StatTile label="Brier score" value={analysis.seasonRecord.brier.toFixed(4)} sub="lower is better; 0 = perfect" />
        </div>
      )}
      {analysis && !analysis.seasonRecord && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Not enough games this season yet to grade a season-long record — check back as more get played.
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        The record above is trained ONLY on games before this season started, then graded against
        every game since, using each game&apos;s own pregame Elo — no leakage, and no odds
        required, so it covers every game this season, not just the ones a sportsbook tracked.
        Spread/total below are informational estimates only — typically ~8 and ~4 points off real
        market lines respectively (see the Guide) — not a substitute for an actual line.
      </p>

      <div className="flex gap-1">
        {(
          [
            { key: "upcoming" as const, label: "Upcoming" },
            { key: "history" as const, label: "History" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="rounded-full border px-3 py-1 text-xs transition-colors"
            style={{
              borderColor: tab === t.key ? "var(--series-1)" : "var(--card-border)",
              background: tab === t.key ? "var(--series-1)" : "transparent",
              color: tab === t.key ? "white" : "var(--text-secondary)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {analysis && (
        <div className="flex flex-col gap-2">
          {analysis.rows
            .filter((row) => (tab === "history" ? row.status === "graded" : row.status === "upcoming"))
            .map((row, i) => {
            const favoredHome = row.pHome >= 0.5;
            const favoredTeam = favoredHome ? row.homeTeam : row.awayTeam;
            const favoredP = favoredHome ? row.pHome : 1 - row.pHome;
            return (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-lg border p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                style={{
                  background: "var(--card-bg)",
                  borderColor: row.status === "graded" ? (row.correct ? "var(--status-good)" : "var(--status-critical)") : "var(--card-border)",
                }}
              >
                <div>
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {row.awayTeam}
                    {row.awayRank && <span style={{ color: "var(--text-muted)" }}> (#{row.awayRank})</span>} at {row.homeTeam}
                    {row.homeRank && <span style={{ color: "var(--text-muted)" }}> (#{row.homeRank})</span>}
                  </div>
                  <div style={{ color: "var(--text-muted)" }}>{fmtKickoff(row.date)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>
                    Pick: <strong style={{ color: "var(--text-primary)" }}>{favoredTeam}</strong> ({(favoredP * 100).toFixed(1)}%)
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{formatSpread(row.homeTeam, row.awayTeam, row.predictedMargin)}</span>
                  {row.predictedTotal !== null && <span style={{ color: "var(--text-muted)" }}>O/U {row.predictedTotal.toFixed(1)}</span>}
                  {row.status === "graded" ? (
                    <span
                      className="rounded-full px-2 py-0.5 font-medium text-white"
                      style={{ background: row.correct ? "var(--status-good)" : "var(--status-critical)" }}
                    >
                      {row.awayTeam} {row.awayScore}–{row.homeTeam} {row.homeScore} · {row.correct ? "correct" : "missed"}
                    </span>
                  ) : (
                    <Link
                      href={researchUrl(sport, row.homeTeam, row.awayTeam, row.espnId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--series-1)" }}
                    >
                      Research →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
          {analysis.rows.filter((row) => (tab === "history" ? row.status === "graded" : row.status === "upcoming")).length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {tab === "history"
                ? `Nothing graded in the last ${RECENT_DAYS} days yet.`
                : "Nothing scheduled in the upcoming window right now."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
