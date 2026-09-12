import { Suspense } from "react";
import { TeamPage } from "@/components/TeamPage";

export default function Team() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <Suspense fallback={null}>
        <TeamPage />
      </Suspense>
    </div>
  );
}
