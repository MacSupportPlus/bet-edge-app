import Link from "next/link";

const SPORTS = [
  {
    href: "/games/cfb",
    label: "College Football",
    description: "Every FBS game this season, played or upcoming — browse or filter to one team, then jump into Research.",
  },
  {
    href: "/games/nfl",
    label: "NFL",
    description: "Every NFL game this season, played or upcoming — browse or filter to one team, then jump into Research.",
  },
];

export default function GamesHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          All Games
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick a sport. The full season schedule is here — not just the games the model happens to
          flag — so you can research any matchup you want.
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
