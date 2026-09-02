export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "critical" | "good";
}) {
  const valueColor =
    accent === "critical" ? "var(--status-critical)" : accent === "good" ? "var(--status-good)" : "var(--text-primary)";
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: valueColor }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
