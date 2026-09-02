import { ProbabilityModel } from "@/components/ProbabilityModel";

export default function ModelPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <ProbabilityModel />
    </div>
  );
}
