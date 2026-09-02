"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { DEFAULT_ELO_OPTIONS, Game, runElo } from "@/lib/elo";
import { fetchOddsForGames, fetchUpcomingCfbGames, GameOdds, UpcomingGame } from "@/lib/espn";
import { currency } from "@/lib/format";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { classifyPick, MAX_TRUSTED_DISAGREEMENT, MAX_TRUSTED_RATIO, pickSide, PickResult } from "@/lib/scanner";
import { matchTeamName } from "@/lib/teamMatch";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Callout } from "./Callout";
import { StatTile } from "./StatTile";

const FRACTIONAL_OPTIONS = [
  { label: "Full Kelly", value: 1 },
  { label: "½ Kelly", value: 0.5 },
  { label: "¼ Kelly", value: 0.25 },
];

interface Snapshot {
  requestId: number;
  historicalGames: Game[];
  upcomingGames: UpcomingGame[];
  oddsByEspnId: Map<string, GameOdds | null>;
  error: string | null;
}

type Row =
  | { game: UpcomingGame; status: "edge"; pick: PickResult; stake: number; provider: string }
  | { game: UpcomingGame; status: "flagged"; pick: PickResult; provider: string }
  | { game: UpcomingGame; status: "no-edge"; pHome: number; provider: string }
  | { game: UpcomingGame; status: "no-odds"; pHome: number }
  | { game: UpcomingGame; status: "unmatched" };

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
        const [historicalGames, upcomingGames] = await Promise.all([
          loadGames("cfb"),
          fetchUpcomingCfbGames(8),
        ]);
        const oddsByEspnId = await fetchOddsForGames(upcomingGames.map((g) => g.espnId));
        if (!cancelled) {
          setSnapshot({ requestId, historicalGames, upcomingGames, oddsByEspnId, error: null });
        }
      } catch (e) {
        if (!cancelled) {
          setSnapshot({ requestId, historicalGames: [], upcomingGames: [], oddsByEspnId: new Map(), error: String(e) });
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

    const { records, finalRatings } = runElo(historicalGames, DEFAULT_ELO_OPTIONS);
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
        return { game, status: "no-odds", pHome };
      }

      const pick = pickSide(pHome, odds.homeMoneyline, odds.awayMoneyline, matchedHome, matchedAway);
      const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);

      if (classification.status === "no-edge") return { game, status: "no-edge", pHome, provider: odds.provider };
      if (classification.status === "flagged") return { game, status: "flagged", pick, provider: odds.provider };
      return { game, status: "edge", pick, stake: classification.stake, provider: odds.provider };
    });

    const edgeRows = rows.filter((r): r is Extract<Row, { status: "edge" }> => r.status === "edge");
    edgeRows.sort((a, b) => b.pick.summary.expectancy - a.pick.summary.expectancy);
    const flaggedRows = rows.filter((r): r is Extract<Row, { status: "flagged" }> => r.status === "flagged");
    const noEdgeRows = rows.filter((r): r is Extract<Row, { status: "no-edge" }> => r.status === "no-edge");
    const unavailableRows = rows.filter((r) => r.status === "no-odds" || r.status === "unmatched");

    return { edgeRows, flaggedRows, noEdgeRows, unavailableRows, gameCount: upcomingGames.length };
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
                    <Link
                      href={`/tracker?${query}`}
                      className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
                      style={{ background: "var(--series-1)" }}
                    >
                      Log this bet in the Tracker →
                    </Link>
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
                  <div key={row.game.espnId}>
                    {row.game.awayTeam} at {row.game.homeTeam} — model says {row.pick.team}{" "}
                    {(row.pick.summary.p * 100).toFixed(0)}%, market implies only{" "}
                    {(row.pick.marketImplied * 100).toFixed(0)}% ({formatMoneyline(row.pick.moneyline)}). Not shown
                    as a bet — this gap almost certainly means the model is missing something.
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
              <div className="mt-2 flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {analysis.noEdgeRows.map((row) => (
                  <div key={row.game.espnId}>
                    {row.game.awayTeam} at {row.game.homeTeam} — model {(row.pHome * 100).toFixed(0)}% home, priced
                    efficiently at {row.provider}
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
                  <div key={row.game.espnId}>
                    {row.game.awayTeam} at {row.game.homeTeam} —{" "}
                    {row.status === "unmatched" ? "team not found in historical data" : "odds not posted yet"}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        This reuses the same simplified Elo/logistic model from the Probability Model tab — no
        injuries, weather, or roster changes factored in. Odds come from one sportsbook via
        ESPN&apos;s public (unofficial) API, which can change or go down without notice. Treat
        every row here as a starting point to sanity-check, not a guarantee.
      </p>
    </div>
  );
}
