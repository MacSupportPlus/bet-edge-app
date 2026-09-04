"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { runElo } from "@/lib/elo";
import { Sport } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";
import { loadTeamStats, TeamGameStat } from "@/lib/teamStats";

type SortKey = "elo" | "change" | "record" | "ppg" | "yards" | "turnover" | "epa";

interface TeamRow {
  team: string;
  elo: number;
  seasonStartElo: number | null;
  change: number | null;
  wins: number;
  losses: number;
  ties: number;
  ppg: number | null;
  yardsPerGame: number | null;
  turnoverMargin: number | null;
  epaPerGame: number | null;
}

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
    if (!games || games.length === 0) return null;
    const eloOptions = SPORT_ELO_OPTIONS[sport];
    const { finalRatings, ratingHistory, records } = runElo(games, eloOptions);
    const currentSeason = games[games.length - 1].season;
    const hasTeamStats = !!teamGameStats && teamGameStats.length > 0;

    // CFB's team-stats archive is FBS-vs-FBS only (see prepare-data.mjs) — the
    // set of teams appearing in it IS the FBS team list, for free, with no
    // separate division data to maintain. NFL has no such distinction (every
    // team qualifies).
    const eligibleTeams =
      sport === "cfb" && hasTeamStats ? new Set(teamGameStats!.map((s) => s.team)) : null;

    // A team's rating the moment it entered this season — the first current-season
    // record's own pregame rating (already reflects any season-regression pullback).
    // Single pass over this season's records, keeping only the first sighting per team.
    const seasonStartElo = new Map<string, number>();
    for (const r of records) {
      if (r.season !== currentSeason) continue;
      if (!seasonStartElo.has(r.homeTeam)) seasonStartElo.set(r.homeTeam, r.homeEloPre);
      if (!seasonStartElo.has(r.awayTeam)) seasonStartElo.set(r.awayTeam, r.awayEloPre);
    }

    // Season stat totals, single pass over this season's games (not per-team —
    // O(games), not O(teams x games)).
    const statTotals = new Map<string, { yards: number; turnover: number; epa: number; count: number }>();
    if (teamGameStats) {
      const byGameTeam = new Map(teamGameStats.map((s) => [`${s.gameId}|${s.team}`, s]));
      for (const g of games) {
        if (g.season !== currentSeason || !g.gameId) continue;
        for (const team of [g.homeTeam, g.awayTeam]) {
          const s = byGameTeam.get(`${g.gameId}|${team}`);
          if (!s) continue;
          const prev = statTotals.get(team) ?? { yards: 0, turnover: 0, epa: 0, count: 0 };
          statTotals.set(team, {
            yards: prev.yards + s.totalYards,
            turnover: prev.turnover + s.turnoverMargin,
            epa: prev.epa + s.offEpa,
            count: prev.count + 1,
          });
        }
      }
    }
    const anyRealEpa = [...statTotals.values()].some((t) => t.epa !== 0);

    const rows: TeamRow[] = [];
    for (const [team, history] of ratingHistory) {
      if (eligibleTeams && !eligibleTeams.has(team)) continue;
      const seasonGames = history.filter((g) => g.season === currentSeason);
      if (seasonGames.length === 0) continue; // inactive this season — not a current ranking

      const wins = seasonGames.filter((g) => g.result === "W").length;
      const losses = seasonGames.filter((g) => g.result === "L").length;
      const ties = seasonGames.filter((g) => g.result === "T").length;
      const ppg = seasonGames.reduce((s, g) => s + g.pointsFor, 0) / seasonGames.length;
      const elo = finalRatings.get(team) ?? eloOptions.initialRating;
      const startElo = seasonStartElo.get(team) ?? null;
      const stats = statTotals.get(team);

      rows.push({
        team,
        elo,
        seasonStartElo: startElo,
        change: startElo !== null ? elo - startElo : null,
        wins,
        losses,
        ties,
        ppg,
        yardsPerGame: stats ? stats.yards / stats.count : null,
        turnoverMargin: stats ? stats.turnover / stats.count : null,
        epaPerGame: stats && anyRealEpa ? stats.epa / stats.count : null,
      });
    }

    const movers = rows.filter((r) => r.change !== null);
    const risers = [...movers].sort((a, b) => (b.change as number) - (a.change as number)).slice(0, 5);
    const fallers = [...movers].sort((a, b) => (a.change as number) - (b.change as number)).slice(0, 5);

    return { rows, risers, fallers, hasTeamStats, showEpa: anyRealEpa, currentSeason };
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
    const value = (r: TeamRow): number => {
      switch (sortKey) {
        case "elo":
          return r.elo;
        case "change":
          return r.change ?? -Infinity;
        case "record":
          return r.wins + r.losses + r.ties > 0 ? r.wins / (r.wins + r.losses + r.ties) : -Infinity;
        case "ppg":
          return r.ppg ?? -Infinity;
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
    { key: "change", label: "Δ Season", show: true },
    { key: "record", label: "Record", show: true },
    { key: "ppg", label: "PPG", show: true },
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
            Click any column to sort by it.
          </p>
        </>
      )}
    </div>
  );
}
