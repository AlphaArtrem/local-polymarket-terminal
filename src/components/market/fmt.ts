/** Display formatting for the market views. Display only: never feed these strings into orders. */

/** "0.0765" -> "7.7¢" (one decimal like the website's "13.0¢"). */
export function cents(price: string | null | undefined): string {
  if (price == null) return "-";
  const n = Number(price);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}¢` : "-";
}

export function usd(amount: string | null | undefined): string {
  if (amount == null) return "-";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "-";
  return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
}

export function shares(size: string): string {
  const n = Number(size);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : size;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
