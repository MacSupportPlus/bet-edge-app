import { WeeklyEdges } from "@/components/WeeklyEdges";

export default function ThisWeekCfbPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <WeeklyEdges sport="cfb" />
    </div>
  );
}
