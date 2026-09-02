import { WeeklyEdges } from "@/components/WeeklyEdges";

export default function ThisWeekNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <WeeklyEdges sport="nfl" />
    </div>
  );
}
