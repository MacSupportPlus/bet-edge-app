import Link from "next/link";

const SPORTS = [
  {
    href: "/this-week/cfb",
    label: "College Football",
    description: "FBS games, live odds, Elo-based edges — plus a report card grading last week's calls.",
  },
  {
    href: "/this-week/nfl",
    label: "NFL",
    description: "Elo + real team-stat features (yards, turnover margin, offensive efficiency), same as the Model tab.",
  },
];

export default function ThisWeekHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          This Week
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick a sport. Each one pulls this week&apos;s upcoming games and live odds automatically
          and shows only the ones with a positive-EV edge. More sports (college basketball, NBA,
          maybe MLB) are planned — this page is where they&apos;ll show up as they&apos;re added.
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
