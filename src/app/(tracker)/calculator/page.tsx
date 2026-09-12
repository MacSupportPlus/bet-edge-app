import { EdgeCalculator } from "@/components/EdgeCalculator";

export default function CalculatorPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <EdgeCalculator />
    </div>
  );
}
