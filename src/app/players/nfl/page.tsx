import { PlayerRankingsPage } from "@/components/PlayerRankingsPage";

export default function PlayerRankingsNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <PlayerRankingsPage sport="nfl" />
    </div>
  );
}
