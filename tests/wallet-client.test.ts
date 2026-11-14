import { describe, expect, it, vi } from "vitest";
import { removeEip712Domain, walletFetch, type WalletController } from "@/lib/wallet-client";
import { encodeJson, OP_HEADER, type OpEnvelope, type PendingSign } from "@/lib/wallet-protocol";

const SIG = `0x${"ab".repeat(65)}` as const;
const json = (body: unknown, status = 200, op = false) =>
  new Response(JSON.stringify(body), { status, headers: op ? { [OP_HEADER]: "1", "content-type": "application/json" } : {} });
const envelope = (e: OpEnvelope, status = 202) => json(e, status, true);

const pending = (payload: unknown, kind: PendingSign["kind"] = "signTypedData"): PendingSign => ({
  opId: "op1",
  requestId: "r1",
  kind,
  summary: "Sign order",
  payload: encodeJson(payload),
});

function controller(over: Partial<WalletController> = {}): WalletController & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    address: "0x1111111111111111111111111111111111111111",
    ensurePolygon: vi.fn(async () => void calls.push("ensurePolygon")),
    signTypedData: vi.fn(async () => (calls.push("signTypedData"), SIG)),
    signMessage: vi.fn(async () => SIG),
    sendTransaction: vi.fn(async () => `0x${"cd".repeat(32)}` as const),
    ...over,
  };
}

describe("removeEip712Domain", () => {
  it("strips only the EIP712Domain key", () => {
    const types = { EIP712Domain: [{ name: "name", type: "string" }], Order: [{ name: "salt", type: "uint256" }] };
    expect(removeEip712Domain(types)).toEqual({ Order: types.Order });
    expect(types.EIP712Domain).toBeDefined();
  });
});

describe("walletFetch", () => {
  it("passes responses without the op header through untouched", async () => {
    const res = json({ ok: 1 });
    const f = vi.fn(async () => res);
    const out = await walletFetch("/api/x", { method: "POST" }, { fetch: f, controller: controller() });
    expect(out).toBe(res);
    expect(f).toHaveBeenCalledOnce();
  });

  it("runs the loop: needs-wallet, signs with decoded bigints, preserves the inner status", async () => {
    const c = controller();
    const typed = { domain: { chainId: 137 }, types: { Order: [] }, primaryType: "Order", message: { salt: 12345678901234567890n } };
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ state: "needs-wallet", pending: pending(typed) }))
      .mockResolvedValueOnce(envelope({ state: "done", opId: "op1", status: 422, body: { error: { code: "X" } } }, 200));
    const onPending = vi.fn();
    const out = await walletFetch("/api/orders", { method: "POST" }, { fetch: f, controller: c, onPending });

    expect(c.calls).toEqual(["ensurePolygon", "signTypedData"]);
    expect(c.signTypedData).toHaveBeenCalledWith(typed);
    const [url, init] = f.mock.calls[1];
    expect(url).toBe("/api/wallet/respond");
    expect(JSON.parse(String(init?.body))).toEqual({ opId: "op1", requestId: "r1", result: { signature: SIG } });
    expect(out.status).toBe(422);
    expect(await out.json()).toEqual({ error: { code: "X" } });
    expect(onPending.mock.calls.map((a) => a[0] === null)).toEqual([false, true]);
  });

  it("replies {rejected:true} on a 4001 user rejection", async () => {
    const c = controller({ signTypedData: vi.fn(async () => { throw Object.assign(new Error("denied"), { code: 4001 }); }) });
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ state: "needs-wallet", pending: pending({ primaryType: "Order", types: {}, message: {}, domain: {} }) }))
      .mockResolvedValueOnce(envelope({ state: "done", opId: "op1", status: 400, body: {} }, 200));
    await walletFetch("/api/orders", {}, { fetch: f, controller: c });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).result).toEqual({ rejected: true });
  });

  it("polls the ops URL while the server is working", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ state: "working", opId: "op/1" }))
      .mockResolvedValueOnce(envelope({ state: "done", opId: "op/1", status: 200, body: { ok: true } }, 200));
    const out = await walletFetch("/api/redeem", {}, { fetch: f, controller: controller(), pollDelayMs: 0 });
    expect(f.mock.calls[1][0]).toBe("/api/wallet/ops/op%2F1");
    expect(await out.json()).toEqual({ ok: true });
  });

  it("rejects the request when this tab has no wallet controller", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ state: "needs-wallet", pending: pending({}) }))
      .mockResolvedValueOnce(envelope({ state: "done", opId: "op1", status: 400, body: {} }, 200));
    await walletFetch("/api/orders", {}, { fetch: f, controller: null });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).result).toMatchObject({ rejected: true });
  });

  it("lets the prompt cancel a pending signature", async () => {
    const c = controller({ signTypedData: vi.fn(() => new Promise<`0x${string}`>(() => undefined)) });
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ state: "needs-wallet", pending: pending({ primaryType: "Order", types: {}, message: {}, domain: {} }) }))
      .mockResolvedValueOnce(envelope({ state: "done", opId: "op1", status: 400, body: {} }, 200));
    const onPending = vi.fn((p: PendingSign | null, cancel: () => void) => {
      if (p) setTimeout(cancel, 0);
    });
    await walletFetch("/api/orders", {}, { fetch: f, controller: c, onPending });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).result).toEqual({ rejected: true });
  });
});
