import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";

const placeOrder = vi.fn();
const cancelOrder = vi.fn();
const getSecureClient = vi.fn(async (): Promise<object> => ({}));

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return { NotConfiguredError, WalletNotConnectedError, getSecureClient };
});
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));
vi.mock("@/server/orders/place", () => ({ placeOrder }));
vi.mock("@/server/portfolio", () => ({ cursorQuery: {}, getOpenOrders: vi.fn(), parseQuery: vi.fn(), respond: vi.fn() }));
vi.mock("@polymarket/client/actions", () => ({ cancelOrder }));

const { POST } = await import("@/app/api/orders/route");
const { DELETE } = await import("@/app/api/orders/[id]/route");
const { NotConfiguredError } = await import("@/server/polymarket");

const CONDITION = "0x" + "a".repeat(64);
const valid = { assetId: "123", conditionId: CONDITION, side: "BUY", type: "LIMIT", price: "0.013", size: "5" };

const post = (body: unknown, raw = false) =>
  POST(new Request("http://127.0.0.1:3737/api/orders", { method: "POST", body: raw ? (body as string) : JSON.stringify(body) }), {});
const del = (id: string) =>
  DELETE(new Request(`http://127.0.0.1:3737/api/orders/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

const instance = <T extends object>(proto: object, props: Record<string, unknown> = {}) =>
  Object.assign(Object.create(proto) as T, props);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  getSecureClient.mockResolvedValue({});
});

describe("POST /api/orders", () => {
  it("returns the order id and status", async () => {
    placeOrder.mockResolvedValue({ ok: true, orderId: "0x1", status: "live", settling: false });
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderId: "0x1", status: "live", settling: false });
    expect(placeOrder).toHaveBeenCalledWith(valid);
  });

  it.each([
    ["not JSON", "{nope", true],
    ["float number", { ...valid, price: 0.013 }, false],
    ["exponent", { ...valid, size: "1e3" }, false],
    ["bad side", { ...valid, side: "HOLD" }, false],
    ["bad condition", { ...valid, conditionId: "0x12" }, false],
    ["non-numeric asset", { ...valid, assetId: "abc" }, false],
    ["unknown field", { ...valid, maxOrderUsdc: "1000" }, false],
    ["too many decimals", { ...valid, price: "0.0123456789" }, false],
  ])("400 INVALID_BODY for %s, without calling placement", async (_name, body, raw) => {
    const res = await post(body, raw);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_BODY");
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("422 with the validation code", async () => {
    placeOrder.mockResolvedValue({ ok: false, code: "OFF_TICK", message: "Price must be a multiple of 0.01" });
    const res = await post(valid);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "OFF_TICK", message: "Price must be a multiple of 0.01" } });
  });

  it("503 NOT_CONFIGURED, 429 RATE_LIMITED, 400 BAD_REQUEST, generic 502", async () => {
    placeOrder.mockRejectedValueOnce(new NotConfiguredError());
    expect((await post(valid)).status).toBe(503);
    placeOrder.mockRejectedValueOnce(instance(RateLimitError.prototype));
    const limited = await post(valid);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    placeOrder.mockRejectedValueOnce(instance(UserInputError.prototype));
    expect((await post(valid)).status).toBe(400);
    placeOrder.mockRejectedValueOnce(new Error("secret internals 0xKEY"));
    const upstream = await post(valid);
    expect(upstream.status).toBe(502);
    expect(JSON.stringify(await upstream.json())).not.toContain("0xKEY");
  });
});

describe("DELETE /api/orders/[id]", () => {
  it("cancels and reports the id", async () => {
    cancelOrder.mockResolvedValue({ canceled: ["abc123"], notCanceled: {} });
    const res = await del("abc123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canceled: "abc123" });
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), { orderId: "abc123" });
  });

  it("400 for a malformed id, before any SDK call", async () => {
    for (const id of ["a/b", "x".repeat(101), "a b", "a;b"]) {
      expect((await del(id)).status).toBe(400);
    }
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("404 when the venue did not cancel it", async () => {
    cancelOrder.mockResolvedValue({ canceled: [], notCanceled: { abc123: "order can't be found" } });
    const res = await del("abc123");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_CANCELED");
  });

  it("maps SDK errors by instanceof", async () => {
    cancelOrder.mockRejectedValueOnce(instance(RequestRejectedError.prototype, { status: 404 }));
    expect((await del("abc123")).status).toBe(404);
    cancelOrder.mockRejectedValueOnce(instance(RequestRejectedError.prototype, { status: 500 }));
    expect((await del("abc123")).status).toBe(502);
    cancelOrder.mockRejectedValueOnce(instance(RateLimitError.prototype));
    expect((await del("abc123")).status).toBe(429);
    getSecureClient.mockRejectedValueOnce(new NotConfiguredError());
    expect((await del("abc123")).status).toBe(503);
  });
});
