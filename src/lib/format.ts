export function currency(n: number, maximumFractionDigits = 0): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits });
}
