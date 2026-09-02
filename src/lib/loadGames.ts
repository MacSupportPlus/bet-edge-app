import { Game } from "./elo";

interface RawDataset {
  schema: string[];
  games: [string | null, string, number, string, string, number, number, boolean][];
}

/** Fetches one of the prebuilt public/data/*.json files and shapes it into Game[]. */
export async function loadGames(dataset: "nfl" | "cfb"): Promise<Game[]> {
  const res = await fetch(`/data/${dataset}-games.json`);
  if (!res.ok) throw new Error(`Failed to load ${dataset} game data: ${res.status}`);
  const raw: RawDataset = await res.json();
  return raw.games.map(([gameId, date, season, homeTeam, awayTeam, homeScore, awayScore, neutral]) => ({
    gameId: gameId ?? undefined,
    date,
    season,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    neutral,
  }));
}
