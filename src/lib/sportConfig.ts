/** Per-sport constants shared between This Week and Research so the same matchup gets the same numbers on both pages. */

import { DEFAULT_ELO_OPTIONS, EloOptions } from "./elo";
import { Sport } from "./espn";

export const SPORT_LABELS: Record<Sport, string> = { cfb: "College Football", nfl: "NFL" };

/** NFL rosters turn over far less than college's — the season-regression tune that helps CFB measurably hurts NFL's early-season calibration (see elo.ts), so NFL gets none of it here. */
export const SPORT_ELO_OPTIONS: Record<Sport, EloOptions> = {
  cfb: DEFAULT_ELO_OPTIONS,
  nfl: { ...DEFAULT_ELO_OPTIONS, seasonRegression: 0 },
};
