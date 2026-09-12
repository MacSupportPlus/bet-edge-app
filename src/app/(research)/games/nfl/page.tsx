import { GamesBrowser } from "@/components/GamesBrowser";

export default function NflGamesPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <GamesBrowser sport="nfl" />
    </div>
  );
}
