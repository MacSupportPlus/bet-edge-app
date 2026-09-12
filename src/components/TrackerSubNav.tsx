"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/tracker", label: "Bets & CLV" },
  { href: "/simulator", label: "Risk of Ruin" },
  { href: "/calculator", label: "Edge Calculator" },
];

/** Secondary tab strip shared by the Tracker family (bet log/CLV, Monte Carlo risk-of-ruin sizing, and the manual EV/Kelly calculator) — all bankroll-and-staking tools, one destination now instead of three, via the (tracker) route group's layout. */
export function TrackerSubNav() {
  const pathname = usePathname();
  return (
    <div className="border-b" style={{ borderColor: "var(--card-border)", background: "var(--background)" }}>
      <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors"
              style={{
                borderColor: active ? "var(--series-1)" : "var(--card-border)",
                background: active ? "var(--series-1)" : "transparent",
                color: active ? "white" : "var(--text-secondary)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
