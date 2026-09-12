"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Game } from "@/lib/elo";
import { fetchUpcomingGames, Sport, UpcomingGame } from "@/lib/espn";
import {
  FAVORITE_PLAYERS_KEY,
  FAVORITE_TEAMS_KEY,
  FavoritePlayer,
  FavoriteTeam,
} from "@/lib/favorites";
import { loadGames } from "@/lib/loadGames";
import { currentTeamFor, playerGameLog } from "@/lib/playerGameLog";
import { loadPlayerUsage, PlayerUsageRow, USAGE_STAT_FIELDS } from "@/lib/playerUsage";
import { computeRankings, TeamRankingRow } from "@/lib/rankings";
import { SPORT_ELO_OPTIONS, SPORT_LABELS, SCHEDULE_LOOKAHEAD_DAYS } from "@/lib/sportConfig";
import { matchKeyFor, matchTeamName } from "@/lib/teamMatch";
import { loadTeamStats, TeamGameStat } from "@/lib/teamStats";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type RankingsResultType = ReturnType<typeof computeRankings>;

interface SportData {
  games: Game[];
  teamGameStats: TeamGameStat[];
  playerUsage: PlayerUsageRow[];
  upcoming: UpcomingGame[];
  rankings: RankingsResultType;
}

const EXPLORE_LINKS = [
  { href: "/this-week", label: "This Week", description: "This week's games with a positive-EV edge, both sports." },
  { href: "/research", label: "Research", description: "Deep-dive any single matchup — ratings, trends, live odds." },
  { href: "/games", label: "All Games", description: "The full season schedule, browsable, not just today's picks." },
  { href: "/player", label: "Player Research", description: "Any player's full stat history, projections, and live prop lines." },
  { href: "/props", label: "Props", description: "Model-projected player props with real edges, not just hit rates." },
  { href: "/trends", label: "Trends", description: "Situational ATS/O-U trends, sample-size gated so noise isn't sold as an edge." },
  { href: "/rankings", label: "Rankings", description: "Every team, ranked by Elo, with opponent-adjusted offense/defense." },
  { href: "/tracker", label: "Bankroll Tracker", description: "Log bets, auto-settle them, and track closing-line value." },
];

function fmtKickoff(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function rankRow(rankings: RankingsResultType, team: string): { row: TeamRankingRow; rank: number } | null {
  if (!rankings) return null;
  const idx = rankings.rows.findIndex((r) => r.team === team);
  if (idx === -1) return null;
  return { row: rankings.rows[idx], rank: idx + 1 };
}


function nextGameFor(sport: Sport, team: string, data: SportData): { opponent: string; isHome: boolean; date: string } | null {
  const knownTeams = new Set<string>();
  for (const g of data.games) {
    knownTeams.add(g.homeTeam);
    knownTeams.add(g.awayTeam);
  }
  for (const g of data.upcoming) {
    const home = matchTeamName(matchKeyFor(sport, g, "home"), knownTeams) ?? g.homeTeam;
    const away = matchTeamName(matchKeyFor(sport, g, "away"), knownTeams) ?? g.awayTeam;
    if (home === team) return { opponent: away, isHome: true, date: g.date };
    if (away === team) return { opponent: home, isHome: false, date: g.date };
  }
  return null;
}

/**
 * The home page: a real dashboard instead of a single calculator. Surfaces
 * whatever you've favorited (current rank/next game for teams, last stat
 * line for players) so this feels like your own control center — and a
 * flat "explore everything" grid underneath for self-directed research,
 * per the redesign goal of combining algorithmic picks with a user's own
 * intelligence rather than picking one or the other.
 */
export function CommandCenter() {
  const [teams] = useLocalStorageState<FavoriteTeam[]>(FAVORITE_TEAMS_KEY, []);
  const [players] = useLocalStorageState<FavoritePlayer[]>(FAVORITE_PLAYERS_KEY, []);

  const neededSports = useMemo(() => {
    const set = new Set<Sport>();
    for (const t of teams) set.add(t.sport);
    for (const p of players) set.add(p.sport);
    return [...set];
  }, [teams, players]);

  const [dataBySport, setDataBySport] = useState<Partial<Record<Sport, SportData>>>({});

  useEffect(() => {
    let cancelled = false;
    for (const sport of neededSports) {
      if (dataBySport[sport]) continue;
      Promise.all([
        loadGames(sport),
        loadTeamStats(sport),
        loadPlayerUsage(sport),
        fetchUpcomingGames(sport, SCHEDULE_LOOKAHEAD_DAYS[sport]),
      ]).then(([games, teamGameStats, playerUsage, schedule]) => {
        if (cancelled) return;
        const rankings = computeRankings(sport, games, teamGameStats, SPORT_ELO_OPTIONS[sport]);
        setDataBySport((prev) => ({ ...prev, [sport]: { games, teamGameStats, playerUsage, upcoming: schedule.games, rankings } }));
      });
    }
    return () => {
      cancelled = true;
    };
    // dataBySport intentionally excluded — this effect only fires when the
    // set of sports needed changes, and reads dataBySport just to skip a
    // sport already loaded (including it would refetch every load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededSports]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Command Center
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Your favorites, front and center — plus everywhere else the model can take you.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Favorites
        </h2>
        {teams.length === 0 && players.length === 0 && (
          <div className="rounded-lg border p-4 text-sm" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--text-secondary)" }}>
            Nothing starred yet. Open any{" "}
            <Link href="/team" className="underline" style={{ color: "var(--series-1)" }}>
              team
            </Link>{" "}
            or{" "}
            <Link href="/player" className="underline" style={{ color: "var(--series-1)" }}>
              player
            </Link>{" "}
            page and tap the star — they&apos;ll show up here.
          </div>
        )}

        {teams.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {teams.map((t) => {
              const data = dataBySport[t.sport];
              const ranked = data?.rankings ? rankRow(data.rankings, t.team) : null;
              const next = data ? nextGameFor(t.sport, t.team, data) : null;
              return (
                <Link
                  key={`${t.sport}-${t.team}`}
                  href={`/team?sport=${t.sport}&name=${encodeURIComponent(t.team)}`}
                  className="flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-[var(--series-1)]"
                  style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {t.team}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {SPORT_LABELS[t.sport]}
                    </span>
                  </div>
                  {!data && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Loading…
                    </span>
                  )}
                  {ranked && (
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      #{ranked.rank} Elo · {ranked.row.wins}-{ranked.row.losses}
                      {ranked.row.ties > 0 ? `-${ranked.row.ties}` : ""}
                    </span>
                  )}
                  {next && (
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Next: {next.isHome ? "vs" : "@"} {next.opponent} · {fmtKickoff(next.date)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {players.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {players.map((p) => {
              const data = dataBySport[p.sport];
              const log = data ? playerGameLog(data.playerUsage, data.games, p.player) : [];
              const last = log[0];
              const team = data ? currentTeamFor(log) ?? p.team : p.team;
              return (
                <Link
                  key={`${p.sport}-${p.player}`}
                  href={`/player?sport=${p.sport}&name=${encodeURIComponent(p.player)}`}
                  className="flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-[var(--series-1)]"
                  style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {p.player}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {team} · {SPORT_LABELS[p.sport]}
                    </span>
                  </div>
                  {!data && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Loading…
                    </span>
                  )}
                  {last && (
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Last game ({last.category}): {USAGE_STAT_FIELDS[last.category].map((f, i) => `${f} ${last.statLine[i]}`).join(", ")}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Explore
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EXPLORE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-[var(--series-1)]"
              style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
            >
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {link.label} →
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {link.description}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
