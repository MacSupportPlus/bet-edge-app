import { Suspense } from "react";
import { PlayerCommandPage } from "@/components/PlayerCommandPage";

export default function Player() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <Suspense fallback={null}>
        <PlayerCommandPage />
      </Suspense>
    </div>
  );
}
