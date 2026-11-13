/** Display formatting for the terminal UI. Inputs are decimal strings from the API (or numbers). */

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** $1,234.56 ; negatives as -$1,234.56 ; unavailable as an em dash. */
export function formatUsd(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return n === null ? "—" : usd.format(n);
}

/** Signed dollars for PnL: +$1.20 / -$3.00. */
export function formatSignedUsd(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${usd.format(n)}`;
}

/** Probability price 0..1 as cents like the website: 0.13 -> 13.0¢. */
export function formatCents(price: string | number | null | undefined): string {
  const n = toNumber(price);
  return n === null ? "—" : `${(n * 100).toFixed(1)}¢`;
}

/** Share counts: up to 2 decimals, thousands separators. */
export function formatShares(size: string | number | null | undefined): string {
  const n = toNumber(size);
  return n === null
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Percent with sign: 12.3 -> +12.3%. The input is already a percentage. */
export function formatPercent(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** "pos" | "neg" | "flat" for colouring PnL. */
export function pnlTone(value: string | number | null | undefined): "pos" | "neg" | "flat" {
  const n = toNumber(value);
  if (n === null || n === 0) return "flat";
  return n > 0 ? "pos" : "neg";
}

/** Local `YYYY-MM-DD HH:mm` from an ISO string or epoch milliseconds. */
export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 0x1234…abcd */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
