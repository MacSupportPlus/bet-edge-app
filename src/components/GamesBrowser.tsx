"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Game } from "@/lib/elo";
import { fetchUpcomingGames, Sport, UpcomingGame } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { SCHEDULE_LOOKAHEAD_DAYS, SPORT_LABELS } from "@/lib/sportConfig";
import { matchKeyFor, matchTeamName } from "@/lib/teamMatch";
import { TeamAutocomplete } from "./TeamAutocomplete";

interface ScheduleRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  status: "final" | "upcoming";
  homeScore?: number;
  awayScore?: number;
  espnId?: string;
}

interface Snapshot {
  sport: Sport;
  allGames: Game[];
  seasonGames: Game[];
  upcoming: UpcomingGame[];
  error: string | null;
}

function researchUrl(sport: Sport, home: string, away: string, espnId?: string): string {
  const query = new URLSearchParams({ dataset: sport, home, away });
  if (espnId) query.set("espnId", espnId);
  return `/research?${query.toString()}`;
}

function fmtUpcoming(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * Every game in the current season — completed and upcoming — not just the
 * ones with a live edge today. This is the "list all games available for
 * research" view: browse freely, filter to one team, and jump into Research
 * for any matchup, not only the ones the model happens to flag.
 */
export function GamesBrowser({ sport }: { sport: Sport }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [teamFilter, setTeamFilter] = useState("");
  const [view, setView] = useState<"current" | "history">("current");

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGames(sport), fetchUpcomingGames(sport, SCHEDULE_LOOKAHEAD_DAYS[sport])])
      .then(([games, schedule]) => {
        if (cancelled) return;
        const currentSeason = games[games.length - 1]?.season;
        const seasonGames = games.filter((g) => g.season === currentSeason);
        setSnapshot({ sport, allGames: games, seasonGames, upcoming: schedule.games, error: null });
      })
      .catch((e) => {
        if (!cancelled) setSnapshot({ sport, allGames: [], seasonGames: [], upcoming: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const loading = snapshot === null || snapshot.sport !== sport;

  const { rows, teamOptions } = useMemo(() => {
    if (loading || !snapshot) return { rows: [] as ScheduleRow[], teamOptions: [] as string[] };
    // Matched against the full archive (all seasons), not just this season's
    // games — early in a season, most teams haven't played yet, so a
    // current-season-only set would fail to resolve almost every matchup.
    const knownTeams = new Set<string>();
    for (const g of snapshot.allGames) {
      knownTeams.add(g.homeTeam);
      knownTeams.add(g.awayTeam);
    }

    const finalRows: ScheduleRow[] = snapshot.seasonGames.map((g) => ({
      date: g.date,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      status: "final",
      homeScore: g.homeScore,
      awayScore: g.awayScore,
    }));

    // Upcoming games not already covered by the historical archive (which
    // only has completed games) — matched to the same team-name convention
    // so a completed and an upcoming game for the same team look identical.
    const upcomingRows: ScheduleRow[] = [];
    for (const g of snapshot.upcoming) {
      const home = matchTeamName(matchKeyFor(sport, g, "home"), knownTeams) ?? g.homeTeam;
      const away = matchTeamName(matchKeyFor(sport, g, "away"), knownTeams) ?? g.awayTeam;
      upcomingRows.push({ date: g.date, homeTeam: home, awayTeam: away, status: "upcoming", espnId: g.espnId });
    }

    const historyRows: ScheduleRow[] = snapshot.allGames
      .filter((g) => g.season !== snapshot.seasonGames[0]?.season)
      .map((g) => ({ date: g.date, homeTeam: g.homeTeam, awayTeam: g.awayTeam, status: "final", homeScore: g.homeScore, awayScore: g.awayScore }));

    const ascending = (a: ScheduleRow, b: ScheduleRow) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const descending = (a: ScheduleRow, b: ScheduleRow) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0);

    // "Current": what's happening soonest first, not furthest away first —
    // upcoming games sorted ascending (the very next game at the top, not
    // whatever's latest on the schedule) followed by this season's already-
    // played games, most recent first.
    const all =
      view === "current"
        ? [...[...upcomingRows].sort(ascending), ...[...finalRows].sort(descending)]
        : [...historyRows].sort(descending);
    const filtered = teamFilter ? all.filter((r) => r.homeTeam === teamFilter || r.awayTeam === teamFilter) : all;
    return { rows: filtered, teamOptions: [...knownTeams].sort() };
  }, [snapshot, loading, teamFilter, sport, view]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          All Games — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {view === "current"
            ? "Every game this season, played or upcoming — not filtered to the ones with a model edge. Most current first. Pick any matchup to open it in Research."
            : "Past seasons — every completed game before this one, most recent first."}
        </p>
      </div>

      <div className="flex gap-2">
        {(["current", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="rounded-full border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: v === view ? "var(--series-1)" : "var(--card-border)",
              background: v === view ? "var(--series-1)" : "transparent",
              color: v === view ? "white" : "var(--text-secondary)",
            }}
          >
            {v === "current" ? "This Season" : "History"}
          </button>
        ))}
      </div>

      <label className="flex max-w-sm flex-col gap-1 text-sm">
        <span style={{ color: "var(--text-secondary)" }}>Filter to a team</span>
        <TeamAutocomplete value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="All teams" />
      </label>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading the season schedule…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t load the schedule: {snapshot.error}
        </div>
      )}

      {!loading && !snapshot?.error && (
        <div className="rounded-lg border" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No games found{teamFilter ? ` for ${teamFilter}` : ""}.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {rows.map((r, i) => (
                <Link
                  key={i}
                  href={researchUrl(sport, r.homeTeam, r.awayTeam, r.espnId)}
                  className="flex flex-col gap-1 px-4 py-3 text-sm transition-colors hover:bg-[var(--gridline)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.status === "final" ? r.date : fmtUpcoming(r.date)}
                    </span>
                    {r.status === "final" ? (
                      <span className="tabular-nums text-xs" style={{ color: "var(--text-secondary)" }}>
                        {r.awayScore}-{r.homeScore}
                      </span>
                    ) : (
                      <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                        upcoming
                      </span>
                    )}
                  </div>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {r.awayTeam} @ {r.homeTeam}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
