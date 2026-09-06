import Link from "next/link";

const SPORTS = [
  {
    href: "/players/cfb",
    label: "College Football",
    description: "QB rankings, opponent-adjusted — same method as the team offense/defense board.",
  },
  {
    href: "/players/nfl",
    label: "NFL",
    description: "QB rankings, opponent-adjusted — same method as the team offense/defense board.",
  },
];

export default function PlayerRankingsHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Player Rankings
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Pick a sport. QB only for now — see each sport&apos;s page for why the other positions
          aren&apos;t ranked the same way.
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
