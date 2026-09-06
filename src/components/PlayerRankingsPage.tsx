"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sport } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { computeQbRankings } from "@/lib/playerRankings";
import { loadPlayerUsage, PlayerUsageRow } from "@/lib/playerUsage";
import { SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";

const OTHER_SPORT: Record<Sport, Sport> = { cfb: "nfl", nfl: "cfb" };

// Stable reference for the "no data yet" fallback, so it doesn't retrigger
// downstream useMemo hooks on every render the way a fresh [] would.
const EMPTY_PLAYER_USAGE: PlayerUsageRow[] = [];

function fmtSigned(n: number, decimals = 0): string {
  const v = n.toFixed(decimals);
  return n > 0 ? `+${v}` : v;
}

export function PlayerRankingsPage({ sport }: { sport: Sport }) {
  const [loadResult, setLoadResult] = useState<{
    sport: Sport;
    games: Awaited<ReturnType<typeof loadGames>> | null;
    playerUsage: PlayerUsageRow[];
    error: string | null;
  }>({ sport, games: null, playerUsage: [], error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), loadPlayerUsage(sport)])
      .then(([games, playerUsage]) => {
        if (!cancelled) setLoadResult({ sport, games, playerUsage, error: null });
      })
      .catch((e) => {
        if (!cancelled) setLoadResult({ sport, games: null, playerUsage: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const games = loadResult.sport === sport ? loadResult.games : null;
  const playerUsage = loadResult.sport === sport ? loadResult.playerUsage : EMPTY_PLAYER_USAGE;
  const error = loadResult.sport === sport ? loadResult.error : null;
  const loading = loadResult.sport !== sport || (games === null && error === null);

  const qbRankings = useMemo(() => {
    if (!games) return null;
    return computeQbRankings(games, playerUsage, SPORT_ELO_OPTIONS[sport]);
  }, [games, playerUsage, sport]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Player Rankings — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          QB only, for now — see the note below on why. Opponent-adjusted: compares each QB&apos;s
          output to what an average starter does against the same strength of opponent, not just a
          flat per-game average.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/players" className="underline" style={{ color: "var(--text-muted)" }}>
          ← All sports
        </Link>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <Link href={`/players/${OTHER_SPORT[sport]}`} className="underline" style={{ color: "var(--series-1)" }}>
          Switch to {SPORT_LABELS[OTHER_SPORT[sport]]} →
        </Link>
        <Link href={`/rankings/${sport}`} className="ml-auto underline" style={{ color: "var(--text-muted)" }}>
          Team rankings →
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

      {qbRankings && (
        <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Rushing, receiving, and defensive usage rotate through committees too much to
            responsibly rank the way a starting QB job doesn&apos;t (see the Team page for those,
            without a national rank attached). Needs at least {qbRankings.minGamesLed} games led
            this season before a QB shows up here, so an early-season small sample doesn&apos;t
            masquerade as a real season.
          </p>
          {qbRankings.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="px-2 py-1.5" style={{ color: "var(--text-muted)" }}>
                      #
                    </th>
                    <th className="px-2 py-1.5" style={{ color: "var(--text-muted)" }}>
                      QB
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      Rating
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      Yds/G
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      Comp%
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      TD/G
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      INT/G
                    </th>
                    <th className="px-2 py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                      Games
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {qbRankings.rows.map((r, i) => (
                    <tr key={`${r.team}|${r.player}`} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-2 py-1.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {i + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <Link href={`/team?${new URLSearchParams({ sport, name: r.team }).toString()}`} style={{ color: "var(--series-1)" }}>
                          {r.player}
                        </Link>{" "}
                        <span style={{ color: "var(--text-muted)" }}>({r.team})</span>
                      </td>
                      <td
                        className="px-2 py-1.5 text-right tabular-nums"
                        style={{ color: r.rating >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                      >
                        {fmtSigned(r.rating, 1)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.passYardsPerGame.toFixed(0)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.completionPct.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.tdPerGame.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.intPerGame.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {r.gamesLed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Not enough games played this season yet for any QB to qualify — check back as the
              season progresses.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
