import { PicksPage } from "@/components/PicksPage";

export default function PicksCfbPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <PicksPage sport="cfb" />
    </div>
  );
}
