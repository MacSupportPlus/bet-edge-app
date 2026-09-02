export function currency(n: number, maximumFractionDigits = 0): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits });
}

/**
 * Currency formatting that degrades gracefully for the kind of
 * astronomically large figures a long, uncapped Kelly-compounding backtest
 * can produce (Intl's "compact" notation tops out around quadrillions and
 * just prints a wall of digits beyond that). Anything at or past 1e15
 * switches to scientific notation instead.
 */
export function compactCurrency(n: number): string {
  if (Math.abs(n) < 1e15) return currency(n);
  const exp = n.toExponential(2); // e.g. "9.32e+22"
  const [mantissa, exponent] = exp.split("e");
  return `$${mantissa} × 10^${Number(exponent)}`;
}
