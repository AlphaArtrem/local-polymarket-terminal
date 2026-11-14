import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewRule, TpSlSpec, TwapSpec } from "@/lib/phase8-types";
import { AutomationEngine, AutomationError, type EngineDeps } from "@/server/automation/engine";
import { saveStore } from "@/server/automation/store";

const base = { assetId: "123", conditionId: "0x" + "ab".repeat(32), label: "L", eventSlug: "s" };
const tpsl = (o: Partial<TpSlSpec> = {}): TpSlSpec => ({ kind: "TPSL", ...base, size: "10", takeProfit: "0.8", stopLoss: "0.3", ...o });
const twap = (o: Partial<TwapSpec> = {}): TwapSpec => ({ kind: "TWAP", ...base, side: "BUY", total: "10", slices: 2, intervalSec: 60, priceLimit: null, ...o });

let dir: string;
let file: string;
let clock: number;
let mid: string | null;
let held: string;
const placeOrder = vi.fn<EngineDeps["placeOrder"]>();
const fetchMidpoints = vi.fn<EngineDeps["fetchMidpoints"]>();
const heldSize = vi.fn<EngineDeps["heldSize"]>();
let nextOrder: number;

const make = () => new AutomationEngine({ file, now: () => clock, fetchMidpoints, placeOrder, heldSize });
/** An engine that is running (not paused) with the given rules created. */
async function running(...specs: NewRule[]) {
  const engine = make();
  await engine.ready();
  const ids: string[] = [];
  for (const s of specs) ids.push((await engine.addRule(s)).id);
  return { engine, ids };
}
const rule = (e: AutomationEngine, i = 0) => e.getState().rules.find((r) => r.id === ids(e)[i])!;
const ids = (e: AutomationEngine) => [...e.getState().rules].sort((a, b) => a.createdAt - b.createdAt || 0).map((r) => r.id);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "automation-engine-"));
  file = join(dir, "a.json");
  clock = 1_000_000;
  mid = "0.5";
  held = "42";
  nextOrder = 1;
  vi.clearAllMocks();
  fetchMidpoints.mockImplementation(async (a) => Object.fromEntries(a.map((x) => [x, mid])));
  heldSize.mockImplementation(async () => held);
  placeOrder.mockImplementation(async () => ({ ok: true, orderId: `o${nextOrder++}` }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("TP/SL", () => {
  it("needs the trigger on 2 consecutive ticks, and a dip back resets the count", async () => {
    const { engine } = await running(tpsl());
    mid = "0.85";
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    mid = "0.5";
    await engine.tick();
    mid = "0.85";
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith({ assetId: "123", conditionId: base.conditionId, side: "SELL", type: "MARKET", size: "10" });
    expect(rule(engine)).toMatchObject({ status: "done", slicesDone: 1, lastPrice: "0.85" });
    expect(rule(engine).executions[0]).toMatchObject({ what: "TP", ok: true, orderId: "o1" });
  });

  it("fires the stop loss and clamps the size to the held shares", async () => {
    held = "4.5";
    const { engine } = await running(tpsl());
    mid = "0.2";
    await engine.tick();
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ side: "SELL", size: "4.5" }));
    expect(rule(engine).executions[0]?.what).toBe("SL");
  });

  it("errors without placing when no shares are left", async () => {
    held = "0";
    const { engine } = await running(tpsl());
    mid = "0.9";
    await engine.tick();
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(rule(engine)).toMatchObject({ status: "error", error: "No shares left to sell" });
  });

  it("persists firing before the order call", async () => {
    const { engine } = await running(tpsl());
    let onDisk = "";
    placeOrder.mockImplementation(async () => {
      onDisk = await readFile(file, "utf8");
      return { ok: true, orderId: "o1" };
    });
    mid = "0.9";
    await engine.tick();
    await engine.tick();
    expect(JSON.parse(onDisk).rules[0].status).toBe("firing");
  });

  it("a refusal stops the rule with the code and is not retried", async () => {
    placeOrder.mockResolvedValue({ ok: false, code: "SIZE_TOO_SMALL", message: "too small" });
    const { engine } = await running(tpsl());
    mid = "0.9";
    await engine.tick();
    await engine.tick();
    await engine.tick();
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(rule(engine)).toMatchObject({ status: "error", error: "SIZE_TOO_SMALL: too small" });
  });

  it("stops the rule at once when the order call throws (it may have been placed)", async () => {
    placeOrder.mockRejectedValue(new Error("network"));
    const { engine } = await running(tpsl());
    mid = "0.9";
    await engine.tick();
    await engine.tick();
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(rule(engine)).toMatchObject({ status: "error" });
    expect(rule(engine).error).toMatch(/may or may not have been placed/);
    expect(rule(engine).executions.at(-1)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });

  it("retries a failed held-size lookup (nothing sent), then stops the rule after 3", async () => {
    heldSize.mockRejectedValue(new Error("network"));
    const { engine } = await running(tpsl());
    mid = "0.9";
    await engine.tick();
    await engine.tick();
    expect(rule(engine).status).toBe("armed");
    await engine.tick();
    expect(rule(engine).status).toBe("armed");
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(rule(engine).status).toBe("error");
    expect(rule(engine).error).toMatch(/3 times/);
  });

  it("a cancelled rule is never fired", async () => {
    const { engine, ids: [id] } = await running(tpsl());
    mid = "0.9";
    await engine.tick();
    await engine.deleteRule(id!);
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

describe("TWAP", () => {
  it("fires the first slice on the first tick, then one per interval, then is done", async () => {
    const { engine } = await running(twap({ total: "10.01", slices: 2 }));
    await engine.tick();
    expect(placeOrder).toHaveBeenLastCalledWith({ assetId: "123", conditionId: base.conditionId, side: "BUY", type: "MARKET", amount: "5.00" });
    expect(rule(engine)).toMatchObject({ status: "armed", slicesDone: 1, nextAt: 1_060_000 });
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    clock = 1_060_000;
    await engine.tick();
    expect(placeOrder).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "5.01" }));
    expect(rule(engine)).toMatchObject({ status: "done", slicesDone: 2, nextAt: null });
  });

  it("SELL slices use size", async () => {
    const { engine } = await running(twap({ side: "SELL", total: "4", slices: 2 }));
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ side: "SELL", size: "2.00" }));
  });

  it("skips a slice outside the price limit (counted) and when the midpoint is unknown", async () => {
    const { engine } = await running(twap({ priceLimit: "0.4", slices: 3, total: "3" }));
    await engine.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(rule(engine)).toMatchObject({ status: "armed", slicesDone: 1 });
    expect(rule(engine).executions[0]).toMatchObject({ ok: false, code: "SKIPPED_PRICE_LIMIT" });
    clock += 60_000;
    mid = null;
    await engine.tick();
    expect(rule(engine).slicesDone).toBe(2);
    clock += 60_000;
    mid = "0.4";
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(rule(engine).status).toBe("done");
  });

  it("does not burst-fire missed slices after a long gap", async () => {
    const { engine } = await running(twap({ slices: 4, total: "4" }));
    await engine.tick();
    clock += 10 * 60_000;
    await engine.tick();
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(2);
  });

  it("a refusal ends the rule", async () => {
    placeOrder.mockResolvedValue({ ok: false, code: "MAX_ORDER", message: "over cap" });
    const { engine } = await running(twap());
    await engine.tick();
    expect(rule(engine)).toMatchObject({ status: "error", error: "MAX_ORDER: over cap" });
  });
});

describe("engine pause and startup", () => {
  it("pauses with reason errors after 3 failed firings in a row, and places nothing while paused", async () => {
    placeOrder.mockResolvedValue({ ok: false, code: "X", message: "m" });
    const { engine } = await running(twap(), twap(), twap(), twap());
    await engine.tick();
    expect(engine.getState()).toMatchObject({ paused: true, pausedReason: "errors" });
    expect(placeOrder).toHaveBeenCalledTimes(3);
    await engine.tick();
    expect(placeOrder).toHaveBeenCalledTimes(3);
    const resumed = await engine.control("resume");
    expect(resumed).toMatchObject({ paused: false, pausedReason: null });
  });

  it("a success resets the failure streak", async () => {
    const { engine } = await running(twap(), twap(), twap());
    placeOrder
      .mockResolvedValueOnce({ ok: false, code: "X", message: "m" })
      .mockResolvedValueOnce({ ok: false, code: "X", message: "m" })
      .mockResolvedValueOnce({ ok: true, orderId: "o" });
    await engine.tick();
    expect(engine.getState().paused).toBe(false);
  });

  it("starts paused with reason startup when a rule is armed, and running otherwise", async () => {
    const empty = make();
    await empty.ready();
    expect(empty.getState()).toMatchObject({ paused: false, pausedReason: null });
    await empty.addRule(tpsl());
    empty.stop();

    const restarted = make();
    await restarted.ready();
    expect(restarted.getState()).toMatchObject({ paused: true, pausedReason: "startup" });
    mid = "0.9";
    await restarted.tick();
    await restarted.tick();
    expect(placeOrder).not.toHaveBeenCalled();
    restarted.stop();
  });

  it("marks rules left firing as error on start and never fires them", async () => {
    const e = make();
    await e.ready();
    const r = await e.addRule(tpsl());
    e.stop();
    const data = JSON.parse(await readFile(file, "utf8"));
    data.rules[0].status = "firing";
    await saveStore(file, data);
    const again = make();
    await again.ready();
    expect(again.getState().rules[0]).toMatchObject({ id: r.id, status: "error" });
    expect(again.getState().paused).toBe(false);
    again.stop();
  });

  it("user pause and resume", async () => {
    const { engine } = await running();
    expect(await engine.control("pause")).toMatchObject({ paused: true, pausedReason: "user" });
    expect(await engine.control("resume")).toMatchObject({ paused: false, pausedReason: null });
  });

  it("ticks every 5 s from one timer even if started twice", async () => {
    vi.useFakeTimers();
    const engine = new AutomationEngine({ file, now: () => clock, fetchMidpoints, placeOrder, heldSize, tickMs: 5000 });
    const tick = vi.spyOn(engine, "tick").mockResolvedValue();
    engine.start();
    engine.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tick).toHaveBeenCalledTimes(3);
    engine.stop();
  });
});

describe("rule management", () => {
  it("cancels armed, removes finished, 404s unknown", async () => {
    const { engine, ids: [id] } = await running(tpsl());
    expect((await engine.deleteRule(id!)).status).toBe("cancelled");
    expect(engine.getState().rules).toHaveLength(1);
    expect((await engine.deleteRule(id!)).status).toBe("cancelled");
    expect(engine.getState().rules).toHaveLength(0);
    await expect(engine.deleteRule(id!)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to delete a rule that is firing", async () => {
    const { engine, ids: [id] } = await running(twap());
    let release!: () => void;
    placeOrder.mockImplementation(() => new Promise((r) => (release = () => r({ ok: true, orderId: "o" }))));
    const ticking = engine.tick();
    await vi.waitFor(() => expect(placeOrder).toHaveBeenCalled());
    await expect(engine.deleteRule(id!)).rejects.toBeInstanceOf(AutomationError);
    await expect(engine.deleteRule(id!)).rejects.toMatchObject({ status: 409, code: "RULE_FIRING" });
    release();
    await ticking;
  });

  it("caps active rules at 50 and lists newest first", async () => {
    const engine = make();
    await engine.ready();
    for (let i = 0; i < 50; i++) {
      clock += 1;
      await engine.addRule(tpsl());
    }
    await expect(engine.addRule(tpsl())).rejects.toMatchObject({ status: 422, code: "TOO_MANY_RULES" });
    const created = engine.getState().rules.map((r) => r.createdAt);
    expect(created).toEqual([...created].sort((a, b) => b - a));
    engine.stop();
  });
});
