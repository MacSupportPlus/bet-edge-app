/**
 * The "Build Your Own" side of Trends — an open-ended filter combination
 * over the same TrendGameRecord archive situationalTrends.ts uses, for
 * anyone who wants to test their own situational theory instead of picking
 * from the curated list.
 *
 * This is exactly the kind of query builder situationalTrends.ts's own
 * docstring warns against (multiple-comparisons/p-hacking risk from
 * unlimited filter combinations) — kept in a separate file so that
 * curated engine's design intent stays honest, and made safe the same way
 * Bet Labs-style tools should but often don't: every custom result is run
 * through computeSituationStats UNCHANGED, so the same MIN_TRUSTED_SAMPLE
 * gate applies with no opt-out. A thin, noisy custom filter still shows
 * "small sample," not a false signal.
 */

import { favoriteSide, Situation, TrendGameRecord } from "./situationalTrends";

export type TriState = "any" | "yes" | "no";
export type RoleFilter = "any" | "favorite" | "underdog";
export type LocationFilter = "any" | "home" | "away";
export type RestFilter = "any" | "short" | "extra";
export type RoofFilter = "any" | "dome" | "outdoor";
export type WeatherFilter = "any" | "cold" | "wind";

export interface CustomFilters {
  /** Scope to one team's own games (either side) — null means "either team, either side," matching how the curated situations work. */
  team: string | null;
  role: RoleFilter;
  location: LocationFilter;
  divisionGame: TriState;
  rest: RestFilter;
  roof: RoofFilter;
  weather: WeatherFilter;
}

export const DEFAULT_CUSTOM_FILTERS: CustomFilters = {
  team: null,
  role: "any",
  location: "any",
  divisionGame: "any",
  rest: "any",
  roof: "any",
  weather: "any",
};

function teamSide(r: TrendGameRecord, team: string): "home" | "away" | null {
  if (r.homeTeam === team) return "home";
  if (r.awayTeam === team) return "away";
  return null;
}

function roleMatches(r: TrendGameRecord, side: "home" | "away", role: RoleFilter): boolean {
  if (role === "any") return true;
  const fav = favoriteSide(r);
  if (fav === null) return false;
  return role === "favorite" ? fav === side : fav !== side;
}

function locationMatches(side: "home" | "away", location: LocationFilter): boolean {
  return location === "any" || location === side;
}

function restMatches(r: TrendGameRecord, side: "home" | "away" | null, rest: RestFilter): boolean {
  if (rest === "any") return true;
  if (side) {
    const v = side === "home" ? r.homeRest : r.awayRest;
    if (v === null) return false;
    return rest === "short" ? v <= 6 : v >= 9;
  }
  const shortOk = (r.homeRest !== null && r.homeRest <= 6) || (r.awayRest !== null && r.awayRest <= 6);
  const extraOk = (r.homeRest !== null && r.homeRest >= 9) || (r.awayRest !== null && r.awayRest >= 9);
  return rest === "short" ? shortOk : extraOk;
}

function roofMatches(r: TrendGameRecord, roof: RoofFilter): boolean {
  if (roof === "any") return true;
  const isDome = r.roof === "dome" || r.roof === "closed";
  return roof === "dome" ? isDome : !isDome;
}

function weatherMatches(r: TrendGameRecord, weather: WeatherFilter): boolean {
  if (weather === "any") return true;
  if (weather === "cold") return r.temp !== null && r.temp < 40;
  return r.wind !== null && r.wind > 15;
}

function divisionMatches(r: TrendGameRecord, divisionGame: TriState): boolean {
  if (divisionGame === "any") return true;
  return r.divisionGame === (divisionGame === "yes");
}

function sideQualifies(r: TrendGameRecord, side: "home" | "away", filters: CustomFilters): boolean {
  return (
    locationMatches(side, filters.location) &&
    roleMatches(r, side, filters.role) &&
    divisionMatches(r, filters.divisionGame) &&
    restMatches(r, side, filters.rest) &&
    roofMatches(r, filters.roof) &&
    weatherMatches(r, filters.weather)
  );
}

/** Builds a one-off Situation from arbitrary filter selections, fed straight into the existing computeSituationStats — no separate math path for custom vs. curated results. */
export function buildCustomSituation(filters: CustomFilters): Situation {
  return {
    id: "custom",
    label: "Custom",
    sports: ["nfl", "cfb"],
    atsSides: (r) => {
      if (filters.team) {
        const side = teamSide(r, filters.team);
        return side && sideQualifies(r, side, filters) ? [side] : [];
      }
      return (["home", "away"] as const).filter((side) => sideQualifies(r, side, filters));
    },
    qualifiesForTotal: (r) => {
      if (filters.team) {
        const side = teamSide(r, filters.team);
        return side !== null && sideQualifies(r, side, filters);
      }
      return (["home", "away"] as const).some((side) => sideQualifies(r, side, filters));
    },
  };
}
