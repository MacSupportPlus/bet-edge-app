"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/research", label: "Matchup" },
  { href: "/team", label: "Team" },
  { href: "/player", label: "Player" },
  { href: "/games", label: "Games" },
  { href: "/this-week", label: "This Week" },
  { href: "/rankings", label: "Rankings" },
  { href: "/props", label: "Props" },
];

/** Secondary tab strip shared by every page under the Research family (matchup/team/player/games/this-week/rankings/props) — these used to be separate top-level nav destinations; now they're one destination with real sub-navigation, via the (research) route group's layout. */
export function ResearchSubNav() {
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
