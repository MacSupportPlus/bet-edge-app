/**
 * A curated battery of angles to run automatically for a single team, once
 * selected — the "more per-team trends" idea: instead of making a visitor
 * build one combination at a time, show every angle that's actually
 * interesting for that team in one pass. Each preset is just a CustomFilters
 * combo missing `team` (filled in by buildTeamTrendSituation) — reuses
 * customTrends.ts's exact math, so a per-team trend is held to the same
 * MIN_TRUSTED_SAMPLE gate as everything else, no separate code path.
 */

import { CustomFilters, DEFAULT_CUSTOM_FILTERS } from "./customTrends";
import { Sport } from "./espn";

export interface TeamTrendPreset {
  id: string;
  label: string;
  sports: Sport[];
  filters: Partial<Omit<CustomFilters, "team">>;
}

export const TEAM_TREND_PRESETS: TeamTrendPreset[] = [
  { id: "home", label: "At home", sports: ["nfl", "cfb"], filters: { location: "home" } },
  { id: "away", label: "On the road", sports: ["nfl", "cfb"], filters: { location: "away" } },
  { id: "favorite", label: "As the favorite", sports: ["nfl", "cfb"], filters: { role: "favorite" } },
  { id: "underdog", label: "As the underdog", sports: ["nfl", "cfb"], filters: { role: "underdog" } },
  { id: "home-favorite", label: "Home favorite", sports: ["nfl", "cfb"], filters: { location: "home", role: "favorite" } },
  { id: "home-underdog", label: "Home underdog", sports: ["nfl", "cfb"], filters: { location: "home", role: "underdog" } },
  { id: "away-favorite", label: "Road favorite", sports: ["nfl", "cfb"], filters: { location: "away", role: "favorite" } },
  { id: "away-underdog", label: "Road underdog", sports: ["nfl", "cfb"], filters: { location: "away", role: "underdog" } },
  { id: "division", label: "Division/conference games", sports: ["nfl", "cfb"], filters: { divisionGame: "yes" } },
  { id: "non-division", label: "Non-division/conference games", sports: ["nfl", "cfb"], filters: { divisionGame: "no" } },
  { id: "short-rest", label: "On short rest (≤6 days)", sports: ["nfl"], filters: { rest: "short" } },
  { id: "extra-rest", label: "On extra rest (≥9 days)", sports: ["nfl"], filters: { rest: "extra" } },
];

/** The full CustomFilters for one team + one preset — ready to pass straight into buildCustomSituation. */
export function teamPresetFilters(team: string, preset: TeamTrendPreset): CustomFilters {
  return { ...DEFAULT_CUSTOM_FILTERS, ...preset.filters, team };
}
