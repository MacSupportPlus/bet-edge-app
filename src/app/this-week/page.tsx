import { WeeklyEdges } from "@/components/WeeklyEdges";

export default function ThisWeekPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <WeeklyEdges />
    </div>
  );
}
