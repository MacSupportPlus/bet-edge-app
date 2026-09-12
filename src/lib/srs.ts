/**
 * Simple Rating System (SRS) — a free "second opinion" alongside Elo, per
 * the redesign plan's ratings-ensemble idea. Unlike Elo (win/loss-driven,
 * incremental, walk-forward by construction), SRS solves directly for the
 * rating vector that makes (rating_i - rating_j) best explain every margin
 * of victory in one pass — the standard method sports-reference.com uses.
 * That makes it purely retrospective ("how good has this team actually
 * looked this season, margin-adjusted for opponent"), not a predictive
 * walk-forward model — so it's shown as a reference rating on
 * Team/Rankings pages, never fed into the win-probability model itself
 * (which still needs a rating that only ever uses games before the one
 * being predicted).
 *
 * No external data required — computed entirely from the same final
 * scores already in the historical archive, using the iterative (damped
 * Jacobi) solution to the SRS linear system: rating_i = average over i's
 * games of (margin + opponent's rating), mean-centered every iteration so
 * the system (which is otherwise only defined up to an additive constant)
 * converges to a unique, zero-mean solution. Undamped Jacobi provably
 * oscillates forever on this system (verified: a 3-team asymmetric-degree
 * case settles into a period-2 cycle, never converging) because the
 * iteration matrix has an eigenvalue at exactly -1, not just the expected
 * 0 for the constant/null direction — a 0.5 damping factor pulls that
 * eigenvalue to 0 and leaves the true solution as the only fixed point.
 *
 * Deliberately does not adjust for home field (neither does the standard
 * SRS definition) — that's the one real difference from this app's Elo,
 * which does. A team can legitimately rank differently on the two boards;
 * that disagreement is the point of a second opinion.
 */

import { Game } from "./elo";

const DEFAULT_ITERATIONS = 100;
/** Shrinks the iteration matrix's -1 eigenvalue to 0 — see module docstring. 0.5 is the standard choice for this kind of two-cycle Jacobi divergence. */
const DAMPING = 0.5;

/** Season-scoped SRS ratings for every team with at least one game that season, mean-centered (average rating across teams is exactly 0). */
export function computeSrs(games: Game[], season: number, iterations = DEFAULT_ITERATIONS): Map<string, number> {
  const seasonGames = games.filter((g) => g.season === season);
  const gamesByTeam = new Map<string, { opponent: string; margin: number }[]>();
  for (const g of seasonGames) {
    const margin = g.homeScore - g.awayScore;
    if (!gamesByTeam.has(g.homeTeam)) gamesByTeam.set(g.homeTeam, []);
    if (!gamesByTeam.has(g.awayTeam)) gamesByTeam.set(g.awayTeam, []);
    gamesByTeam.get(g.homeTeam)!.push({ opponent: g.awayTeam, margin });
    gamesByTeam.get(g.awayTeam)!.push({ opponent: g.homeTeam, margin: -margin });
  }

  let rating = new Map<string, number>([...gamesByTeam.keys()].map((t) => [t, 0]));

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const [team, played] of gamesByTeam) {
      if (played.length === 0) {
        next.set(team, 0);
        continue;
      }
      const sum = played.reduce((s, g) => s + g.margin + (rating.get(g.opponent) ?? 0), 0);
      const raw = sum / played.length;
      next.set(team, DAMPING * raw + (1 - DAMPING) * (rating.get(team) ?? 0));
    }
    const mean = [...next.values()].reduce((s, v) => s + v, 0) / next.size;
    for (const [team, v] of next) next.set(team, v - mean);
    rating = next;
  }

  return rating;
}
