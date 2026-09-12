/**
 * Real historical CFB spread and total lines (see prepare-data.mjs's
 * prepareCfbSpreadTotalLines) — the actual raw material for backtesting a
 * spread/total model, and for the situational trends engine. Spread
 * coverage is meaningfully worse than total coverage (spread rows are keyed
 * by team abbreviation, which is ambiguous before ~2020; total rows are
 * keyed by "over"/"under" instead, with no such ambiguity).
 */

export interface CfbMarketLines {
  /** Positive = home favored, negative = away favored — same convention as NFL's spreadLine (gameContext.ts). */
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  openHomeSpread: number | null;
  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  openTotalLine: number | null;
}

type RawCfbMarketLinesRow = [
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

interface RawCfbMarketLinesDataset {
  schema: string[];
  rows: RawCfbMarketLinesRow[];
}

/** Fetches public/data/cfb-market-lines.json and shapes it into a gameId -> CfbMarketLines map. */
export async function loadCfbMarketLines(): Promise<Map<string, CfbMarketLines>> {
  const res = await fetch(`/data/cfb-market-lines.json`);
  if (!res.ok) throw new Error(`Failed to load CFB market lines: ${res.status}`);
  const raw: RawCfbMarketLinesDataset = await res.json();
  return new Map(
    raw.rows.map(([gameId, homeSpread, homeSpreadOdds, awaySpreadOdds, openHomeSpread, totalLine, overOdds, underOdds, openTotalLine]) => [
      gameId,
      { homeSpread, homeSpreadOdds, awaySpreadOdds, openHomeSpread, totalLine, overOdds, underOdds, openTotalLine },
    ]),
  );
}
