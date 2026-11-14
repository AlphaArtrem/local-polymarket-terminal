import { describe, expect, it } from "vitest";
import {
  describeConfirm,
  describeRule,
  explainFailure,
  formatDuration,
  formatNextIn,
  twapPreview,
  validateTpSl,
  validateTwap,
} from "@/components/automation/describe";
import type { TpSlSpec, TwapSpec } from "@/lib/phase8-types";

const target = { assetId: "1", conditionId: "0xc", label: "Jensen · Yes", eventSlug: "jensen" };
const tpsl: TpSlSpec = { kind: "TPSL", ...target, size: "42.08", takeProfit: "0.15", stopLoss: "0.05" };
const twap: TwapSpec = {
  kind: "TWAP", ...target, side: "BUY", total: "10", slices: 5, intervalSec: 600, priceLimit: "0.12",
};

describe("describe", () => {
  it("summarises rules", () => {
    expect(describeRule(tpsl)).toBe("TP 15¢ / SL 5¢ · 42.08 sh");
    expect(describeRule({ ...tpsl, stopLoss: null })).toBe("TP 15¢ · 42.08 sh");
    expect(describeRule(twap)).toBe("TWAP buy $10 in 5 × 10 min · limit 12¢");
    expect(describeRule({ ...twap, side: "SELL", total: "3.50", priceLimit: null })).toBe("TWAP sell 3.5 sh in 5 × 10 min");
  });

  it("states what will happen", () => {
    expect(describeConfirm(tpsl)).toBe(
      "When the midpoint reaches 15¢ or falls to 5¢, this app will sell up to 42.08 shares at market, without asking again. Runs only while the app is running.",
    );
    expect(describeConfirm(twap)).toContain("buy $10 of this outcome at market in 5 slices, one every 10m (about $2 each)");
    expect(describeConfirm(twap)).toContain("skipped while the midpoint is above 12¢");
  });

  it("formats durations", () => {
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(90000)).toBe("1d 1h");
    expect(formatNextIn(null, 0)).toBeNull();
    expect(formatNextIn(500, 1000)).toBe("now");
    expect(formatNextIn(181_000, 0)).toBe("in 3m 1s");
  });

  it("previews slices", () => {
    expect(twapPreview("10", 4, 60)).toEqual({ perSlice: "2.5", durationSec: 240 });
    expect(twapPreview("1", 3, 60)?.perSlice).toBe("0.33333333");
    expect(twapPreview("abc", 3, 60)).toBeNull();
  });

  it("explains setup failures", () => {
    expect(explainFailure("AUTOMATION_DISABLED", "x")).toContain("AUTOMATION_ENABLED=true");
    expect(explainFailure("NOT_CONFIGURED", "x")).toContain("private key");
    expect(explainFailure("OTHER", "boom")).toBe("boom");
  });
});

describe("validateTpSl", () => {
  const form = { shares: "42.08", takeProfit: "15", stopLoss: "5" };
  it("accepts and converts cents to decimals", () => {
    const r = validateTpSl(form, target, "42.08", "0.10");
    expect(r).toEqual({ ok: true, value: { ...tpsl } });
  });
  it("allows a single leg", () => {
    const r = validateTpSl({ ...form, stopLoss: "" }, target, "42.08", "0.10");
    expect(r.ok && r.value.stopLoss).toBeNull();
  });
  it("requires at least one leg", () => {
    expect(validateTpSl({ ...form, takeProfit: "", stopLoss: "" }, target, "42.08", "0.1").ok).toBe(false);
  });
  it("enforces ordering against the current price (boundaries are rejected)", () => {
    expect(validateTpSl({ ...form, takeProfit: "10" }, target, "42.08", "0.10").ok).toBe(false);
    expect(validateTpSl({ ...form, takeProfit: "10.5" }, target, "42.08", "0.10").ok).toBe(true);
    expect(validateTpSl({ ...form, stopLoss: "10" }, target, "42.08", "0.10").ok).toBe(false);
    expect(validateTpSl({ ...form, stopLoss: "9.5" }, target, "42.08", "0.10").ok).toBe(true);
  });
  it("requires SL below TP when the price is unknown", () => {
    expect(validateTpSl({ ...form, takeProfit: "5", stopLoss: "5" }, target, "42.08", null).ok).toBe(false);
    expect(validateTpSl(form, target, "42.08", null).ok).toBe(true);
  });
  it("bounds shares by the held size", () => {
    expect(validateTpSl({ ...form, shares: "42.09" }, target, "42.08", "0.1").ok).toBe(false);
    expect(validateTpSl({ ...form, shares: "0" }, target, "42.08", "0.1").ok).toBe(false);
    expect(validateTpSl(form, target, null, "0.1").ok).toBe(false);
    expect(validateTpSl(form, target, "0", "0.1").ok).toBe(false);
  });
  it("rejects out-of-range cents", () => {
    expect(validateTpSl({ ...form, takeProfit: "100" }, target, "42.08", "0.1").ok).toBe(false);
    expect(validateTpSl({ ...form, stopLoss: "0" }, target, "42.08", "0.1").ok).toBe(false);
  });
});

describe("validateTwap", () => {
  const form = { side: "BUY" as const, total: "10", slices: "5", intervalMin: "10", limitCents: "12" };
  it("converts minutes and cents", () => {
    expect(validateTwap(form, target, null)).toEqual({ ok: true, value: twap });
  });
  it("treats the limit as optional", () => {
    const r = validateTwap({ ...form, limitCents: "" }, target, null);
    expect(r.ok && r.value.priceLimit).toBeNull();
  });
  it("checks slice and interval bounds", () => {
    for (const [slices, ok] of [["1", false], ["2", true], ["50", true], ["51", false], ["2.5", false]] as const) {
      expect(validateTwap({ ...form, slices }, target, null).ok).toBe(ok);
    }
    for (const [intervalMin, ok] of [["0", false], ["1", true], ["1440", true], ["1441", false]] as const) {
      expect(validateTwap({ ...form, intervalMin }, target, null).ok).toBe(ok);
    }
  });
  it("limits SELL to the held size", () => {
    const sell = { ...form, side: "SELL" as const, total: "5" };
    expect(validateTwap(sell, target, "5").ok).toBe(true);
    expect(validateTwap(sell, target, "4.99").ok).toBe(false);
    expect(validateTwap(sell, target, null).ok).toBe(false);
  });
  it("rejects a non-positive total", () => {
    expect(validateTwap({ ...form, total: "0" }, target, null).ok).toBe(false);
  });
});
