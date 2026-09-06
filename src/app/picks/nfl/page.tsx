import { PicksPage } from "@/components/PicksPage";

export default function PicksNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <PicksPage sport="nfl" />
    </div>
  );
}
