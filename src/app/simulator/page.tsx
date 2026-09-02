import { RiskOfRuinSimulator } from "@/components/RiskOfRuinSimulator";

export default function SimulatorPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <RiskOfRuinSimulator />
    </div>
  );
}
