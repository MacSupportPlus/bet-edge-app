import { Suspense } from "react";
import { GameResearch } from "@/components/GameResearch";

export default function ResearchPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <Suspense fallback={null}>
        <GameResearch />
      </Suspense>
    </div>
  );
}
