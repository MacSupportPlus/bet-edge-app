import { GamesBrowser } from "@/components/GamesBrowser";

export default function CfbGamesPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <GamesBrowser sport="cfb" />
    </div>
  );
}
