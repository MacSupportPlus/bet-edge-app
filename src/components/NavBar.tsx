"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/guide", label: "Guide" },
  { href: "/this-week", label: "This Week" },
  { href: "/", label: "Edge Calculator" },
  { href: "/simulator", label: "Risk of Ruin" },
  { href: "/tracker", label: "Bankroll Tracker" },
  { href: "/model", label: "Probability Model" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b px-3 py-3 sm:px-6"
      style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
    >
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors"
            style={{
              color: active ? "white" : "var(--text-secondary)",
              background: active ? "var(--series-1)" : "transparent",
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
