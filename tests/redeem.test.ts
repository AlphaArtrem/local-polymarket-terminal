import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError } from "@polymarket/client";

// Everything on-chain is mocked: these tests never submit a redemption.
const COND = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const TX = "0x" + "12".repeat(32);

const redeemPositions = vi.fn();
vi.mock("@polymarket/client/actions", () => ({ redeemPositions }));

let relayer: { key: string; address: string } | undefined = { key: "k", address: "0x" + "1".repeat(40) };
vi.mock("@/server/env", () => ({ getEnv: () => ({ relayer }) }));

const getSecureClient = vi.fn(async () => ({ client: true }));
vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  return { NotConfiguredError, getSecureClient };
});

const getPositions = vi.fn();
vi.mock("@/server/portfolio", () => ({ getPositions }));

const { POST } = await import("@/app/api/redeem/route");

const position = (conditionId: string, redeemable: boolean) => ({ conditionId, redeemable });
const req = (body: unknown) =>
  new Request("http://127.0.0.1/api/redeem", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const handle = (wait: () => Promise<unknown>) => ({ transactionHash: TX, transactionId: null, wait });

beforeEach(() => {
  vi.clearAllMocks();
  relayer = { key: "k", address: "0x" + "1".repeat(40) };
  getPositions.mockResolvedValue({ items: [position(COND, true)], nextCursor: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.useRealTimers());

describe("POST /api/redeem validation", () => {
  it.each([
    ["missing field", {}],
    ["bad hex", { conditionId: "0x123" }],
    ["extra key", { conditionId: COND, amount: 1 }],
    ["not json", "nope"],
  ])("rejects %s with 400 INVALID_BODY and leaves the SDK alone", async (_n, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_BODY");
    expect(redeemPositions).not.toHaveBeenCalled();
    expect(getSecureClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/redeem", () => {
  it("returns 400 RELAYER_KEY_REQUIRED without a relayer key", async () => {
    relayer = undefined;
    const res = await POST(req({ conditionId: COND }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("RELAYER_KEY_REQUIRED");
    expect(redeemPositions).not.toHaveBeenCalled();
  });

  it("returns 409 NOTHING_TO_REDEEM when no redeemable position exists", async () => {
    getPositions.mockResolvedValue({ items: [position(COND, false), position(OTHER, true)], nextCursor: null });
    const res = await POST(req({ conditionId: COND }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_TO_REDEEM");
    expect(redeemPositions).not.toHaveBeenCalled();
  });

  it("finds a redeemable position on a later page", async () => {
    getPositions
      .mockResolvedValueOnce({ items: [position(OTHER, true)], nextCursor: "c2" })
      .mockResolvedValueOnce({ items: [position(COND, true)], nextCursor: null });
    redeemPositions.mockResolvedValue(handle(async () => ({ transactionHash: TX, transactionId: "id" })));
    const res = await POST(req({ conditionId: COND }));
    expect(res.status).toBe(200);
    expect(getPositions).toHaveBeenLastCalledWith("OPEN", "c2");
  });

  it("confirms and returns the transaction hash", async () => {
    redeemPositions.mockResolvedValue(handle(async () => ({ transactionHash: TX, transactionId: "id" })));
    const res = await POST(req({ conditionId: COND }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conditionId: COND, txHash: TX, status: "confirmed" });
    expect(redeemPositions).toHaveBeenCalledWith({ client: true }, { conditionId: COND });
  });

  it("reports submitted when confirmation times out", async () => {
    vi.useFakeTimers();
    redeemPositions.mockResolvedValue(handle(() => new Promise(() => undefined)));
    const pending = POST(req({ conditionId: COND }));
    await vi.advanceTimersByTimeAsync(60_001);
    const res = await pending;
    expect(await res.json()).toEqual({ conditionId: COND, txHash: TX, status: "submitted" });
  });

  it("submits once for concurrent calls on the same condition", async () => {
    let release: () => void = () => undefined;
    redeemPositions.mockResolvedValue(
      handle(() => new Promise((r) => (release = () => r({ transactionHash: TX, transactionId: null })))),
    );
    const first = POST(req({ conditionId: COND }));
    const second = POST(req({ conditionId: COND }));
    await vi.waitFor(() => expect(redeemPositions).toHaveBeenCalled());
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(await a.json()).toEqual(await b.json());
    expect(redeemPositions).toHaveBeenCalledTimes(1);
  });

  it("maps SDK rate limits to 429", async () => {
    redeemPositions.mockRejectedValue(Object.create(RateLimitError.prototype));
    const res = await POST(req({ conditionId: COND }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});
