import { SituationalTrends } from "@/components/SituationalTrends";

export default function TrendsNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <SituationalTrends sport="nfl" />
    </div>
  );
}
