import type { ReactNode } from "react";

export function Callout({ kind, children }: { kind: "tip" | "warning"; children: ReactNode }) {
  const color = kind === "tip" ? "var(--status-good)" : "var(--status-critical)";
  const label = kind === "tip" ? "Tip" : "Watch out";
  return (
    <div
      className="rounded-lg border-l-4 px-4 py-3 text-sm"
      style={{ borderColor: color, background: "var(--card-bg)", color: "var(--text-secondary)" }}
    >
      <strong style={{ color }}>{label}:</strong> {children}
    </div>
  );
}
