"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sport } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { computeRankings, TeamRankingRow } from "@/lib/rankings";
import { SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";
import { computeSrs } from "@/lib/srs";
import { loadTeamStats, TeamGameStat } from "@/lib/teamStats";

type SortKey = "elo" | "srs" | "change" | "record" | "ppg" | "offRating" | "defRating" | "yards" | "turnover" | "epa";

const OTHER_SPORT: Record<Sport, Sport> = { cfb: "nfl", nfl: "cfb" };

function fmtSigned(n: number, decimals = 0): string {
  const v = n.toFixed(decimals);
  return n > 0 ? `+${v}` : v;
}

export function RankingsPage({ sport }: { sport: Sport }) {
  const [loadResult, setLoadResult] = useState<{
    sport: Sport;
    games: Awaited<ReturnType<typeof loadGames>> | null;
    teamGameStats: TeamGameStat[] | null;
    error: string | null;
  }>({ sport, games: null, teamGameStats: null, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), loadTeamStats(sport)])
      .then(([games, teamGameStats]) => {
        if (!cancelled) setLoadResult({ sport, games, teamGameStats, error: null });
      })
      .catch((e) => {
        if (!cancelled) setLoadResult({ sport, games: null, teamGameStats: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const games = loadResult.sport === sport ? loadResult.games : null;
  const teamGameStats = loadResult.sport === sport ? loadResult.teamGameStats : null;
  const error = loadResult.sport === sport ? loadResult.error : null;
  const loading = loadResult.sport !== sport || (games === null && error === null);

  const analysis = useMemo(() => {
    if (!games) return null;
    const ranked = computeRankings(sport, games, teamGameStats, SPORT_ELO_OPTIONS[sport]);
    if (!ranked) return null;

    const movers = ranked.rows.filter((r) => r.change !== null);
    const risers = [...movers].sort((a, b) => (b.change as number) - (a.change as number)).slice(0, 5);
    const fallers = [...movers].sort((a, b) => (a.change as number) - (b.change as number)).slice(0, 5);

    const bestOffenses = [...ranked.rows].sort((a, b) => b.offenseRating - a.offenseRating).slice(0, 5);
    const bestDefenses = [...ranked.rows].sort((a, b) => b.defenseRating - a.defenseRating).slice(0, 5);

    // SRS: a free, margin-based second opinion alongside Elo — see srs.ts.
    // Retrospective only (not walk-forward), so it's shown for context, not
    // fed into the win-probability model.
    const srsByTeam = computeSrs(games, ranked.currentSeason);

    return { ...ranked, risers, fallers, bestOffenses, bestDefenses, srsByTeam };
  }, [games, teamGameStats, sport]);

  const [sortKey, setSortKey] = useState<SortKey>("elo");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!analysis) return [];
    const value = (r: TeamRankingRow): number => {
      switch (sortKey) {
        case "elo":
          return r.elo;
        case "srs":
          return analysis.srsByTeam.get(r.team) ?? -Infinity;
        case "change":
          return r.change ?? -Infinity;
        case "record":
          return r.wins + r.losses + r.ties > 0 ? r.wins / (r.wins + r.losses + r.ties) : -Infinity;
        case "ppg":
          return r.ppg ?? -Infinity;
        case "offRating":
          return r.offenseRating;
        case "defRating":
          return r.defenseRating;
        case "yards":
          return r.yardsPerGame ?? -Infinity;
        case "turnover":
          return r.turnoverMargin ?? -Infinity;
        case "epa":
          return r.epaPerGame ?? -Infinity;
      }
    };
    const sorted = [...analysis.rows].sort((a, b) => value(b) - value(a));
    return sortDir === "desc" ? sorted : sorted.reverse();
  }, [analysis, sortKey, sortDir]);

  const columns: { key: SortKey; label: string; show: boolean }[] = [
    { key: "elo", label: "Elo", show: true },
    { key: "srs", label: "SRS", show: true },
    { key: "change", label: "Δ Season", show: true },
    { key: "record", label: "Record", show: true },
    { key: "ppg", label: "PPG", show: true },
    { key: "offRating", label: "Off rtg", show: true },
    { key: "defRating", label: "Def rtg", show: true },
    { key: "yards", label: "Yds/G", show: !!analysis?.hasTeamStats },
    { key: "turnover", label: "Turnover", show: !!analysis?.hasTeamStats },
    { key: "epa", label: "EPA/G", show: !!analysis?.showEpa },
  ];

  function headerButton(col: (typeof columns)[number]) {
    return (
      <button
        onClick={() => toggleSort(col.key)}
        className="flex items-center gap-0.5 whitespace-nowrap"
        style={{ color: sortKey === col.key ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        {col.label}
        {sortKey === col.key && <span>{sortDir === "desc" ? "↓" : "↑"}</span>}
      </button>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Rankings — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Every team&apos;s current Elo rating, how far it&apos;s moved since their first game this
          season, and the same season-average stats the model trains on — sortable by any column,
          not just Elo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/rankings" className="underline" style={{ color: "var(--text-muted)" }}>
          ← All sports
        </Link>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <Link href={`/rankings/${OTHER_SPORT[sport]}`} className="underline" style={{ color: "var(--series-1)" }}>
          Switch to {SPORT_LABELS[OTHER_SPORT[sport]]} →
        </Link>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {SPORT_LABELS[sport]} history…
        </p>
      )}
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Failed to load game data: {error}
        </div>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--status-good)" }}>
              <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Biggest risers this season
              </h2>
              <div className="flex flex-col gap-1.5 text-xs">
                {analysis.risers.map((r) => (
                  <div key={r.team} className="flex items-center justify-between gap-2">
                    <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--text-secondary)" }}>
                      {r.team}
                    </Link>
                    <span style={{ color: "var(--status-good)" }}>
                      {r.seasonStartElo?.toFixed(0)} → {r.elo.toFixed(0)} ({fmtSigned(r.change ?? 0)})
                    </span>
                  </div>
                ))}
                {analysis.risers.length === 0 && <span style={{ color: "var(--text-muted)" }}>Not enough games played yet.</span>}
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--status-critical)" }}>
              <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Biggest fallers this season
              </h2>
              <div className="flex flex-col gap-1.5 text-xs">
                {analysis.fallers.map((r) => (
                  <div key={r.team} className="flex items-center justify-between gap-2">
                    <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--text-secondary)" }}>
                      {r.team}
                    </Link>
                    <span style={{ color: "var(--status-critical)" }}>
                      {r.seasonStartElo?.toFixed(0)} → {r.elo.toFixed(0)} ({fmtSigned(r.change ?? 0)})
                    </span>
                  </div>
                ))}
                {analysis.fallers.length === 0 && <span style={{ color: "var(--text-muted)" }}>Not enough games played yet.</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Best offenses (opponent-adjusted)
              </h2>
              <div className="flex flex-col gap-1.5 text-xs">
                {analysis.bestOffenses.map((r, i) => (
                  <div key={r.team} className="flex items-center justify-between gap-2">
                    <span>
                      <span style={{ color: "var(--text-muted)" }}>#{i + 1}</span>{" "}
                      <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--text-secondary)" }}>
                        {r.team}
                      </Link>
                    </span>
                    <span style={{ color: "var(--status-good)" }}>{fmtSigned(r.offenseRating, 1)} pts/g vs. expected</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Best defenses (opponent-adjusted)
              </h2>
              <div className="flex flex-col gap-1.5 text-xs">
                {analysis.bestDefenses.map((r, i) => (
                  <div key={r.team} className="flex items-center justify-between gap-2">
                    <span>
                      <span style={{ color: "var(--text-muted)" }}>#{i + 1}</span>{" "}
                      <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--text-secondary)" }}>
                        {r.team}
                      </Link>
                    </span>
                    <span style={{ color: "var(--status-good)" }}>{fmtSigned(r.defenseRating, 1)} pts/g vs. expected</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
            <table className="w-full text-left text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--card-border)" }}>
                  <th className="px-3 py-2" style={{ color: "var(--text-muted)" }}>
                    #
                  </th>
                  <th className="px-3 py-2" style={{ color: "var(--text-muted)" }}>
                    Team
                  </th>
                  {columns
                    .filter((c) => c.show)
                    .map((c) => (
                      <th key={c.key} className="px-3 py-2 text-right">
                        {headerButton(c)}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr key={r.team} style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <td className="px-3 py-1.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {i + 1}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--series-1)" }}>
                        {r.team}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {r.elo.toFixed(0)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtSigned(analysis.srsByTeam.get(r.team) ?? 0, 1)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      style={{ color: r.change === null ? "var(--text-muted)" : r.change >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                    >
                      {r.change === null ? "—" : fmtSigned(r.change)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {r.wins}-{r.losses}
                      {r.ties > 0 ? `-${r.ties}` : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {r.ppg?.toFixed(1) ?? "—"}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      style={{ color: r.offenseRating >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                    >
                      {fmtSigned(r.offenseRating, 1)}{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        (#{r.offenseRank} of {analysis.rows.length})
                      </span>
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      style={{ color: r.defenseRating >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                    >
                      {fmtSigned(r.defenseRating, 1)}{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        (#{r.defenseRank} of {analysis.rows.length})
                      </span>
                    </td>
                    {analysis.hasTeamStats && (
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.yardsPerGame?.toFixed(0) ?? "—"}
                      </td>
                    )}
                    {analysis.hasTeamStats && (
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.turnoverMargin !== null ? fmtSigned(r.turnoverMargin, 1) : "—"}
                      </td>
                    )}
                    {analysis.showEpa && (
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.epaPerGame !== null ? fmtSigned(r.epaPerGame, 1) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {sport === "cfb"
              ? "Limited to FBS teams (identified by having box-score stats on file — see the Guide) with at least one game played this season. Δ Season is each team's current Elo minus its rating the moment it entered this season (after any preseason regression toward the mean)."
              : "Every team with at least one game played this season. Δ Season is each team's current Elo minus its rating the moment it entered this season."}{" "}
            <strong style={{ color: "var(--text-secondary)" }}>Off/Def rtg</strong> are opponent-adjusted points
            scored/allowed per game — each team&apos;s output compared to what an average team would do against
            the same strength of opponent (bucketed into thirds by opponent Elo, league-wide), not just a raw
            per-game average, so padding stats against weak teams doesn&apos;t look the same as doing it against
            strong ones. <strong style={{ color: "var(--text-secondary)" }}>SRS</strong> is a second, independent
            rating (margin-of-victory only, no home-field adjustment, not fed into the model) — when it and Elo
            disagree on a team, that disagreement itself is useful information. Click any column to sort by it.
          </p>

          <Link
            href={`/players/${sport}`}
            className="flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-[var(--series-1)]"
            style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              QB Rankings (opponent-adjusted) →
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Same opponent-adjustment method as the team ratings above, ranked player by player.
            </span>
          </Link>
        </>
      )}
    </div>
  );
}
