/**
 * Live player-prop odds (see scripts/fetch-live-odds.mjs) — a curated set of
 * the most commonly-bet markets, pooled across every book that posts them.
 * Keyed by team DISPLAY name, same convention as liveOdds.ts.
 */

import { Sport } from "./espn";

export type PropMarket =
  | "player_pass_yds"
  | "player_rush_yds"
  | "player_reception_yds"
  | "player_receptions"
  | "player_pass_tds"
  | "player_anytime_td";

export interface PlayerPropQuote {
  market: PropMarket;
  book: string;
  player: string;
  /** Null for "anytime TD" style single-outcome markets — see yesOdds instead. */
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  /** Populated only for single-outcome ("Yes") markets like anytime TD. */
  yesOdds: number | null;
}

export interface PlayerPropsGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  props: PlayerPropQuote[];
}

interface RawPlayerPropsFile {
  fetchedAt: string;
  games: PlayerPropsGame[];
}

export interface PlayerPropsResult {
  fetchedAt: string;
  byMatchup: Map<string, PlayerPropsGame>;
}

/** Fetches public/data/{sport}-player-props.json — an empty result (not an error) if it hasn't been generated yet, or this game has no posted props. */
export async function loadPlayerProps(sport: Sport): Promise<PlayerPropsResult> {
  const res = await fetch(`/data/${sport}-player-props.json`);
  if (!res.ok) return { fetchedAt: "", byMatchup: new Map() };
  const raw: RawPlayerPropsFile = await res.json();
  return {
    fetchedAt: raw.fetchedAt,
    byMatchup: new Map(raw.games.map((g) => [`${g.homeTeam}|${g.awayTeam}`, g])),
  };
}

/** This player's best (highest payout) over/under prices for one market, and the book-consensus (median) line — mirrors liveOdds.ts's bestMoneylines/consensusSpread approach. */
export function bestPropPrice(
  props: PlayerPropQuote[],
  player: string,
  market: PropMarket,
): { line: number | null; bestOverOdds: number | null; bestUnderOdds: number | null } {
  const quotes = props.filter((p) => p.market === market && p.player === player);
  if (quotes.length === 0) return { line: null, bestOverOdds: null, bestUnderOdds: null };

  const lines = quotes.map((q) => q.line).filter((v): v is number => v !== null);
  const sortedLines = [...lines].sort((a, b) => a - b);
  const mid = Math.floor(sortedLines.length / 2);
  const line = sortedLines.length === 0 ? null : sortedLines.length % 2 === 0 ? (sortedLines[mid - 1] + sortedLines[mid]) / 2 : sortedLines[mid];

  let bestOverOdds: number | null = null;
  let bestUnderOdds: number | null = null;
  for (const q of quotes) {
    if (q.overOdds !== null && (bestOverOdds === null || q.overOdds > bestOverOdds)) bestOverOdds = q.overOdds;
    if (q.underOdds !== null && (bestUnderOdds === null || q.underOdds > bestUnderOdds)) bestUnderOdds = q.underOdds;
  }
  return { line, bestOverOdds, bestUnderOdds };
}
