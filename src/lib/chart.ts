/** Pure chart maths for the price-history chart (no DOM, no React). */
import type { HistoryRange, PricePoint } from "./live-types";

export type Padding = { top: number; right: number; bottom: number; left: number };
export type ChartScale = {
  path: string;
  x: (t: number) => number;
  y: (p: number) => number;
  yTicks: { p: number; label: string }[];
  xTicks: { t: number; label: string }[];
};

const price = (point: PricePoint): number => {
  const n = Number(point.p);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

/**
 * Reduces `points` to at most `max` by even index sampling. The first and last points are always
 * kept, so the range start and the current price never change.
 */
export function downsample<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  if (max < 2) return points.slice(0, Math.max(0, max)); // cannot keep both endpoints
  const last = points.length - 1;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * last) / (max - 1))]!);
  return out;
}

/** Y-domain in probability units, padded so a flat series still draws a visible line. */
function yDomain(points: readonly PricePoint[]): [number, number] {
  const values = points.map(price);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (values.length === 0) return [0, 1];
  const pad = hi - lo < 0.01 ? 0.02 : (hi - lo) * 0.1;
  lo = Math.max(0, lo - pad);
  hi = Math.min(1, hi + pad);
  return [lo, hi];
}

const STEPS_CENTS = [0.5, 1, 2, 5, 10, 20, 25, 50];

/** About four round tick values (in cents) inside [lo, hi] probability. */
function yTickValues(lo: number, hi: number): number[] {
  const loC = lo * 100;
  const hiC = hi * 100;
  const step = STEPS_CENTS.find((s) => (hiC - loC) / s <= 5) ?? 50;
  const ticks: number[] = [];
  for (let c = Math.ceil(loC / step - 1e-9) * step; c <= hiC + 1e-9; c += step) ticks.push(Math.round(c * 100) / 10000);
  return ticks;
}

export function formatCents(p: number): string {
  const c = Math.round(p * 1000) / 10;
  return `${Number.isInteger(c) ? c : c.toFixed(1)}¢`;
}

/** Axis label for a timestamp, suited to the range. `timeZone` defaults to the viewer's. */
export function formatTick(t: number, range: HistoryRange, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions =
    range === "1h" || range === "6h" || range === "1d"
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : range === "max"
        ? { month: "short", year: "numeric" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(t));
}

/** Full date and time for the tooltip. */
export function formatFull(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(t));
}

export function scaleChart(
  points: readonly PricePoint[],
  width: number,
  height: number,
  padding: Padding,
  range: HistoryRange = "1d",
  timeZone?: string,
): ChartScale {
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 0;
  const [lo, hi] = yDomain(points);
  const x = (t: number) => (t1 === t0 ? padding.left + innerW / 2 : padding.left + ((t - t0) / (t1 - t0)) * innerW);
  const y = (p: number) => padding.top + (1 - (Math.min(1, Math.max(0, p)) - lo) / (hi - lo)) * innerH;
  const path = points.map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.t).toFixed(1)} ${y(price(pt)).toFixed(1)}`).join("");
  const yTicks = points.length === 0 ? [] : yTickValues(lo, hi).map((p) => ({ p, label: formatCents(p) }));
  const xTicks =
    points.length < 2
      ? []
      : [0, 1, 2, 3]
          .map((i) => {
            const t = t0 + ((t1 - t0) * i) / 3;
            return { t, label: formatTick(t, range, timeZone) };
          })
          // Short spans at day/month granularity can repeat a label ("12 Nov", "12 Nov"); keep the first.
          .filter((tick, i, all) => i === 0 || tick.label !== all[i - 1]!.label);
  return { path, x, y, yTicks, xTicks };
}

/** The point closest in time to `t`, or null for an empty series. Points must be oldest first. */
export function nearestPoint(points: readonly PricePoint[], t: number): PricePoint | null {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  return Math.abs(t - a.t) <= Math.abs(b.t - t) ? a : b;
}

/** First and last price over the range plus the absolute change (probability units). */
export function rangeChange(points: readonly PricePoint[]): { first: number; last: number; change: number } | null {
  if (points.length === 0) return null;
  const first = price(points[0]!);
  const last = price(points[points.length - 1]!);
  return { first, last, change: last - first };
}
