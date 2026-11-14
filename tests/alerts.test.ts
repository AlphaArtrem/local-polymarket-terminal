import { describe, expect, it } from "vitest";
import {
  addAlert, ALERTS_STORAGE_KEY, armedAssetIds, describeFired, evaluate, MAX_ALERTS, parseCents,
  parseStored, rearmAlert, removeAlert, serializeAlerts, toCents,
} from "@/lib/alerts";
import type { PriceAlert } from "@/lib/phase7-types";

const mk = (over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "a1", assetId: "111", label: "Ian Buck · Yes", eventSlug: "next-ceo", direction: "above",
  threshold: "0.30", createdAt: 1, firedAt: null, ...over,
});

describe("storage schema", () => {
  it("round-trips a valid list", () => {
    expect(parseStored(serializeAlerts([mk()]))).toEqual([mk()]);
    expect(ALERTS_STORAGE_KEY).toBe("pmterm.alerts.v1");
  });
  it("returns empty for missing, corrupt, old-version and bad-field data", () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored("{nope")).toEqual([]);
    expect(parseStored(JSON.stringify({ version: 0, alerts: [mk()] }))).toEqual([]);
    expect(parseStored(JSON.stringify([mk()]))).toEqual([]);
    expect(parseStored(JSON.stringify({ version: 1, alerts: [mk({ direction: "up" as never })] }))).toEqual([]);
    expect(parseStored(JSON.stringify({ version: 1, alerts: [mk({ threshold: "abc" })] }))).toEqual([]);
    expect(parseStored(JSON.stringify({ version: 1, alerts: [mk({ assetId: "0x1" })] }))).toEqual([]);
  });
});

describe("list edits", () => {
  it("adds armed, removes, re-arms", () => {
    const input = { assetId: "9", label: "L", eventSlug: "s", direction: "below" as const, threshold: "0.10" };
    const added = addAlert([], input, "id1", 50);
    expect(added).toEqual([{ ...input, id: "id1", createdAt: 50, firedAt: null }]);
    const fired = [mk({ firedAt: 5 }), mk({ id: "a2" })];
    expect(rearmAlert(fired, "a1")[0]?.firedAt).toBeNull();
    expect(removeAlert(fired, "a1").map((a) => a.id)).toEqual(["a2"]);
  });
  it("caps the list", () => {
    const full = Array.from({ length: MAX_ALERTS }, (_, i) => mk({ id: String(i) }));
    expect(addAlert(full, mk(), "x", 1)).toBe(full);
  });
  it("lists distinct armed assets", () => {
    const list = [mk(), mk({ id: "b" }), mk({ id: "c", assetId: "2" }), mk({ id: "d", assetId: "3", firedAt: 1 })];
    expect(armedAssetIds(list)).toEqual(["111", "2"]);
  });
});

describe("evaluate", () => {
  it("fires above and below, with exact equality", () => {
    const list = [mk(), mk({ id: "b", assetId: "2", direction: "below", threshold: "0.305" })];
    expect(evaluate(list, { "111": "0.29", "2": "0.31" }, 9).fired).toEqual([]);
    const r = evaluate(list, { "111": "0.30", "2": "0.305" }, 9);
    expect(r.fired.map((a) => a.id)).toEqual(["a1", "b"]);
    expect(r.next.every((a) => a.firedAt === 9)).toBe(true);
  });
  it("fires once: a fired alert stays quiet", () => {
    const first = evaluate([mk()], { "111": "0.5" }, 1);
    const second = evaluate(first.next, { "111": "0.9" }, 2);
    expect(second.fired).toEqual([]);
    expect(second.next[0]?.firedAt).toBe(1);
  });
  it("ignores missing or null prices and leaves the input untouched", () => {
    const list = [mk()];
    expect(evaluate(list, {}, 1).fired).toEqual([]);
    expect(evaluate(list, { "111": null }, 1).next).toEqual(list);
    expect(list[0]?.firedAt).toBeNull();
  });
  it("compares decimals exactly, not as floats", () => {
    const a = mk({ threshold: "0.3" });
    expect(evaluate([a], { "111": "0.30000001" }, 1).fired).toHaveLength(1);
    expect(evaluate([a], { "111": "0.29999999" }, 1).fired).toHaveLength(0);
  });
  it("describes a fired alert", () => {
    expect(describeFired(mk(), "0.312")).toBe("Ian Buck · Yes is above 30¢ (now 31.2¢)");
  });
});

describe("cents helpers", () => {
  it("converts cents text to a 0..1 decimal", () => {
    expect(parseCents("30")).toBe("0.30");
    expect(parseCents(" 30.5 ")).toBe("0.305");
    expect(parseCents("0.1")).toBe("0.001");
    expect(parseCents("99.99")).toBe("0.9999");
  });
  it("rejects out-of-range and malformed input", () => {
    for (const bad of ["", "0", "100", "101", "-5", "abc", "1e2", "30,5", "0.0000001", "1.123456789"]) {
      expect(parseCents(bad), bad).toBeNull();
    }
  });
  it("formats a price as cents", () => {
    expect(toCents("0.0945")).toBe("9.45");
    expect(toCents("0.30")).toBe("30");
    expect(toCents("x")).toBe("x");
  });
});
