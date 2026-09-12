"use client";

import { Sport } from "@/lib/espn";
import { FAVORITE_PLAYERS_KEY, FAVORITE_TEAMS_KEY, FavoritePlayer, FavoriteTeam, isFavoritePlayer, isFavoriteTeam, toggleFavoritePlayer, toggleFavoriteTeam } from "@/lib/favorites";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

type Props =
  | { kind: "team"; sport: Sport; team: string; className?: string }
  | { kind: "player"; sport: Sport; player: string; team: string; className?: string };

/** A star toggle for pinning a team or player — drop it anywhere a team/player name appears. Stops event propagation so it's safe inside a clickable row/card. */
export function FavoriteStar(props: Props) {
  const [teams, setTeams] = useLocalStorageState<FavoriteTeam[]>(FAVORITE_TEAMS_KEY, []);
  const [players, setPlayers] = useLocalStorageState<FavoritePlayer[]>(FAVORITE_PLAYERS_KEY, []);

  const active = props.kind === "team" ? isFavoriteTeam(teams, props.sport, props.team) : isFavoritePlayer(players, props.sport, props.player, props.team);

  const label = props.kind === "team" ? `${active ? "Remove" : "Add"} ${props.team} as a favorite team` : `${active ? "Remove" : "Add"} ${props.player} as a favorite player`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (props.kind === "team") setTeams((prev) => toggleFavoriteTeam(prev, props.sport, props.team));
        else setPlayers((prev) => toggleFavoritePlayer(prev, props.sport, props.player, props.team));
      }}
      className={`inline-flex shrink-0 items-center justify-center text-base leading-none transition-transform hover:scale-110 ${props.className ?? ""}`}
      style={{ color: active ? "var(--series-2)" : "var(--text-muted)" }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
