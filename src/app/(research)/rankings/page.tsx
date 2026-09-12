import Link from "next/link";

const SPORTS = [
  {
    href: "/rankings/cfb",
    label: "College Football",
    description: "FBS teams ranked by current Elo — plus season-stat leaderboards and biggest risers/fallers.",
  },
  {
    href: "/rankings/nfl",
    label: "NFL",
    description: "All 32 teams ranked by current Elo — plus season-stat leaderboards and biggest risers/fallers.",
  },
];

export default function RankingsHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Rankings
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick a sport. Every team ranked by current Elo, sortable by any of the same season stats
          the model trains on, with how far each team&apos;s rating has moved since their first
          game this season.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SPORTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-[var(--series-1)]"
            style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {s.label} →
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {s.description}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
