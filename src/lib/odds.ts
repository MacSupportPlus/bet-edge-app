/** Shared bet-input helpers used anywhere a user types American moneyline odds by hand (Edge Calculator, Research, This Week). */

export const FRACTIONAL_OPTIONS = [
  { label: "Full Kelly", value: 1 },
  { label: "½ Kelly", value: 0.5 },
  { label: "¼ Kelly", value: 0.25 },
];

export function formatMoneyline(ml: number): string {
  return ml > 0 ? `+${ml}` : `${ml}`;
}

/** Parses a manual odds input; returns null for empty/invalid rather than NaN, so callers can tell "not entered" from "entered wrong". */
export function parseMoneyline(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
