import Link from "next/link";

const SPORTS = [
  {
    href: "/trends/cfb",
    label: "College Football",
    description: "ATS/O-U performance by situation (favorite/dog, conference game), measured against real closing lines.",
  },
  {
    href: "/trends/nfl",
    label: "NFL",
    description: "ATS/O-U performance by situation (favorite/dog, rest, weather, division game), measured against real closing lines.",
  },
];

export default function TrendsHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Situational Trends
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick a sport. Every trend here is measured against the real closing spread/total, with
          every result labeled by sample size — no situation is sold as an edge on too few games.
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
