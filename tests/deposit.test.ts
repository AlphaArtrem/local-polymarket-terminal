import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { WalletType } from "@polymarket/client";
import { groupAddress, polygonMinimums, supportedAssetsSchema } from "@/lib/deposit";
import bridgeDeposit from "./fixtures/bridge-deposit.json";
import supportedAssets from "./fixtures/bridge-supported-assets.json";

// Synthetic addresses only.
const SIGNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";

const state = vi.hoisted(() => ({
  configured: true,
  account: { signer: "", wallet: "", walletType: 0, signerType: "OWNER" },
}));

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient: vi.fn(async () => {
      if (!state.configured) throw new NotConfiguredError();
      return { account: state.account };
    }),
  };
});
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockBridge(opts: { deposit?: unknown; assets?: "fail" | unknown } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/deposit")) return json(opts.deposit ?? bridgeDeposit);
    if (opts.assets === "fail") throw new Error("down");
    return json(opts.assets ?? supportedAssets);
  });
}

async function post() {
  const { POST } = await import("@/app/api/deposit/route");
  return POST(new Request("http://127.0.0.1/api/deposit", { method: "POST" }), {});
}

beforeEach(() => {
  fetchMock.mockReset();
  state.configured = true;
  state.account = { signer: SIGNER, wallet: WALLET, walletType: WalletType.POLY_PROXY, signerType: "OWNER" };
});

describe("POST /api/deposit", () => {
  it("posts the account wallet once, never the signer, and returns a checksummed address", async () => {
    mockBridge();
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("https://bridge.polymarket.com/deposit");
    expect(JSON.parse(posts[0][1].body)).toEqual({ address: WALLET });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(SIGNER);
    const body = (await res.json()) as { wallet: string; walletType: string; evm: string; minimums: unknown };
    expect(body.evm).toBe(getAddress(bridgeDeposit.address.evm));
    expect(body.walletType).toBe("POLY_PROXY");
    expect(body.minimums).toEqual([
      { token: "USDC.e", minUsd: 2 },
      { token: "USDC", minUsd: 2 },
    ]);
  });

  it("409 when a non-EOA wallet equals the signer", async () => {
    mockBridge();
    state.account = { signer: SIGNER, wallet: SIGNER, walletType: WalletType.POLY_PROXY, signerType: "OWNER" };
    const res = await post();
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 WALLET_CONFIG for a SESSION_KEY account", async () => {
    mockBridge();
    state.account = { ...state.account, signerType: "SESSION_KEY" };
    const res = await post();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("WALLET_CONFIG");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502 and no address when the bridge address is malformed", async () => {
    mockBridge({ deposit: { ...bridgeDeposit, address: { ...bridgeDeposit.address, evm: "0xnothex" } } });
    const res = await post();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("BAD_UPSTREAM");
    expect(text).not.toContain("0xnothex");
    expect(text).not.toContain(bridgeDeposit.address.evm);
  });

  it("returns the address with minimums null when supported-assets fails", async () => {
    mockBridge({ assets: "fail" });
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { evm: string; minimums: unknown };
    expect(body.evm).toBe(getAddress(bridgeDeposit.address.evm));
    expect(body.minimums).toBeNull();
  });

  it("503 when not configured", async () => {
    state.configured = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
  });

  it("route and server sources use no order, transfer or withdraw action", () => {
    for (const file of ["src/app/api/deposit/route.ts", "src/server/deposit.ts"]) {
      // Comments may say "never sends"; only code matters.
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(text).not.toMatch(/placeOrder|placeLimitOrder|placeMarketOrder|transfer|send|withdraw/i);
    }
  });
});

describe("deposit helpers", () => {
  it("keeps Polygon USDC and USDC.e minimums only", () => {
    const mins = polygonMinimums(supportedAssetsSchema.parse(supportedAssets));
    expect(mins.length).toBeGreaterThan(0);
    expect(mins.every((m) => m.token === "USDC" || m.token === "USDC.e")).toBe(true);
  });

  it("groups an address in 4-character groups", () => {
    expect(groupAddress("0x12345678")).toBe("0x12 3456 78");
  });
});
