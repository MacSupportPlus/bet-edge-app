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
  /**
   * Opponent-adjusted points scored/allowed per game, relative to what an
   * average team would do against the SAME strength of opponent (bucketed
   * into thirds by opponent Elo, league-wide, this season) — not just a raw
   * per-game average. Positive offense = outscoring expectation for that
   * opponent tier; positive defense = allowing less than expectation.
   */
  offenseRating: number;
  defenseRating: number;
  /** Same idea, in yards instead of points — null without a team-stats archive. */
  offenseYardsRating: number | null;
  defenseYardsRating: number | null;
  /** 1 = best offense/defense in this list (by offenseRating/defenseRating), independent of whatever order `rows` itself is sorted in. */
  offenseRank: number;
  defenseRank: number;
}

export interface RankingsResult {
  /** Sorted by current Elo, descending — index 0 is #1. */
  rows: TeamRankingRow[];
  hasTeamStats: boolean;
  /** Whether any row has a real (nonzero) EPA figure — CFB's archive never does. */
  showEpa: boolean;
  currentSeason: number;
}

/** [0-33rd percentile), [33rd-66th), [66th-100th] cutoffs for opponent Elo, from a league-wide sample this season. */
function tercileThresholds(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return [sorted[Math.floor(n / 3)], sorted[Math.floor((2 * n) / 3)]];
}

function bucketOf(value: number, thresholds: [number, number]): number {
  if (value < thresholds[0]) return 0;
  if (value < thresholds[1]) return 1;
  return 2;
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
  const byGameTeam = teamGameStats ? new Map(teamGameStats.map((s) => [`${s.gameId}|${s.team}`, s])) : null;
  if (byGameTeam) {
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

  // Opponent-adjusted offense/defense: bucket every team-game this season
  // into thirds by the OPPONENT's pregame Elo (league-wide), find the
  // league-average output within each bucket, then compare each team's own
  // games to the bucket their opponent fell in — not just a flat per-game
  // average, so racking up points/yards against weak opponents doesn't look
  // the same as doing it against strong ones.
  const pointsEntries: { team: string; pointsFor: number; oppElo: number }[] = [];
  const yardsEntries: { team: string; yards: number; oppElo: number }[] = [];
  for (const [team, history] of ratingHistory) {
    for (const g of history) {
      if (g.season !== currentSeason) continue;
      pointsEntries.push({ team, pointsFor: g.pointsFor, oppElo: g.opponentRatingBefore });
      const s = byGameTeam?.get(`${g.gameId ?? ""}|${team}`);
      if (s) yardsEntries.push({ team, yards: s.totalYards, oppElo: g.opponentRatingBefore });
    }
  }

  const pointsThresholds = pointsEntries.length >= 6 ? tercileThresholds(pointsEntries.map((e) => e.oppElo)) : null;
  const yardsThresholds = yardsEntries.length >= 6 ? tercileThresholds(yardsEntries.map((e) => e.oppElo)) : null;

  const leagueAvg = (entries: { value: number; oppElo: number }[], thresholds: [number, number]) => {
    const sums = [0, 0, 0];
    const counts = [0, 0, 0];
    for (const e of entries) {
      const b = bucketOf(e.oppElo, thresholds);
      sums[b] += e.value;
      counts[b]++;
    }
    return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : s));
  };
  const pointsLeagueAvg = pointsThresholds ? leagueAvg(pointsEntries.map((e) => ({ value: e.pointsFor, oppElo: e.oppElo })), pointsThresholds) : null;
  const yardsLeagueAvg = yardsThresholds ? leagueAvg(yardsEntries.map((e) => ({ value: e.yards, oppElo: e.oppElo })), yardsThresholds) : null;

  const ratingsByTeam = new Map<string, { offPts: number[]; defPts: number[]; offYds: number[]; defYds: number[] }>();
  const ratingsFor = (team: string) => {
    let r = ratingsByTeam.get(team);
    if (!r) {
      r = { offPts: [], defPts: [], offYds: [], defYds: [] };
      ratingsByTeam.set(team, r);
    }
    return r;
  };
  if (pointsThresholds && pointsLeagueAvg) {
    for (const [team, history] of ratingHistory) {
      for (const g of history) {
        if (g.season !== currentSeason) continue;
        const bucket = bucketOf(g.opponentRatingBefore, pointsThresholds);
        const expected = pointsLeagueAvg[bucket];
        const r = ratingsFor(team);
        r.offPts.push(g.pointsFor - expected);
        r.defPts.push(expected - g.pointsAgainst);
      }
    }
  }
  if (yardsThresholds && yardsLeagueAvg && byGameTeam) {
    for (const [team, history] of ratingHistory) {
      for (const g of history) {
        if (g.season !== currentSeason) continue;
        const ownStat = byGameTeam.get(`${g.gameId ?? ""}|${team}`);
        const oppStat = byGameTeam.get(`${g.gameId ?? ""}|${g.opponent}`);
        if (!ownStat || !oppStat) continue;
        const bucket = bucketOf(g.opponentRatingBefore, yardsThresholds);
        const expected = yardsLeagueAvg[bucket];
        const r = ratingsFor(team);
        r.offYds.push(ownStat.totalYards - expected);
        r.defYds.push(expected - oppStat.totalYards);
      }
    }
  }
  const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

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
      offenseRating: avg(ratingsByTeam.get(team)?.offPts ?? []),
      defenseRating: avg(ratingsByTeam.get(team)?.defPts ?? []),
      offenseYardsRating: byGameTeam ? avg(ratingsByTeam.get(team)?.offYds ?? []) : null,
      defenseYardsRating: byGameTeam ? avg(ratingsByTeam.get(team)?.defYds ?? []) : null,
      // placeholder — assigned below once every row exists, independent of `rows`' own sort order.
      offenseRank: 0,
      defenseRank: 0,
    });
  }

  [...rows].sort((a, b) => b.offenseRating - a.offenseRating).forEach((r, i) => (r.offenseRank = i + 1));
  [...rows].sort((a, b) => b.defenseRating - a.defenseRating).forEach((r, i) => (r.defenseRank = i + 1));

  rows.sort((a, b) => b.elo - a.elo);

  return { rows, hasTeamStats, showEpa, currentSeason };
}
