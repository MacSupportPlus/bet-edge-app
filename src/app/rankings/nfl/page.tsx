import { RankingsPage } from "@/components/RankingsPage";

export default function RankingsNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <RankingsPage sport="nfl" />
    </div>
  );
}
