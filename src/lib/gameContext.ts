/**
 * NFL-only situational/market context that nflverse's games.csv already
 * carries but the app used to discard (see prepare-data.mjs's
 * NFL_CONTEXT_SCHEMA comment for the verified column definitions/sign
 * conventions). CFB has no equivalent rest-days/weather columns; see
 * cfbGameContext.ts for what it does have instead.
 */

export interface NflGameContext {
  /** Positive = home favored by this many points, negative = away favored — lines up directly with (homeScore - awayScore), per nflreadr's own data dictionary. */
  spreadLine: number | null;
  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  awayRest: number | null;
  homeRest: number | null;
  divGame: boolean;
  roof: string | null;
  surface: string | null;
  /** Null for dome/closed-roof games — nflverse leaves it blank rather than 0. */
  temp: number | null;
  wind: number | null;
  awayQbName: string | null;
  homeQbName: string | null;
}

type RawNflContextRow = [
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  boolean,
  string | null,
  string | null,
  number | null,
  number | null,
  string | null,
  string | null,
];

interface RawNflContextDataset {
  schema: string[];
  rows: RawNflContextRow[];
}

/** Fetches public/data/nfl-game-context.json and shapes it into a gameId -> NflGameContext map. */
export async function loadNflGameContext(): Promise<Map<string, NflGameContext>> {
  const res = await fetch(`/data/nfl-game-context.json`);
  if (!res.ok) throw new Error(`Failed to load NFL game context: ${res.status}`);
  const raw: RawNflContextDataset = await res.json();
  return new Map(
    raw.rows.map(
      ([
        gameId,
        spreadLine,
        totalLine,
        overOdds,
        underOdds,
        awayRest,
        homeRest,
        divGame,
        roof,
        surface,
        temp,
        wind,
        awayQbName,
        homeQbName,
      ]) => [
        gameId,
        { spreadLine, totalLine, overOdds, underOdds, awayRest, homeRest, divGame, roof, surface, temp, wind, awayQbName, homeQbName },
      ],
    ),
  );
}
