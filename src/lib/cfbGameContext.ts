/**
 * CFB-only situational context from cfb_schedules' own columns (see
 * prepare-data.mjs's CFB_CONTEXT_SCHEMA) — a conference-game flag, and
 * cfbfastR's own independently-computed pregame Elo as a free sanity check
 * against this app's own Elo engine (elo.ts). CFB's schedule has no
 * rest-days/weather columns like NFL's does; see gameContext.ts for that.
 */

export interface CfbGameContext {
  conferenceGame: boolean;
  homePregameElo: number | null;
  awayPregameElo: number | null;
}

type RawCfbContextRow = [string, boolean, number | null, number | null];

interface RawCfbContextDataset {
  schema: string[];
  rows: RawCfbContextRow[];
}

/** Fetches public/data/cfb-game-context.json and shapes it into a gameId -> CfbGameContext map. */
export async function loadCfbGameContext(): Promise<Map<string, CfbGameContext>> {
  const res = await fetch(`/data/cfb-game-context.json`);
  if (!res.ok) throw new Error(`Failed to load CFB game context: ${res.status}`);
  const raw: RawCfbContextDataset = await res.json();
  return new Map(
    raw.rows.map(([gameId, conferenceGame, homePregameElo, awayPregameElo]) => [
      gameId,
      { conferenceGame, homePregameElo, awayPregameElo },
    ]),
  );
}
