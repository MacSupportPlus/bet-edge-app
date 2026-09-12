import { describe, expect, it } from "vitest";
import {
  FavoritePlayer,
  FavoriteTeam,
  isFavoritePlayer,
  isFavoriteTeam,
  toggleFavoritePlayer,
  toggleFavoriteTeam,
} from "./favorites";

describe("favorite teams", () => {
  it("is not a favorite by default", () => {
    expect(isFavoriteTeam([], "nfl", "SEA")).toBe(false);
  });

  it("toggling adds a team not already favorited", () => {
    const result = toggleFavoriteTeam([], "nfl", "SEA");
    expect(result).toEqual([{ sport: "nfl", team: "SEA" }]);
    expect(isFavoriteTeam(result, "nfl", "SEA")).toBe(true);
  });

  it("toggling removes a team already favorited", () => {
    const existing: FavoriteTeam[] = [{ sport: "nfl", team: "SEA" }];
    const result = toggleFavoriteTeam(existing, "nfl", "SEA");
    expect(result).toEqual([]);
  });

  it("keeps the same team name distinct across sports", () => {
    const existing: FavoriteTeam[] = [{ sport: "nfl", team: "Miami" }];
    expect(isFavoriteTeam(existing, "cfb", "Miami")).toBe(false);
    const result = toggleFavoriteTeam(existing, "cfb", "Miami");
    expect(result).toHaveLength(2);
  });
});

describe("favorite players", () => {
  it("toggling adds and removes a player", () => {
    const added = toggleFavoritePlayer([], "nfl", "Drake Maye", "NE");
    expect(added).toEqual([{ sport: "nfl", player: "Drake Maye", team: "NE" }]);
    expect(isFavoritePlayer(added, "nfl", "Drake Maye", "NE")).toBe(true);
    const removed = toggleFavoritePlayer(added, "nfl", "Drake Maye", "NE");
    expect(removed).toEqual([]);
  });

  it("distinguishes same-name players on different teams", () => {
    const existing: FavoritePlayer[] = [{ sport: "nfl", player: "Josh Allen", team: "BUF" }];
    expect(isFavoritePlayer(existing, "nfl", "Josh Allen", "MIN")).toBe(false);
  });
});
