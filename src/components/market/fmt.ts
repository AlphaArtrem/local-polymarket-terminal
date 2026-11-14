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

/** "Next CEO of NVIDIA?" -> "NC": up to two leading letters for the event tile when there is no image. */
export function initials(title: string): string {
  const words = title.match(/[A-Za-z0-9]+/g) ?? [];
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return letters || "?";
}

/** Move over a window as the strip shows it: "+0.6¢ (7.6%)". Inputs are 0..1 prices. */
export function changeText(first: number, last: number): { text: string; tone: "pos" | "neg" | "flat" } {
  const move = Math.round((last - first) * 1000) / 10;
  const tone = move > 0 ? "pos" : move < 0 ? "neg" : "flat";
  const sign = move > 0 ? "+" : move < 0 ? "-" : "";
  const percent = first > 0 ? ` (${sign}${Math.abs(Math.round(((last - first) / first) * 1000) / 10)}%)` : "";
  return { text: `${sign}${Math.abs(move)}¢${percent}`, tone };
}

/** Whole-dollar total for a book level, with separators. */
export function wholeUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** "0.0765" -> 7.65 (percent, clamped 0-100) for probability bars. */
export function pct(price: string | null | undefined): number {
  const n = Number(price);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n * 100)) : 0;
}
