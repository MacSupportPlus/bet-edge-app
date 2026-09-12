"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/research", label: "Research", groupPrefixes: ["/research", "/team", "/player", "/games", "/this-week", "/rankings", "/props", "/players"] },
  { href: "/trends", label: "Trends" },
  { href: "/tracker", label: "Tracker", groupPrefixes: ["/tracker", "/simulator", "/calculator"] },
  { href: "/guide", label: "Guide" },
];

function isActive(pathname: string, link: (typeof LINKS)[number]): boolean {
  if (link.href === "/") return pathname === "/";
  const prefixes = link.groupPrefixes ?? [link.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b px-3 py-3 sm:px-6"
      style={{ borderColor: "var(--card-border)", background: "var(--card-bg)" }}
    >
      {LINKS.map((link) => {
        const active = isActive(pathname, link);
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
