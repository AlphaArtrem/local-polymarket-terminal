import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here reaches the SDK or the network: orders, positions and prices are mocked.
const env = { automationEnabled: true, automationFile: "", maxOrderUsdc: 25 };
vi.mock("@/server/env", () => ({ getEnv: () => env }));

let configured = true;
const publicClient = { fetchMidpoints: vi.fn() };
vi.mock("@/server/polymarket", () => ({
  isConfigured: () => configured,
  getPublicClient: () => publicClient,
  getSecureClient: async () => ({ account: { wallet: "0xw" } }),
  NotConfiguredError: class extends Error {},
}));
const placeOrder = vi.fn();
vi.mock("@/server/orders/place", () => ({ placeOrder }));
const listPositions = vi.fn();
vi.mock("@polymarket/client/actions", () => ({ listPositions }));

const list = await import("@/app/api/automation/route");
const rules = await import("@/app/api/automation/rules/route");
const one = await import("@/app/api/automation/rules/[id]/route");
const control = await import("@/app/api/automation/control/route");

const COND = "0x" + "ab".repeat(32);
const spec = { assetId: "123", conditionId: COND, label: "L", eventSlug: "s" };
const tpsl = (o: object = {}) => ({ kind: "TPSL", ...spec, size: "10", takeProfit: "0.8", stopLoss: "0.3", ...o });
const twap = (o: object = {}) => ({ kind: "TWAP", ...spec, side: "BUY", total: "10", slices: 2, intervalSec: 60, priceLimit: null, ...o });
const post = (url: string, body: unknown) => new Request(`http://127.0.0.1:3737${url}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "automation-routes-"));
  env.automationEnabled = true;
  env.automationFile = join(dir, "a.json");
  configured = true;
  vi.clearAllMocks();
  publicClient.fetchMidpoints.mockResolvedValue({ "123": "0.5" });
  listPositions.mockReturnValue({ firstPage: async () => ({ items: [{ assetId: "123", currentSize: "42" }] }) });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  const g = globalThis as Record<string, unknown>;
  (g.__localPolymarketAutomationEngine as { stop(): void } | undefined)?.stop();
  delete g.__localPolymarketAutomationEngine;
  await rm(dir, { recursive: true, force: true });
});

describe("gates", () => {
  it("returns 403 AUTOMATION_DISABLED from every route when off", async () => {
    env.automationEnabled = false;
    const responses = [
      await list.GET(),
      await rules.POST(post("/api/automation/rules", tpsl())),
      await one.DELETE(new Request("http://x", { method: "DELETE" }), ctx("abc")),
      await control.POST(post("/api/automation/control", { action: "pause" })),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("AUTOMATION_DISABLED");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("returns 400 NOT_CONFIGURED without a key", async () => {
    configured = false;
    const res = await list.GET();
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("NOT_CONFIGURED");
  });

  it("returns 500 AUTOMATION_STORE_CORRUPT naming the path, not the contents", async () => {
    await writeFile(env.automationFile, "not json at all");
    const res = await list.GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("AUTOMATION_STORE_CORRUPT");
    expect(body.error.message).toContain(env.automationFile);
    expect(body.error.message).not.toContain("not json");
  });
});

describe("POST /api/automation/rules", () => {
  it.each<[string, unknown]>([
    ["not json", "nope"],
    ["unknown kind", { kind: "X" }],
    ["no trigger", tpsl({ takeProfit: null, stopLoss: null })],
    ["tp below sl", tpsl({ takeProfit: "0.2" })],
    ["one slice", twap({ slices: 1 })],
    ["extra key", { ...tpsl(), x: 1 }],
  ])("rejects %s with 400 INVALID_BODY", async (_n, body) => {
    const res = await rules.POST(post("/api/automation/rules", body));
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("INVALID_BODY");
  });

  it("creates a TP/SL rule (201) with an id and armed status", async () => {
    const res = await rules.POST(post("/api/automation/rules", tpsl()));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const dto = (await res.json()) as { id: string; status: string };
    expect(dto.status).toBe("armed");
    expect(dto.id).toMatch(/^[0-9a-f-]{36}$/);
    const state = (await (await list.GET()).json()) as { paused: boolean; rules: unknown[] };
    expect(state).toMatchObject({ paused: false });
    expect(state.rules).toHaveLength(1);
  });

  it.each([
    ["take profit at or below the price", tpsl({ takeProfit: "0.5" })],
    ["stop loss at or above the price", tpsl({ stopLoss: "0.5", takeProfit: "0.9" })],
  ])("422 TRIGGER_ALREADY_MET for %s", async (_n, body) => {
    const res = await rules.POST(post("/api/automation/rules", body));
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("TRIGGER_ALREADY_MET");
  });

  it("422 INSUFFICIENT_SHARES when size exceeds the held shares", async () => {
    const res = await rules.POST(post("/api/automation/rules", tpsl({ size: "42.5" })));
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("INSUFFICIENT_SHARES");
  });

  it("422 PRICE_UNAVAILABLE without a midpoint", async () => {
    publicClient.fetchMidpoints.mockResolvedValue({});
    expect(await code(await rules.POST(post("/api/automation/rules", tpsl())))).toBe("PRICE_UNAVAILABLE");
  });

  it("creates a TWAP and enforces slice rules", async () => {
    expect((await rules.POST(post("/api/automation/rules", twap()))).status).toBe(201);
    const over = await rules.POST(post("/api/automation/rules", twap({ total: "100", slices: 2 })));
    expect(over.status).toBe(422);
    expect(await code(over)).toBe("SLICE_OVER_CAP");
    const tiny = await rules.POST(post("/api/automation/rules", twap({ total: "0.05", slices: 10 })));
    expect(tiny.status).toBe(422);
    expect(await code(tiny)).toBe("INVALID_SLICES");
    const sell = await rules.POST(post("/api/automation/rules", twap({ side: "SELL", total: "50" })));
    expect(await code(sell)).toBe("INSUFFICIENT_SHARES");
  });

  it("422 TOO_MANY_RULES past 50 active rules", async () => {
    for (let i = 0; i < 50; i++) expect((await rules.POST(post("/api/automation/rules", twap()))).status).toBe(201);
    const res = await rules.POST(post("/api/automation/rules", twap()));
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("TOO_MANY_RULES");
  });
});

describe("DELETE /api/automation/rules/[id] and control", () => {
  const del = (id: string) => one.DELETE(new Request("http://x", { method: "DELETE" }), ctx(id));

  it("cancels an armed rule, then removes it, then 404s", async () => {
    const { id } = (await (await rules.POST(post("/api/automation/rules", tpsl()))).json()) as { id: string };
    const cancelled = await del(id);
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe("cancelled");
    expect((await del(id)).status).toBe(200);
    const gone = await del(id);
    expect(gone.status).toBe(404);
    expect(await code(gone)).toBe("NOT_FOUND");
    expect(await code(await del("../etc"))).toBe("NOT_FOUND");
  });

  it("pauses and resumes, and validates the body", async () => {
    const paused = await control.POST(post("/api/automation/control", { action: "pause" }));
    expect(await paused.json()).toMatchObject({ paused: true, pausedReason: "user" });
    const resumed = await control.POST(post("/api/automation/control", { action: "resume" }));
    expect(await resumed.json()).toMatchObject({ paused: false, pausedReason: null });
    const bad = await control.POST(post("/api/automation/control", { action: "stop" }));
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("INVALID_BODY");
  });
});
