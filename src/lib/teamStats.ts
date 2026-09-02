/**
 * NFL team box-score stats as pregame model features (extends the Elo-only
 * Phase 4 model). CFB has no equivalent bulk per-game stats archive, so this
 * is NFL-only — see WeeklyEdges for CFB's separate, display-only stats via
 * ESPN's live team-statistics endpoint.
 */

import { Game } from "./elo";

export interface TeamGameStat {
  gameId: string;
  team: string;
  totalYards: number;
  /** takeaways minus giveaways for this team, this game. */
  turnoverMargin: number;
  /** passing EPA + rushing EPA for this team, this game. */
  offEpa: number;
}

export interface TeamStatFeatures {
  totalYardsDiff: number;
  turnoverMarginDiff: number;
  offEpaDiff: number;
}

export const NEUTRAL_TEAM_STAT_FEATURES: TeamStatFeatures = {
  totalYardsDiff: 0,
  turnoverMarginDiff: 0,
  offEpaDiff: 0,
};

interface RawTeamStatDataset {
  schema: string[];
  rows: [string, string, number, number, number][];
}

/** Fetches public/data/nfl-team-stats.json and shapes it into TeamGameStat[]. */
export async function loadTeamStats(): Promise<TeamGameStat[]> {
  const res = await fetch(`/data/nfl-team-stats.json`);
  if (!res.ok) throw new Error(`Failed to load team stats: ${res.status}`);
  const raw: RawTeamStatDataset = await res.json();
  return raw.rows.map(([gameId, team, totalYards, turnoverMargin, offEpa]) => ({
    gameId,
    team,
    totalYards,
    turnoverMargin,
    offEpa,
  }));
}

interface RunningTotals {
  season: number;
  count: number;
  totalYards: number;
  turnoverMargin: number;
  offEpa: number;
}

/**
 * Walk-forward, no-leakage pregame features: each team's season-to-date
 * average (prior games only, reset every season) at the moment `games` is
 * replayed in order — the same pattern as Elo. Returns home-minus-away
 * differentials keyed by gameId; games without a gameId (CFB) or with no
 * matching stat rows are simply absent from the result.
 */
export function computeTeamStatDiffs(games: Game[], stats: TeamGameStat[]): Map<string, TeamStatFeatures> {
  const byGameTeam = new Map<string, TeamGameStat>();
  for (const s of stats) byGameTeam.set(`${s.gameId}|${s.team}`, s);

  const running = new Map<string, RunningTotals>();
  const result = new Map<string, TeamStatFeatures>();

  const averageFor = (team: string, season: number): TeamStatFeatures => {
    const r = running.get(team);
    if (!r || r.season !== season || r.count === 0) return NEUTRAL_TEAM_STAT_FEATURES;
    return {
      totalYardsDiff: r.totalYards / r.count,
      turnoverMarginDiff: r.turnoverMargin / r.count,
      offEpaDiff: r.offEpa / r.count,
    };
  };

  for (const game of games) {
    if (!game.gameId) continue;
    const homeStat = byGameTeam.get(`${game.gameId}|${game.homeTeam}`);
    const awayStat = byGameTeam.get(`${game.gameId}|${game.awayTeam}`);

    const homeAvg = averageFor(game.homeTeam, game.season);
    const awayAvg = averageFor(game.awayTeam, game.season);
    result.set(game.gameId, {
      totalYardsDiff: homeAvg.totalYardsDiff - awayAvg.totalYardsDiff,
      turnoverMarginDiff: homeAvg.turnoverMarginDiff - awayAvg.turnoverMarginDiff,
      offEpaDiff: homeAvg.offEpaDiff - awayAvg.offEpaDiff,
    });

    for (const [team, stat] of [
      [game.homeTeam, homeStat],
      [game.awayTeam, awayStat],
    ] as const) {
      if (!stat) continue;
      const prev = running.get(team);
      const base: RunningTotals =
        prev && prev.season === game.season ? prev : { season: game.season, count: 0, totalYards: 0, turnoverMargin: 0, offEpa: 0 };
      running.set(team, {
        season: game.season,
        count: base.count + 1,
        totalYards: base.totalYards + stat.totalYards,
        turnoverMargin: base.turnoverMargin + stat.turnoverMargin,
        offEpa: base.offEpa + stat.offEpa,
      });
    }
  }

  return result;
}
