import { describe, expect, it } from "vitest";
import { downsample, formatCents, nearestPoint, rangeChange, scaleChart } from "@/lib/chart";
import type { PricePoint } from "@/lib/live-types";

const pad = { top: 10, right: 10, bottom: 20, left: 40 };
const series = (n: number, f = (i: number) => 0.2 + i * 0.001): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({ t: 1_000_000 + i * 60_000, p: String(f(i)) }));

describe("downsample", () => {
  it("keeps short series untouched", () => {
    const pts = series(5);
    expect(downsample(pts, 10)).toEqual(pts);
  });
  it("caps length and keeps first and last", () => {
    const pts = series(1438);
    const out = downsample(pts, 500);
    expect(out).toHaveLength(500);
    expect(out[0]).toBe(pts[0]);
    expect(out[499]).toBe(pts[1437]);
    expect(out.map((p) => p.t)).toEqual([...out.map((p) => p.t)].sort((a, b) => a - b));
  });
  it("handles empty input", () => {
    expect(downsample([], 500)).toEqual([]);
  });
});

describe("scaleChart", () => {
  it("maps first/last to the plot edges and higher prices upward", () => {
    const pts = series(10, (i) => 0.2 + i * 0.02);
    const s = scaleChart(pts, 300, 200, pad, "1d", "UTC");
    expect(s.x(pts[0]!.t)).toBe(40);
    expect(s.x(pts[9]!.t)).toBe(290);
    expect(s.y(0.38)).toBeLessThan(s.y(0.2));
    expect(s.y(0.2)).toBeLessThanOrEqual(180);
    expect(s.y(0.38)).toBeGreaterThanOrEqual(10);
    expect(s.path.startsWith("M40")).toBe(true);
    expect(s.path.match(/L/g)).toHaveLength(9);
  });
  it("pads a flat series so the line is inside the plot", () => {
    const pts = series(5, () => 0.5);
    const s = scaleChart(pts, 300, 200, pad);
    expect(Number.isFinite(s.y(0.5))).toBe(true);
    expect(s.y(0.5)).toBeGreaterThan(10);
    expect(s.y(0.5)).toBeLessThan(180);
    expect(s.yTicks.length).toBeGreaterThan(0);
  });
  it("handles empty and single-point series", () => {
    const empty = scaleChart([], 300, 200, pad);
    expect(empty.path).toBe("");
    expect(empty.yTicks).toEqual([]);
    expect(empty.xTicks).toEqual([]);
    const one = scaleChart(series(1), 300, 200, pad);
    expect(one.path.startsWith("M")).toBe(true);
    expect(one.x(1_000_000)).toBe(165);
    expect(one.xTicks).toEqual([]);
  });
  it("clamps prices to 0..1", () => {
    const s = scaleChart([{ t: 1, p: "1.4" }, { t: 2, p: "-0.2" }], 300, 200, pad);
    expect(s.y(5)).toBe(s.y(1));
    expect(s.y(-1)).toBe(s.y(0));
    expect(s.yTicks.every((t) => t.p >= 0 && t.p <= 1)).toBe(true);
  });
  it("labels y ticks in cents", () => {
    const s = scaleChart(series(10, (i) => 0.2 + i * 0.02), 300, 200, pad);
    expect(s.yTicks.every((t) => /^\d+(\.\d)?¢$/.test(t.label))).toBe(true);
    expect(formatCents(0.235)).toBe("23.5¢");
    expect(formatCents(0.23)).toBe("23¢");
  });
  it("formats x ticks per range", () => {
    const t0 = Date.UTC(2026, 10, 14, 9, 5);
    const pts: PricePoint[] = [{ t: t0, p: "0.3" }, { t: t0 + 3 * 3_600_000, p: "0.4" }];
    const labels = (r: Parameters<typeof scaleChart>[4]) => scaleChart(pts, 300, 200, pad, r, "UTC").xTicks.map((x) => x.label);
    expect(labels("1d")[0]).toBe("09:05");
    expect(labels("1h")).toHaveLength(4);
    expect(labels("1w")[0]).toBe("14 Nov");
    expect(labels("1m")[0]).toBe("14 Nov");
    expect(labels("max")[0]).toBe("Nov 2026");
  });
});

describe("nearestPoint / rangeChange", () => {
  const pts = series(5);
  it("finds the closest point", () => {
    expect(nearestPoint(pts, pts[2]!.t + 10_000)).toBe(pts[2]);
    expect(nearestPoint(pts, pts[2]!.t + 40_000)).toBe(pts[3]);
    expect(nearestPoint(pts, 0)).toBe(pts[0]);
    expect(nearestPoint(pts, 9e12)).toBe(pts[4]);
    expect(nearestPoint([], 5)).toBeNull();
    expect(nearestPoint([pts[0]!], 5)).toBe(pts[0]);
  });
  it("computes the change", () => {
    const c = rangeChange([{ t: 1, p: "0.2" }, { t: 2, p: "0.5" }])!;
    expect(c.first).toBe(0.2);
    expect(c.last).toBe(0.5);
    expect(c.change).toBeCloseTo(0.3);
    expect(rangeChange([])).toBeNull();
  });
});

describe("x-axis ticks", () => {
  it("never repeats a label on adjacent ticks", () => {
    // 1W range spanning ~2.5 days: two of the four ticks fall on the same day.
    const start = Date.UTC(2026, 10, 11, 23, 0);
    const pts = [{ t: start, p: "0.5" }, { t: start + 2.5 * 86_400_000, p: "0.2" }];
    const { xTicks } = scaleChart(pts, 600, 180, { top: 8, right: 8, bottom: 20, left: 32 }, "1w", "UTC");
    const labels = xTicks.map((x) => x.label);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.some((l, i) => i > 0 && l === labels[i - 1])).toBe(false);
  });
});

