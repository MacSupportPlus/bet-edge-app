/**
 * Shared ranking computation behind the Rankings page and the Team page's
 * "rank" callout — one team's position is just an index into the same list
 * the Rankings page builds, so both stay consistent by construction instead
 * of two hand-maintained copies of the same logic.
 */

import { EloOptions, Game, runElo } from "./elo";
import { Sport } from "./espn";
import { TeamGameStat } from "./teamStats";

export interface TeamRankingRow {
  team: string;
  elo: number;
  seasonStartElo: number | null;
  /** Current Elo minus seasonStartElo — null if seasonStartElo is unknown. */
  change: number | null;
  wins: number;
  losses: number;
  ties: number;
  ppg: number;
  yardsPerGame: number | null;
  turnoverMargin: number | null;
  epaPerGame: number | null;
}

export interface RankingsResult {
  /** Sorted by current Elo, descending — index 0 is #1. */
  rows: TeamRankingRow[];
  hasTeamStats: boolean;
  /** Whether any row has a real (nonzero) EPA figure — CFB's archive never does. */
  showEpa: boolean;
  currentSeason: number;
}

/**
 * Ranks every team with at least one game played this season. For CFB,
 * scoped to FBS teams — identified for free from which teams have rows in
 * the box-score archive (FBS-vs-FBS only, see prepare-data.mjs), no
 * separate division data needed.
 */
export function computeRankings(
  sport: Sport,
  games: Game[],
  teamGameStats: TeamGameStat[] | null,
  eloOptions: EloOptions,
): RankingsResult | null {
  if (games.length === 0) return null;
  const { finalRatings, ratingHistory, records } = runElo(games, eloOptions);
  const currentSeason = games[games.length - 1].season;
  const hasTeamStats = !!teamGameStats && teamGameStats.length > 0;

  const eligibleTeams = sport === "cfb" && hasTeamStats ? new Set(teamGameStats!.map((s) => s.team)) : null;

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
  const showEpa = [...statTotals.values()].some((t) => t.epa !== 0);

  const rows: TeamRankingRow[] = [];
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
      epaPerGame: stats && showEpa ? stats.epa / stats.count : null,
    });
  }

  rows.sort((a, b) => b.elo - a.elo);

  return { rows, hasTeamStats, showEpa, currentSeason };
}
