import { RankingsPage } from "@/components/RankingsPage";

export default function RankingsCfbPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <RankingsPage sport="cfb" />
    </div>
  );
}
