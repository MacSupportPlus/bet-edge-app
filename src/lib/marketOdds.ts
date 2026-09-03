/**
 * Real historical sportsbook moneylines (see prepare-data.mjs), keyed by
 * gameId — lets the Probability Model backtest price a bet at what the
 * market actually offered instead of always assuming standard -110 both
 * sides. Coverage is partial (NFL: nflverse's own archive, 2006+; CFB:
 * backfilled from cfbfastR's betting-lines archive, mostly 2020+), so most
 * callers should treat a missing entry as "fall back to the synthetic odds",
 * not as an error.
 */

import { Sport } from "./espn";

export interface MarketOdds {
  homeMoneyline: number;
  awayMoneyline: number;
}

interface RawMarketOddsDataset {
  schema: string[];
  rows: [string, number, number][];
}

/** Fetches public/data/{sport}-market-odds.json and shapes it into a gameId -> MarketOdds map. */
export async function loadMarketOdds(sport: Sport): Promise<Map<string, MarketOdds>> {
  const res = await fetch(`/data/${sport}-market-odds.json`);
  if (!res.ok) throw new Error(`Failed to load market odds: ${res.status}`);
  const raw: RawMarketOddsDataset = await res.json();
  return new Map(raw.rows.map(([gameId, homeMoneyline, awayMoneyline]) => [gameId, { homeMoneyline, awayMoneyline }]));
}
