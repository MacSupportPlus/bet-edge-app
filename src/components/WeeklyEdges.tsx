"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { brierScore } from "@/lib/calibration";
import { DEFAULT_ELO_OPTIONS, EloGameRecord, EloHistoryPoint, Game, runElo } from "@/lib/elo";
import {
  fetchOddsForGames,
  fetchTeamStatsForIds,
  fetchUpcomingCfbGames,
  GameOdds,
  isStaleSeasonStats,
  TeamSeasonStats,
  UpcomingGame,
} from "@/lib/espn";
import { currency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { headToHead, headToHeadRecord } from "@/lib/research";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickSide, PickResult } from "@/lib/scanner";
import { matchTeamName } from "@/lib/teamMatch";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Callout } from "./Callout";
import { StatTile } from "./StatTile";

/** How far back "games already played this week" reaches — wide enough to cover one full CFB game week (Thu-Sat plus stragglers). */
const RETRO_LOOKBACK_DAYS = 10;

const FRACTIONAL_OPTIONS = [
  { label: "Full Kelly", value: 1 },
  { label: "½ Kelly", value: 0.5 },
  { label: "¼ Kelly", value: 0.25 },
];

interface Snapshot {
  requestId: number;
  historicalGames: Game[];
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

function formatMoneyline(ml: number): string {
  return ml > 0 ? `+${ml}` : `${ml}`;
}

/** Builds a link to the Game Research page for two historical-dataset team names. */
function researchUrl(dataset: "cfb" | "nfl", home: string, away: string, espnId?: string): string {
  const query = new URLSearchParams({ dataset, home, away });
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

/** Compact "33.4 ppg · 422.6 ypg · +4 TO" summary, or null if ESPN had nothing usable for this team. */
function formatTeamStatsLine(stats: TeamSeasonStats | null | undefined): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  if (stats.pointsPerGame !== null) parts.push(`${stats.pointsPerGame.toFixed(1)} ppg`);
  if (stats.yardsPerGame !== null) parts.push(`${stats.yardsPerGame.toFixed(0)} ypg`);
  if (stats.turnoverMargin !== null) parts.push(`${stats.turnoverMargin >= 0 ? "+" : ""}${stats.turnoverMargin.toFixed(0)} TO`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function WeeklyEdges() {
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
        const [historicalGames, schedule] = await Promise.all([loadGames("cfb"), fetchUpcomingCfbGames(8)]);
        const { games: upcomingGames, currentWeek } = schedule;

        const retroCutoff = new Date();
        retroCutoff.setDate(retroCutoff.getDate() - RETRO_LOOKBACK_DAYS);
        const retroCutoffStr = retroCutoff.toISOString().slice(0, 10);
        const retroGameIds = historicalGames
          .filter((g) => g.gameId && g.date >= retroCutoffStr)
          .map((g) => g.gameId!);

        const teamIds = upcomingGames.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((id): id is string => id !== null);
        const [oddsByEspnId, teamStatsByTeamId, retroOddsByGameId] = await Promise.all([
          fetchOddsForGames(upcomingGames.map((g) => g.espnId)),
          fetchTeamStatsForIds(teamIds),
          fetchOddsForGames(retroGameIds),
        ]);
        if (!cancelled) {
          setSnapshot({
            requestId,
            historicalGames,
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
            historicalGames: [],
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
  }, [requestId]);

  const loading = snapshot === null || snapshot.requestId !== requestId;

  const analysis = useMemo(() => {
    if (loading || !snapshot || snapshot.error) return null;
    const { historicalGames, upcomingGames, oddsByEspnId } = snapshot;
    if (historicalGames.length === 0) return null;

    const knownTeams = new Set<string>();
    for (const g of historicalGames) {
      knownTeams.add(g.homeTeam);
      knownTeams.add(g.awayTeam);
    }

    const { records, finalRatings, ratingHistory } = runElo(historicalGames, DEFAULT_ELO_OPTIONS);
    const model = trainLogisticRegression(
      records.map((r) => [r.eloDiff]),
      records.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const rows: Row[] = upcomingGames.map((game) => {
      const matchedHome = matchTeamName(game.homeTeam, knownTeams);
      const matchedAway = matchTeamName(game.awayTeam, knownTeams);
      if (!matchedHome || !matchedAway) {
        return { game, status: "unmatched" };
      }

      const homeElo = finalRatings.get(matchedHome) ?? DEFAULT_ELO_OPTIONS.initialRating;
      const awayElo = finalRatings.get(matchedAway) ?? DEFAULT_ELO_OPTIONS.initialRating;
      const homeAdv = game.neutralSite ? 0 : DEFAULT_ELO_OPTIONS.homeAdvantage;
      const pHome = predictProba(model, [homeElo + homeAdv - awayElo]);

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

    return { edgeRows, flaggedRows, noEdgeRows, unavailableRows, gameCount: upcomingGames.length, ratingHistory, historicalGames };
  }, [snapshot, loading, currentBankroll, fractionalMultiplier]);

  // "How would we have done?" — replays games already played in the last
  // RETRO_LOOKBACK_DAYS days as if predicting them beforehand. The model is
  // trained ONLY on games before that window (no leakage from the very
  // outcomes being graded); Elo's pregame ratings are inherently leak-free
  // already, since runElo only ever reads each team's rating as it stood
  // immediately before that specific game.
  const reportCard = useMemo(() => {
    if (loading || !snapshot || snapshot.error) return null;
    const { historicalGames, retroOddsByGameId } = snapshot;
    if (historicalGames.length === 0) return null;

    const retroCutoff = new Date();
    retroCutoff.setDate(retroCutoff.getDate() - RETRO_LOOKBACK_DAYS);
    const retroCutoffStr = retroCutoff.toISOString().slice(0, 10);

    const { records } = runElo(historicalGames, DEFAULT_ELO_OPTIONS);
    const priorRecords = records.filter((r) => r.date < retroCutoffStr);
    const retroRecords = records.filter((r) => r.gameId && r.date >= retroCutoffStr);
    if (priorRecords.length < 50 || retroRecords.length === 0) return null;

    const model = trainLogisticRegression(
      priorRecords.map((r) => [r.eloDiff]),
      priorRecords.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const rows: RetroRow[] = retroRecords.map((record) => {
      const pHome = predictProba(model, [record.eloDiff]);
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
  }, [snapshot, loading, currentBankroll, fractionalMultiplier]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          This Week&apos;s Edges — College Football
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pulls this week&apos;s upcoming FBS games and live odds automatically, runs them
          through the same Elo + probability model from the Model tab, and shows only the
          ones with a positive-EV edge — sized at your current bankroll. Nothing here is
          entered by hand.
        </p>
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
                const homeStats = snapshot?.teamStatsByTeamId.get(row.game.homeTeamId ?? "");
                const awayStats = snapshot?.teamStatsByTeamId.get(row.game.awayTeamId ?? "");
                const homeStatsLine = formatTeamStatsLine(homeStats);
                const awayStatsLine = formatTeamStatsLine(awayStats);
                const statsAreStale =
                  isStaleSeasonStats(homeStats ?? null, snapshot?.currentWeek ?? null) ||
                  isStaleSeasonStats(awayStats ?? null, snapshot?.currentWeek ?? null);
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
                        href={researchUrl("cfb", row.matchedHome, row.matchedAway, row.game.espnId)}
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
                  <div key={row.game.espnId} className="flex flex-wrap items-center gap-x-2">
                    <span>
                      {row.game.awayTeam} at {row.game.homeTeam} — model says {row.pick.team}{" "}
                      {(row.pick.summary.p * 100).toFixed(0)}%, market implies only{" "}
                      {(row.pick.marketImplied * 100).toFixed(0)}% ({formatMoneyline(row.pick.moneyline)}). Not shown
                      as a bet — this gap almost certainly means the model is missing something.
                    </span>
                    <Link
                      href={researchUrl("cfb", row.matchedHome, row.matchedAway, row.game.espnId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--series-1)" }}
                    >
                      Research →
                    </Link>
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
                  <div key={row.game.espnId} className="flex flex-wrap items-center gap-x-2">
                    <span>
                      {row.game.awayTeam} at {row.game.homeTeam} — model {(row.pHome * 100).toFixed(0)}% home, priced
                      efficiently at {row.provider}
                    </span>
                    <Link
                      href={researchUrl("cfb", row.matchedHome, row.matchedAway, row.game.espnId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--series-1)" }}
                    >
                      Research →
                    </Link>
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
                  <div key={row.game.espnId} className="flex flex-wrap items-center gap-x-2">
                    <span>
                      {row.game.awayTeam} at {row.game.homeTeam} —{" "}
                      {row.status === "unmatched" ? "team not found in historical data" : "odds not posted yet"}
                    </span>
                    {row.status === "no-odds" && (
                      <Link
                        href={researchUrl("cfb", row.matchedHome, row.matchedAway, row.game.espnId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--series-1)" }}
                      >
                        Research →
                      </Link>
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
                      href={researchUrl("cfb", row.record.homeTeam, row.record.awayTeam, row.record.gameId)}
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
        This reuses the same simplified Elo/logistic model from the Probability Model tab — no
        injuries, weather, or roster changes factored in. Odds come from one sportsbook via
        ESPN&apos;s public (unofficial) API, which can change or go down without notice. Treat
        every row here as a starting point to sanity-check, not a guarantee. The &quot;Season so
        far&quot; line under each matchup (points/game, yards/game, turnover margin) is
        informational context pulled live from ESPN — it is <em>not</em> fed into the model or the
        pick, since there&apos;s no historical archive of these stats for college football to train
        on the way there is for the NFL on the Probability Model tab.
      </p>
    </div>
  );
}
