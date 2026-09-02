/**
 * Matches a live team name from ESPN's API against the team-name strings
 * used in our historical Elo dataset, so a prediction for an upcoming game
 * only gets made when we're confident it's the same team — a silent
 * mismatch here would mean showing a false, confidently-wrong edge, which
 * is worse than showing no prediction at all.
 */

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
