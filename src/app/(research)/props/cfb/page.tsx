import { PropsEdgeFinder } from "@/components/PropsEdgeFinder";

export default function PropsCfbPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <PropsEdgeFinder sport="cfb" />
    </div>
  );
}
