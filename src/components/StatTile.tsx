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
      className="min-w-0 rounded-lg border px-3 py-2 sm:px-4 sm:py-3"
      style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
    >
      <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-balance break-words text-lg font-semibold sm:text-2xl" style={{ color: valueColor }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-balance break-words text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
