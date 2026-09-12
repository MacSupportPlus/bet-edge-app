import { PropsEdgeFinder } from "@/components/PropsEdgeFinder";

export default function PropsNflPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <PropsEdgeFinder sport="nfl" />
    </div>
  );
}
