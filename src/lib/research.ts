/**
 * Per-team/per-matchup research helpers — the data behind the Game Research
 * page and the "expand" summaries on This Week. Everything here is derived
 * from data the app already loads (historical games, NFL team stats); no
 * new fetching, just new ways of slicing what's already there.
 */

import { Game } from "./elo";
import { TeamGameStat } from "./teamStats";

export interface HeadToHeadGame {
  gameId?: string;
  date: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

/** Every prior meeting between two teams (either home/away order), most recent first. */
export function headToHead(games: Game[], teamA: string, teamB: string): HeadToHeadGame[] {
  return games
    .filter((g) => (g.homeTeam === teamA && g.awayTeam === teamB) || (g.homeTeam === teamB && g.awayTeam === teamA))
    .map((g) => ({
      gameId: g.gameId,
      date: g.date,
      season: g.season,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Summarizes a head-to-head list from `team`'s point of view: wins, losses, ties. */
export function headToHeadRecord(h2h: HeadToHeadGame[], team: string): { wins: number; losses: number; ties: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const g of h2h) {
    const teamScore = g.homeTeam === team ? g.homeScore : g.awayScore;
    const oppScore = g.homeTeam === team ? g.awayScore : g.homeScore;
    if (teamScore > oppScore) wins++;
    else if (teamScore < oppScore) losses++;
    else ties++;
  }
  return { wins, losses, ties };
}

export interface TeamStatTrendPoint {
  gameId: string;
  date: string;
  season: number;
  opponent: string;
  totalYards: number;
  turnoverMargin: number;
  offEpa: number;
}

/**
 * One team's own game-by-game box-score stats (NFL only — see teamStats.ts).
 * Unlike computeTeamStatDiffs, these are the raw per-game values, not a
 * walk-forward average — meant for a trend chart, not a model feature.
 */
export function teamStatTrend(games: Game[], stats: TeamGameStat[], team: string): TeamStatTrendPoint[] {
  const byGameTeam = new Map<string, TeamGameStat>();
  for (const s of stats) byGameTeam.set(`${s.gameId}|${s.team}`, s);

  const points: TeamStatTrendPoint[] = [];
  for (const g of games) {
    if (!g.gameId) continue;
    const isHome = g.homeTeam === team;
    const isAway = g.awayTeam === team;
    if (!isHome && !isAway) continue;
    const stat = byGameTeam.get(`${g.gameId}|${team}`);
    if (!stat) continue;
    points.push({
      gameId: g.gameId,
      date: g.date,
      season: g.season,
      opponent: isHome ? g.awayTeam : g.homeTeam,
      totalYards: stat.totalYards,
      turnoverMargin: stat.turnoverMargin,
      offEpa: stat.offEpa,
    });
  }
  return points;
}

/** Average of a team's own stat trend, restricted to one season — "current form" for a hypothetical/upcoming matchup. */
export function seasonAverage(trend: TeamStatTrendPoint[], season: number): { totalYards: number; turnoverMargin: number; offEpa: number } | null {
  const games = trend.filter((p) => p.season === season);
  if (games.length === 0) return null;
  return {
    totalYards: games.reduce((s, p) => s + p.totalYards, 0) / games.length,
    turnoverMargin: games.reduce((s, p) => s + p.turnoverMargin, 0) / games.length,
    offEpa: games.reduce((s, p) => s + p.offEpa, 0) / games.length,
  };
}
