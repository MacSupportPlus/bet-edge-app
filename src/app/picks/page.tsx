import Link from "next/link";

const SPORTS = [
  {
    href: "/picks/cfb",
    label: "College Football",
    description: "Straight-up picks, probabilities, and a season-long accuracy record — no staking math.",
  },
  {
    href: "/picks/nfl",
    label: "NFL",
    description: "Straight-up picks, probabilities, and a season-long accuracy record — no staking math.",
  },
];

export default function PicksHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10" style={{ background: "var(--background)" }}>
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Straight-Up Picks
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          A simpler view for anyone who just wants to know who the model favors, without the
          bankroll/staking side of This Week — pick a sport.
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
