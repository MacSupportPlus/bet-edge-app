"use client";

import { useEffect, useMemo, useState } from "react";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { currency } from "@/lib/format";
import { Sport } from "@/lib/espn";
import { Game } from "@/lib/elo";
import { loadGames } from "@/lib/loadGames";
import { FRACTIONAL_OPTIONS, formatMoneyline } from "@/lib/odds";
import { loadPlayerProps, PlayerPropQuote, PlayerPropsGame, PropMarket } from "@/lib/playerProps";
import { buildPlayerProjectionModel, PlayerProjectionModel, ProjectionCategory, projectedYardsBefore } from "@/lib/playerProjection";
import { loadPlayerUsage, PlayerUsageRow } from "@/lib/playerUsage";
import { classifyPick, OverUnderPickResult, pickOverUnder } from "@/lib/scanner";
import { SPORT_LABELS } from "@/lib/sportConfig";
import { empiricalOverProbability } from "@/lib/spreadModel";
import { hitRate, HitRateResult, TIER_COLOR } from "@/lib/hitRate";
import { normalizeTeamName } from "@/lib/teamMatch";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Callout } from "./Callout";
import { StatTile } from "./StatTile";

/** Which of The Odds API's prop markets are modeled here, and their category. Not modeled yet: player_receptions, player_pass_tds, player_anytime_td — those are count stats needing a different (Poisson-style) projection approach, not the yardage Normal model. Passing yards is validated too now, but noticeably noisier than rushing (see playerProjection.ts's doc comment for the real per-category numbers) — worth weighting confidence accordingly. */
const MODELED_MARKETS: Partial<Record<PropMarket, ProjectionCategory>> = {
  player_pass_yds: "passing",
  player_rush_yds: "rushing",
  player_reception_yds: "receiving",
};

const MARKET_LABELS: Record<PropMarket, string> = {
  player_pass_yds: "Passing yards",
  player_rush_yds: "Rushing yards",
  player_reception_yds: "Receiving yards",
  player_receptions: "Receptions",
  player_pass_tds: "Passing TDs",
  player_anytime_td: "Anytime TD",
};

interface Snapshot {
  sport: Sport;
  games: Game[];
  playerUsage: PlayerUsageRow[];
  propsGames: PlayerPropsGame[];
  error: string | null;
}

interface EdgeRow {
  gameLabel: string;
  market: PropMarket;
  player: string;
  book: string;
  line: number;
  projected: number;
  odds: number;
  pick: OverUnderPickResult;
  stake: number;
  last10: HitRateResult;
}

interface FlaggedRow {
  gameLabel: string;
  market: PropMarket;
  player: string;
  line: number;
  projected: number;
  pick: OverUnderPickResult;
  last10: HitRateResult;
}

/** Matches a live prop's player name against the historical archive's own spelling — nflverse's and The Odds API's name formatting can differ slightly (periods, suffixes), same reasoning as qbValue.ts's resolveLiveStarter. */
function matchPlayerName(propName: string, knownNames: ReadonlySet<string>): string | null {
  if (knownNames.has(propName)) return propName;
  const normalized = normalizeTeamName(propName);
  for (const known of knownNames) {
    if (normalizeTeamName(known) === normalized) return known;
  }
  return null;
}

export function PropsEdgeFinder({ sport }: { sport: Sport }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [startingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier, setFractionalMultiplier] = useLocalStorageState("weekly-edges:fractional", 0.5);
  const currentBankroll = useMemo(() => summarizeBankroll(startingBankroll, bets).currentBankroll, [startingBankroll, bets]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), loadPlayerUsage(sport), loadPlayerProps(sport)])
      .then(([games, playerUsage, propsResult]) => {
        if (!cancelled) {
          setSnapshot({ sport, games, playerUsage, propsGames: [...propsResult.byMatchup.values()], error: null });
        }
      })
      .catch((e) => {
        if (!cancelled) setSnapshot({ sport, games: [], playerUsage: [], propsGames: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const loading = snapshot === null || snapshot.sport !== sport;

  const analysis = useMemo(() => {
    if (loading || !snapshot || snapshot.error || snapshot.games.length === 0) return null;
    const { games, playerUsage, propsGames } = snapshot;
    const currentSeason = games[games.length - 1].season;

    const modelsByCategory = new Map<ProjectionCategory, PlayerProjectionModel>();
    for (const category of ["passing", "rushing", "receiving"] as ProjectionCategory[]) {
      modelsByCategory.set(category, buildPlayerProjectionModel(games, playerUsage, category));
    }
    const knownNamesByCategory = new Map<ProjectionCategory, Set<string>>();
    for (const [category, model] of modelsByCategory) knownNamesByCategory.set(category, new Set(model.logsByPlayer.keys()));

    const edgeRows: EdgeRow[] = [];
    const flaggedRows: FlaggedRow[] = [];
    let unmatchedCount = 0;
    let notYetModeledCount = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const g of propsGames) {
      const gameLabel = `${g.awayTeam} at ${g.homeTeam}`;
      // Best (highest-payout) over/under price per player+market across every book that posted it.
      const byPlayerMarket = new Map<string, PlayerPropQuote[]>();
      for (const q of g.props) {
        const key = `${q.market}|${q.player}`;
        const list = byPlayerMarket.get(key) ?? [];
        list.push(q);
        byPlayerMarket.set(key, list);
      }

      for (const [key, quotes] of byPlayerMarket) {
        const [market, player] = key.split("|") as [PropMarket, string];
        const category = MODELED_MARKETS[market];
        if (!category) {
          notYetModeledCount++;
          continue;
        }
        const model = modelsByCategory.get(category)!;
        const knownNames = knownNamesByCategory.get(category)!;
        const matched = matchPlayerName(player, knownNames);
        if (!matched) {
          unmatchedCount++;
          continue;
        }
        const projected = projectedYardsBefore(model, matched, currentSeason, today);
        if (projected === null) continue; // hasn't cleared the minimum sample size yet this season

        const lines = quotes.map((q) => q.line).filter((v): v is number => v !== null);
        if (lines.length === 0) continue;
        const line = lines.reduce((s, v) => s + v, 0) / lines.length; // consensus line across books
        const pOver = empiricalOverProbability(projected, line, model.residuals, model.sigma);

        let bestOverOdds: number | null = null;
        let bestUnderOdds: number | null = null;
        for (const q of quotes) {
          if (q.overOdds !== null && (bestOverOdds === null || q.overOdds > bestOverOdds)) bestOverOdds = q.overOdds;
          if (q.underOdds !== null && (bestUnderOdds === null || q.underOdds > bestUnderOdds)) bestUnderOdds = q.underOdds;
        }
        if (bestOverOdds === null || bestUnderOdds === null) continue;

        const pick = pickOverUnder(pOver, bestOverOdds, bestUnderOdds);
        const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);
        const odds = pick.side === "over" ? bestOverOdds : bestUnderOdds;
        const book =
          pick.side === "over" ? (quotes.find((q) => q.overOdds === bestOverOdds)?.book ?? "?") : (quotes.find((q) => q.underOdds === bestUnderOdds)?.book ?? "?");

        // Recent-form context (Outlier.bet-style traffic light) alongside the
        // model edge — supporting signal, not the primary one, per the
        // redesign plan: the edge above is what to act on, this is just "has
        // this actually been happening lately."
        const recentYards = [...(model.logsByPlayer.get(matched) ?? [])].reverse().slice(0, 10).map((g) => g.yards);
        const last10 = hitRate(recentYards, line, pick.side);

        if (classification.status === "edge") {
          edgeRows.push({ gameLabel, market, player: matched, book, line, projected, odds, pick, stake: classification.stake, last10 });
        } else if (classification.status === "flagged") {
          flaggedRows.push({ gameLabel, market, player: matched, line, projected, pick, last10 });
        }
      }
    }

    edgeRows.sort((a, b) => b.pick.summary.expectancy - a.pick.summary.expectancy);
    flaggedRows.sort((a, b) => Math.abs(b.pick.disagreement) - Math.abs(a.pick.disagreement));

    return { edgeRows, flaggedRows, unmatchedCount, notYetModeledCount, gamesWithProps: propsGames.length };
  }, [snapshot, loading, currentBankroll, fractionalMultiplier]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Props Edge Finder — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Projects each player&apos;s passing, rushing, or receiving yards from their own
          walk-forward season-to-date average (never using games not yet played), then runs it
          through the same de-vig + trust-guardrail pipeline as the moneyline scanner against live
          player-prop lines. Receptions, TDs, and anytime-TD props aren&apos;t modeled yet — see the
          note below.
        </p>
      </div>

      <Callout kind="warning">
        This uses a plain season-to-date average, not an opponent-adjusted projection (that&apos;s
        a planned refinement). Validated separately per category on real NFL history — all three
        beat a naive league-average baseline, but by different margins: rushing cuts error ~34%
        (correlation 0.59), receiving ~14% (correlation 0.41), passing ~10% (correlation 0.38).
        Weight a passing or receiving edge with more caution than a rushing one. None of the three
        know if this week&apos;s opponent is a tough or easy matchup yet. Treat flagged picks (a
        huge gap from the market) as the model probably being wrong, not free money — same rule as
        everywhere else in this app. Yardage is also right-skewed (a few big games), so the
        over/under split isn&apos;t perfectly 50/50 even when the model is exactly right on
        average — a real, disclosed imprecision.
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
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading player props and building projections…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t load props data: {snapshot.error}. Player props need the live-odds refresh
          workflow to have run at least once — see the Guide.
        </div>
      )}
      {!loading && !snapshot?.error && analysis && analysis.gamesWithProps === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No games with posted player props right now — either it&apos;s too early in the week for
          books to have posted them, or the live-odds refresh hasn&apos;t run yet.
        </p>
      )}

      {analysis && analysis.gamesWithProps > 0 && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {analysis.edgeRows.length > 0
                ? `${analysis.edgeRows.length} edge${analysis.edgeRows.length === 1 ? "" : "s"} found`
                : "No trustworthy prop edges found right now"}
            </h2>
            <div className="flex flex-col gap-3">
              {analysis.edgeRows.map((row, i) => (
                <div key={i} className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--status-good)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {row.player} — {MARKET_LABELS[row.market]}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {row.gameLabel} · line {row.line.toFixed(1)} · projected {row.projected.toFixed(1)} · odds via {row.book}
                      </div>
                      <div className="mt-1 text-xs font-medium" style={{ color: TIER_COLOR[row.last10.tier] }}>
                        Last 10 {row.pick.side}: {row.last10.hits}/{row.last10.total}
                        {row.last10.tier === "insufficient" && <span style={{ color: "var(--text-muted)" }}> (small sample)</span>}
                      </div>
                    </div>
                    <span className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: "var(--status-good)" }}>
                      BET {row.pick.side.toUpperCase()} {row.line.toFixed(1)} ({formatMoneyline(row.odds)})
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatTile label="Model prob." value={`${(row.pick.summary.p * 100).toFixed(1)}%`} />
                    <StatTile label="Market implied" value={`${(row.pick.marketImplied * 100).toFixed(1)}%`} sub="vig-removed" />
                    <StatTile label="Expected value" value={`+${(row.pick.summary.expectancy * 100).toFixed(1)}%`} accent="good" />
                    <StatTile label="Recommended stake" value={currency(row.stake)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {analysis.flaggedRows.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Flagged — model disagrees too much with the market to trust ({analysis.flaggedRows.length})
              </h2>
              <div className="flex flex-col gap-2">
                {analysis.flaggedRows.map((row, i) => (
                  <div key={i} className="rounded-lg border p-3 text-xs" style={{ background: "var(--card-bg)", borderColor: "var(--status-critical)" }}>
                    <strong style={{ color: "var(--text-secondary)" }}>
                      {row.player} — {MARKET_LABELS[row.market]}
                    </strong>{" "}
                    ({row.gameLabel}): model {(row.pick.summary.p * 100).toFixed(0)}% {row.pick.side} {row.line.toFixed(1)}, market{" "}
                    {(row.pick.marketImplied * 100).toFixed(0)}% — {Math.abs(row.pick.disagreement * 100).toFixed(0)}pt gap.{" "}
                    <span style={{ color: TIER_COLOR[row.last10.tier] }}>
                      Last 10 {row.pick.side}: {row.last10.hits}/{row.last10.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {analysis.notYetModeledCount} prop line{analysis.notYetModeledCount === 1 ? "" : "s"} skipped (receptions/TDs
            — not modeled yet) · {analysis.unmatchedCount} skipped (player name didn&apos;t
            match the historical archive, usually a rookie or very recent trade with too little usage data).
          </p>
        </>
      )}
    </div>
  );
}
