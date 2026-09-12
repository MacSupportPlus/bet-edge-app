/**
 * Favorites/pins — a small, dependency-free data model (localStorage via
 * useLocalStorageState, same pattern as the bet tracker) threaded through
 * the app so a starred team or player surfaces first wherever picks are
 * listed, per The Redesign Playbook's "favorites everywhere" idea.
 */

import { Sport } from "./espn";

export interface FavoriteTeam {
  sport: Sport;
  team: string; // historical archive naming (e.g. "SEA", "Ohio State")
}

export interface FavoritePlayer {
  sport: Sport;
  player: string;
  team: string; // for display context, and to disambiguate a rare same-name collision
}

export function isFavoriteTeam(favorites: FavoriteTeam[], sport: Sport, team: string): boolean {
  return favorites.some((f) => f.sport === sport && f.team === team);
}

export function toggleFavoriteTeam(favorites: FavoriteTeam[], sport: Sport, team: string): FavoriteTeam[] {
  if (isFavoriteTeam(favorites, sport, team)) return favorites.filter((f) => !(f.sport === sport && f.team === team));
  return [...favorites, { sport, team }];
}

export function isFavoritePlayer(favorites: FavoritePlayer[], sport: Sport, player: string, team: string): boolean {
  return favorites.some((f) => f.sport === sport && f.player === player && f.team === team);
}

export function toggleFavoritePlayer(favorites: FavoritePlayer[], sport: Sport, player: string, team: string): FavoritePlayer[] {
  if (isFavoritePlayer(favorites, sport, player, team)) {
    return favorites.filter((f) => !(f.sport === sport && f.player === player && f.team === team));
  }
  return [...favorites, { sport, player, team }];
}

export const FAVORITE_TEAMS_KEY = "favorites:teams";
export const FAVORITE_PLAYERS_KEY = "favorites:players";
