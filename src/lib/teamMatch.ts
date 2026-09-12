/**
 * Matches a live team name from ESPN's API against the team-name strings
 * used in our historical Elo dataset, so a prediction for an upcoming game
 * only gets made when we're confident it's the same team — a silent
 * mismatch here would mean showing a false, confidently-wrong edge, which
 * is worse than showing no prediction at all.
 */

import { Sport, UpcomingGame } from "./espn";

// Unicode "combining diacritical marks" block, written as an escape (not a
// literal character) so this source file stays plain ASCII.
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "") // strip diacritics (e.g. é -> e)
    .toLowerCase()
    .replace(/['.]/g, "") // drop entirely, not as a separator: "Hawai'i" == "Hawaii"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * ESPN's team name/abbreviation -> our historical dataset's team-name
 * string, for the specific mismatches found by hand (not guessed).
 *
 * CFB entries key off ESPN's `location` field (both datasets use full
 * school names): renamed schools, abbreviation-vs-full-name differences,
 * and a couple of long-form vs. short-form conference names.
 *
 * NFL entries key off ESPN's `abbreviation` field instead (both datasets
 * use nflverse-style short codes, which match exactly for 30 of 32 teams —
 * these two are ESPN's real divergences: it uses "LAR"/"WSH" where
 * nflverse uses "LA"/"WAS").
 */
export const ESPN_TEAM_ALIASES: Record<string, string> = {
  "App State": "Appalachian State",
  "Sam Houston": "Sam Houston State",
  "Southern Miss": "Southern Mississippi",
  "East Texas A&M": "Texas A&M-Commerce",
  Massachusetts: "UMass",
  UTSA: "UT San Antonio",
  UConn: "Connecticut",
  "UL Monroe": "Louisiana Monroe",
  LAR: "LA",
  WSH: "WAS",
};

/**
 * Returns the matching team name from `knownTeams` for a live `espnName`,
 * or null if there's no confident match (e.g. a team with no games in our
 * historical dataset, or a name that doesn't resolve via the exact/alias/
 * normalized passes below).
 */
export function matchTeamName(espnName: string, knownTeams: ReadonlySet<string>): string | null {
  if (knownTeams.has(espnName)) return espnName;

  const alias = ESPN_TEAM_ALIASES[espnName];
  if (alias && knownTeams.has(alias)) return alias;

  const normalizedTarget = normalizeTeamName(espnName);
  for (const known of knownTeams) {
    if (normalizeTeamName(known) === normalizedTarget) return known;
  }

  return null;
}

/** The ESPN name to match against the historical dataset: NFL matches on abbreviation (e.g. "SEA"), CFB on the full school name. */
export function matchKeyFor(sport: Sport, game: UpcomingGame, side: "home" | "away"): string {
  if (sport === "nfl") {
    return side === "home" ? (game.homeTeamAbbr ?? game.homeTeam) : (game.awayTeamAbbr ?? game.awayTeam);
  }
  return side === "home" ? game.homeTeam : game.awayTeam;
}

/**
 * The Odds API's NFL team names (e.g. "Pittsburgh Steelers") and the
 * historical archive's own NFL naming (nflverse's short codes, e.g. "PIT")
 * have zero string overlap — bridged with a small, stable, hand-written
 * table (32 fixed entries) rather than any fuzzy matching. Kept in sync BY
 * HAND with scripts/fetch-live-odds.mjs's own copy (a standalone Node
 * script, can't import this client module directly) — same intentional
 * duplication as that script's own COMBINING_DIACRITICS comment.
 */
export const NFL_DISPLAY_NAME_TO_CODE: Record<string, string> = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

/**
 * Resolves an Odds API team name (liveOdds.ts's homeTeam/awayTeam, e.g. "Pittsburgh
 * Steelers" or "Ohio State Buckeyes") to the historical archive's own team name —
 * NFL via the fixed table above, CFB via prefix matching (the archive's plain
 * school name is always a prefix of the Odds API's "{School} {Mascot}" name).
 */
export function resolveOddsApiTeamName(sport: Sport, oddsApiName: string, knownTeams: ReadonlySet<string>): string | null {
  if (sport === "nfl") return NFL_DISPLAY_NAME_TO_CODE[oddsApiName] ?? null;
  const normalized = normalizeTeamName(oddsApiName);
  for (const known of knownTeams) {
    const normalizedKnown = normalizeTeamName(known);
    if (normalized === normalizedKnown || normalized.startsWith(`${normalizedKnown} `)) return known;
  }
  return null;
}
