/**
 * Adapters from each sport's own data sources into situationalTrends.ts's
 * sport-agnostic TrendGameRecord shape — kept separate from
 * situationalTrends.ts itself so that module's core logic stays free of
 * any sport-specific data-loading concerns.
 */

import { Game } from "./elo";
import { CfbGameContext } from "./cfbGameContext";
import { CfbMarketLines } from "./cfbMarketLines";
import { NflGameContext } from "./gameContext";
import { TrendGameRecord } from "./situationalTrends";

export function buildNflTrendRecords(games: Game[], context: Map<string, NflGameContext>): TrendGameRecord[] {
  const records: TrendGameRecord[] = [];
  for (const g of games) {
    if (!g.gameId) continue;
    const ctx = context.get(g.gameId);
    records.push({
      gameId: g.gameId,
      date: g.date,
      season: g.season,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      spreadLine: ctx?.spreadLine ?? null,
      totalLine: ctx?.totalLine ?? null,
      homeRest: ctx?.homeRest ?? null,
      awayRest: ctx?.awayRest ?? null,
      divisionGame: ctx?.divGame ?? null,
      roof: ctx?.roof ?? null,
      temp: ctx?.temp ?? null,
      wind: ctx?.wind ?? null,
    });
  }
  return records;
}

export function buildCfbTrendRecords(
  games: Game[],
  marketLines: Map<string, CfbMarketLines>,
  context: Map<string, CfbGameContext>,
): TrendGameRecord[] {
  const records: TrendGameRecord[] = [];
  for (const g of games) {
    if (!g.gameId) continue;
    const lines = marketLines.get(g.gameId);
    const ctx = context.get(g.gameId);
    records.push({
      gameId: g.gameId,
      date: g.date,
      season: g.season,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      spreadLine: lines?.homeSpread ?? null,
      totalLine: lines?.totalLine ?? null,
      homeRest: null,
      awayRest: null,
      divisionGame: ctx?.conferenceGame ?? null,
      roof: null,
      temp: null,
      wind: null,
    });
  }
  return records;
}
