/**
 * A personal "trends I've found" list — localStorage-backed, same pattern
 * as favorites.ts. Scoped to one browser/user for now by design (no shared
 * feed yet — that needs a real backend this static app doesn't have; a
 * personal save list needs none). Covers all three trend flavors this app
 * produces: a curated Situation, a per-team preset (teamTrendPresets.ts),
 * and an ad-hoc "Build Your Own" combo — the last two are structurally the
 * same thing (a CustomFilters combo), so both are stored as "custom".
 */

import { CustomFilters } from "./customTrends";
import { Sport } from "./espn";

export type SavedTrendDescriptor = { kind: "curated"; sport: Sport; situationId: string } | { kind: "custom"; sport: Sport; label: string; filters: CustomFilters };

export interface SavedTrend {
  id: string;
  savedAt: string;
  descriptor: SavedTrendDescriptor;
}

export const SAVED_TRENDS_KEY = "trends:saved";

function descriptorEquals(a: SavedTrendDescriptor, b: SavedTrendDescriptor): boolean {
  if (a.kind !== b.kind || a.sport !== b.sport) return false;
  if (a.kind === "curated" && b.kind === "curated") return a.situationId === b.situationId;
  if (a.kind === "custom" && b.kind === "custom") return JSON.stringify(a.filters) === JSON.stringify(b.filters);
  return false;
}

export function isTrendSaved(saved: SavedTrend[], descriptor: SavedTrendDescriptor): boolean {
  return saved.some((s) => descriptorEquals(s.descriptor, descriptor));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function toggleSavedTrend(saved: SavedTrend[], descriptor: SavedTrendDescriptor): SavedTrend[] {
  if (isTrendSaved(saved, descriptor)) return saved.filter((s) => !descriptorEquals(s.descriptor, descriptor));
  return [...saved, { id: newId(), savedAt: new Date().toISOString(), descriptor }];
}

export function removeSavedTrend(saved: SavedTrend[], id: string): SavedTrend[] {
  return saved.filter((s) => s.id !== id);
}
