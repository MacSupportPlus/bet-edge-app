"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Game } from "@/lib/elo";
import { Sport } from "@/lib/espn";
import { FavoriteStar } from "./FavoriteStar";
import { currentStreak, hitRate, TIER_COLOR } from "@/lib/hitRate";
import { loadGames } from "@/lib/loadGames";
import { currentTeamFor, playerGameLog, PlayerGameLogEntry } from "@/lib/playerGameLog";
import { loadPlayerProps, PlayerPropsGame } from "@/lib/playerProps";
import { buildPlayerProjectionModel, PlayerProjectionModel, ProjectionCategory, projectedYardsBefore, YARDS_INDEX } from "@/lib/playerProjection";
import { loadPlayerUsage, PlayerUsageRow } from "@/lib/playerUsage";
import { normalizeTeamName } from "@/lib/teamMatch";
import { empiricalOverProbability } from "@/lib/spreadModel";
import { SPORT_LABELS } from "@/lib/sportConfig";
import { RecentGamesBar } from "./RecentGamesBar";
import { TeamAutocomplete } from "./TeamAutocomplete";

const CATEGORY_LABELS: Record<ProjectionCategory, string> = { passing: "Passing", rushing: "Rushing", receiving: "Receiving" };
const PROP_MARKET_FOR: Record<ProjectionCategory, string> = { passing: "player_pass_yds", rushing: "player_rush_yds", receiving: "player_reception_yds" };
/** Round-number milestones bettors actually track for each category — not arbitrary, these are the standard "does this player hit a meaningful game" thresholds (100-yard rushing game, 300-yard passing game, etc). */
const MILESTONES: Record<ProjectionCategory, number[]> = {
  passing: [200, 250, 300],
  rushing: [25, 50, 75, 100],
  receiving: [25, 50, 75, 100],
};

interface Snapshot {
  sport: Sport;
  games: Game[];
  playerUsage: PlayerUsageRow[];
  propsGames: PlayerPropsGame[];
  error: string | null;
}

function yardsOf(entry: PlayerGameLogEntry): number {
  const category = entry.category as ProjectionCategory;
  const idx = YARDS_INDEX[category];
  return idx !== undefined ? (entry.statLine[idx] ?? 0) : 0;
}

export function PlayerCommandPage() {
  const router = useRouter();
  const params = useSearchParams();
  const sport: Sport = params.get("sport") === "nfl" ? "nfl" : "cfb";
  const name = params.get("name") ?? "";

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pickSportDraft, setPickSportDraft] = useState<Sport>(sport);
  const [pickNameDraft, setPickNameDraft] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ProjectionCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), loadPlayerUsage(sport), loadPlayerProps(sport)])
      .then(([games, playerUsage, propsResult]) => {
        if (!cancelled) setSnapshot({ sport, games, playerUsage, propsGames: [...propsResult.byMatchup.values()], error: null });
      })
      .catch((e) => {
        if (!cancelled) setSnapshot({ sport, games: [], playerUsage: [], propsGames: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const loading = snapshot === null || snapshot.sport !== sport;

  // A dedicated player-name list for the "no player picked yet" search box,
  // keyed by pickSportDraft (which can differ from the URL's committed
  // `sport` while the visitor is still switching sports in the picker) —
  // same pattern as TeamPage.tsx's teamListResult.
  const [playerListResult, setPlayerListResult] = useState<{ sport: Sport; names: string[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPlayerUsage(pickSportDraft).then((usage) => {
      if (!cancelled) setPlayerListResult({ sport: pickSportDraft, names: [...new Set(usage.map((r) => r.player))].sort() });
    });
    return () => {
      cancelled = true;
    };
  }, [pickSportDraft]);
  const playerOptions = playerListResult?.sport === pickSportDraft ? playerListResult.names : [];

  const profile = useMemo(() => {
    if (loading || !snapshot || !name) return null;
    const { games, playerUsage, propsGames } = snapshot;
    const log = playerGameLog(playerUsage, games, name);
    if (log.length === 0) return null;
    const team = currentTeamFor(log);
    const currentSeason = games[games.length - 1].season;
    const today = new Date().toISOString().slice(0, 10);

    const categories = (["passing", "rushing", "receiving"] as ProjectionCategory[]).filter((c) => log.some((e) => e.category === c));

    const byCategory = new Map<
      ProjectionCategory,
      {
        entries: PlayerGameLogEntry[];
        values: number[];
        seasonValues: number[];
        last5: number[];
        last10: number[];
        model: PlayerProjectionModel;
        projectedNext: number | null;
        liveLine: number | null;
        liveOverOdds: number | null;
        liveUnderOdds: number | null;
        liveBook: string | null;
      }
    >();

    for (const category of categories) {
      const entries = log.filter((e) => e.category === category);
      const values = entries.map(yardsOf);
      const seasonValues = entries.filter((e) => e.season === currentSeason).map(yardsOf);
      const model = buildPlayerProjectionModel(games, playerUsage, category);
      const projectedNext = projectedYardsBefore(model, name, currentSeason, today);

      // Live prop line for this player+category, best price across whichever books posted it.
      let liveLine: number | null = null;
      let liveOverOdds: number | null = null;
      let liveUnderOdds: number | null = null;
      let liveBook: string | null = null;
      const market = PROP_MARKET_FOR[category];
      for (const g of propsGames) {
        for (const q of g.props) {
          if (q.market !== market) continue;
          if (normalizeTeamName(q.player) !== normalizeTeamName(name)) continue;
          if (q.line !== null && (liveLine === null || (q.overOdds ?? -Infinity) > (liveOverOdds ?? -Infinity))) {
            liveLine = q.line;
            liveOverOdds = q.overOdds;
            liveUnderOdds = q.underOdds;
            liveBook = q.book;
          }
        }
      }

      byCategory.set(category, {
        entries,
        values,
        seasonValues,
        last5: values.slice(0, 5),
        last10: values.slice(0, 10),
        model,
        projectedNext,
        liveLine,
        liveOverOdds,
        liveUnderOdds,
        liveBook,
      });
    }

    // Defensive usage (tackles/sacks/TFL) has no projection model or props
    // market wired up yet — surfaced as a raw game log instead of silently
    // dropping these players from a "search any player" tool.
    const defensiveLog = log.filter((e) => e.category === "defensive");

    return { team, categories, byCategory, currentSeason, defensiveLog };
  }, [snapshot, loading, name]);

  const activeCategory = selectedCategory && profile?.categories.includes(selectedCategory) ? selectedCategory : (profile?.categories[0] ?? null);
  const activeData = activeCategory ? profile?.byCategory.get(activeCategory) : undefined;

  function goToPicked() {
    if (!pickNameDraft || !playerOptions.includes(pickNameDraft)) return;
    router.push(`/player?${new URLSearchParams({ sport: pickSportDraft, name: pickNameDraft }).toString()}`);
  }

  if (!name) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Player Research
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Search any player who has appeared in a box score — not just the ones with a live edge
          today. Every stat, every recent game, every book&apos;s line, in one place.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(["cfb", "nfl"] as Sport[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setPickSportDraft(s);
                setPickNameDraft("");
              }}
              className="rounded-full border px-3 py-1.5 text-sm transition-colors"
              style={{
                borderColor: pickSportDraft === s ? "var(--series-1)" : "var(--card-border)",
                background: pickSportDraft === s ? "var(--series-1)" : "transparent",
                color: pickSportDraft === s ? "white" : "var(--text-secondary)",
              }}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span style={{ color: "var(--text-secondary)" }}>Player</span>
            <TeamAutocomplete value={pickNameDraft} onChange={setPickNameDraft} options={playerOptions} placeholder="Type any player name…" />
          </label>
          <div className="flex items-end">
            <button
              onClick={goToPicked}
              disabled={!pickNameDraft || !playerOptions.includes(pickNameDraft)}
              className="w-full rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--series-1)" }}
            >
              View player →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <Link href="/player" className="text-xs underline" style={{ color: "var(--text-muted)" }}>
          ← Search a different player
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {name}
          </h1>
          {profile?.team && <FavoriteStar kind="player" sport={sport} player={name} team={profile.team} />}
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {profile?.team ?? "—"} · {SPORT_LABELS[sport]}
        </p>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {name}&apos;s history…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t load player data: {snapshot.error}
        </div>
      )}
      {!loading && !snapshot?.error && !profile && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No box-score history found for &quot;{name}&quot; in the {SPORT_LABELS[sport]} archive.
        </p>
      )}

      {profile && profile.categories.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {name} only shows up here as a defensive usage leader — passing/rushing/receiving
            projections and prop lines aren&apos;t modeled for tackles yet. Here&apos;s the raw game log.
          </p>
          {profile.defensiveLog.length > 0 && (
            <div className="overflow-x-auto rounded-lg border" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <th className="px-3 py-2 text-left font-normal">Date</th>
                    <th className="px-3 py-2 text-left font-normal">Opp</th>
                    <th className="px-3 py-2 text-right font-normal">Tackles</th>
                    <th className="px-3 py-2 text-right font-normal">Sacks</th>
                    <th className="px-3 py-2 text-right font-normal">TFL</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.defensiveLog.map((e) => (
                    <tr key={e.gameId} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                        {e.date}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                        {e.isHome ? "vs" : "@"} {e.opponent}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {e.statLine[0]}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {e.statLine[1]}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {e.statLine[2]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {profile && profile.categories.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {profile.categories.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedCategory(c)}
                className="rounded-full border px-3 py-1.5 text-sm transition-colors"
                style={{
                  borderColor: c === activeCategory ? "var(--series-1)" : "var(--card-border)",
                  background: c === activeCategory ? "var(--series-1)" : "transparent",
                  color: c === activeCategory ? "white" : "var(--text-secondary)",
                }}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          {activeCategory && activeData && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Season avg
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {activeData.seasonValues.length > 0 ? (activeData.seasonValues.reduce((s, v) => s + v, 0) / activeData.seasonValues.length).toFixed(1) : "—"}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {activeData.seasonValues.length} games this season
                  </div>
                </div>
                <div className="rounded-lg border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Model projection
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {activeData.projectedNext !== null ? activeData.projectedNext.toFixed(1) : "—"}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {activeData.projectedNext !== null ? "walk-forward, no leakage" : "needs 5+ games this season"}
                  </div>
                </div>
                <div className="rounded-lg border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Live line{activeData.liveBook ? ` (${activeData.liveBook})` : ""}
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {activeData.liveLine !== null ? activeData.liveLine.toFixed(1) : "—"}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {activeData.liveLine !== null && activeData.projectedNext !== null
                      ? `model: ${(empiricalOverProbability(activeData.projectedNext, activeData.liveLine, activeData.model.residuals, activeData.model.sigma) * 100).toFixed(0)}% over`
                      : "no live line posted"}
                  </div>
                </div>
                <div className="rounded-lg border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Current streak
                  </div>
                  {(() => {
                    const streakLine = activeData.liveLine ?? (activeData.seasonValues.length > 0 ? activeData.seasonValues.reduce((s, v) => s + v, 0) / activeData.seasonValues.length : null);
                    const streak = streakLine !== null ? currentStreak(activeData.values, streakLine, "over") : 0;
                    return (
                      <>
                        <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: streak >= 3 ? "var(--status-good)" : "var(--text-primary)" }}>
                          {streakLine !== null ? `${streak} game${streak === 1 ? "" : "s"}` : "—"}
                        </div>
                        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          over {streakLine !== null ? streakLine.toFixed(1) : "—"}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Last {Math.min(10, activeData.values.length)} games
                </h2>
                <RecentGamesBar
                  games={[...activeData.entries]
                    .slice(0, 10)
                    .reverse()
                    .map((e) => ({ label: `${e.isHome ? "vs" : "@"} ${e.opponent}`, value: yardsOf(e) }))}
                  line={activeData.liveLine ?? (activeData.seasonValues.length > 0 ? activeData.seasonValues.reduce((s, v) => s + v, 0) / activeData.seasonValues.length : null)}
                  ariaLabel={`${name}'s last 10 games, ${CATEGORY_LABELS[activeCategory].toLowerCase()} yards`}
                />
              </div>

              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr style={{ background: "var(--card-bg)" }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                        Over…
                      </th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Last 5
                      </th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Last 10
                      </th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        This season
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {MILESTONES[activeCategory].map((threshold) => {
                      const l5 = hitRate(activeData.last5, threshold, "over");
                      const l10 = hitRate(activeData.last10, threshold, "over");
                      const season = hitRate(activeData.seasonValues, threshold, "over");
                      return (
                        <tr key={threshold} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                          <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                            {threshold}+ yds
                          </td>
                          {[l5, l10, season].map((r, i) => (
                            <td key={i} className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: TIER_COLOR[r.tier] }}>
                              {r.total > 0 ? `${r.hits}/${r.total}` : "—"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr style={{ background: "var(--card-bg)" }}>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                        Date
                      </th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                        Opponent
                      </th>
                      <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Yards
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeData.entries.slice(0, 20).map((e) => (
                      <tr key={e.gameId} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                        <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                          {e.date}
                        </td>
                        <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                          {e.isHome ? "vs" : "@"} {e.opponent}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                          {yardsOf(e)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
