import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletType } from "@polymarket/client";
import assets from "./fixtures/bridge-withdraw-assets.json";

// Synthetic addresses only. Nothing here reaches the SDK, the bridge or a chain.
const SIGNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB";
const BRIDGE = "0x3333333333333333333333333333333333333333";
const PUSD = "0x4444444444444444444444444444444444444444";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TX = "0x" + "12".repeat(32);

const state = vi.hoisted(() => ({ account: {} as Record<string, unknown>, path: "onchain", balance: "100", pol: "1.0" }));
const transferErc20 = vi.fn();
vi.mock("@polymarket/client/actions", () => ({ transferErc20 }));
vi.mock("@/server/env", () => ({ getEnv: () => ({ polygonRpcUrl: "https://rpc.invalid" }) }));
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));
vi.mock("@/lib/polymarket-core", async (orig) => ({
  ...(await orig<object>()),
  fetchPolBalance: vi.fn(async () => state.pol),
  fetchPusdBalance: vi.fn(async () => state.balance),
}));
vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient: async () => ({ account: state.account, environment: { contracts: { collateralToken: "0x4444444444444444444444444444444444444444" } } }),
    getCurrentAccountExtras: async () => ({ gasless: state.path === "gasless" }),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let withdrawBody: unknown;
function mockBridge(opts: { evm?: string; quote?: "fail" } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/supported-assets")) return json(assets);
    if (url.endsWith("/withdraw")) {
      withdrawBody = JSON.parse(String(init?.body));
      return json({ address: { evm: opts.evm ?? BRIDGE } });
    }
    if (url.endsWith("/quote")) {
      if (opts.quote === "fail") return json({}, 500);
      return json({ estOutputUsd: 9.9, estToTokenBaseUnit: "9900000", estCheckoutTimeMs: 5000, estFeeBreakdown: { totalImpactUsd: 0.1, gasUsd: 0.05, minReceived: 9.8 } });
    }
    throw new Error(`unexpected ${url}`);
  });
}

const { POST } = await import("@/app/api/withdraw/route");
const quoteRoute = await import("@/app/api/withdraw/quote/route");
const body = { amount: "10", chainId: "8453", tokenAddress: USDC_BASE, recipient: RECIPIENT };
const post = (b: unknown = body, h: (r: Request) => Promise<Response> = POST as never) =>
  h(new Request("http://127.0.0.1/api/withdraw", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }));
const bridgeWithdrawCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/withdraw"));
const code = async (res: Response) => (await res.json()).error.code;

beforeEach(() => {
  vi.clearAllMocks();
  state.account = { signer: SIGNER, wallet: WALLET, walletType: WalletType.EOA, signerType: "OWNER" };
  state.path = "onchain";
  state.balance = "100";
  state.pol = "1.0";
  mockBridge();
  transferErc20.mockResolvedValue({ transactionHash: TX, wait: async () => ({ transactionHash: TX }) });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("POST /api/withdraw refusals happen before the bridge address and the transfer", () => {
  const cases: [string, () => void, Record<string, unknown>, number, string][] = [
    ["unavailable path", () => { state.account.walletType = WalletType.POLY_PROXY; state.path = "unavailable"; }, body, 400, "RELAYER_KEY_REQUIRED"],
    ["unsupported destination", () => undefined, { ...body, chainId: "10" }, 400, "UNSUPPORTED_DESTINATION"],
    ["bad recipient", () => undefined, { ...body, recipient: WALLET }, 400, "INVALID_RECIPIENT"],
    ["zero amount", () => undefined, { ...body, amount: "0" }, 400, "INVALID_AMOUNT"],
    ["below minimum", () => undefined, { ...body, amount: "4.99" }, 400, "BELOW_MINIMUM"],
    ["over balance", () => { state.balance = "9.99"; }, body, 409, "INSUFFICIENT_BALANCE"],
    ["needs POL", () => { state.pol = "0"; }, body, 409, "NEEDS_POL"],
    ["wallet config", () => { state.account.signerType = "SESSION_KEY"; }, body, 409, "WALLET_CONFIG"],
  ];
  it.each(cases)("%s", async (_n, setup, b, status, errCode) => {
    setup();
    const res = await post(b);
    expect(res.status).toBe(status);
    expect(await code(res)).toBe(errCode);
    expect(bridgeWithdrawCalls()).toHaveLength(0);
    expect(transferErc20).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const res = await post({ amount: "x" });
    expect(await code(res)).toBe("INVALID_BODY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/withdraw bridge address checks", () => {
  it.each([
    ["invalid", "nope"],
    ["the wallet", WALLET],
    ["the recipient", RECIPIENT],
    ["the signer", SIGNER],
    ["zero", "0x" + "0".repeat(40)],
  ])("refuses %s without transferring", async (_n, evm) => {
    mockBridge({ evm });
    const res = await post();
    expect(res.status).toBe(502);
    expect(await code(res)).toBe("BAD_UPSTREAM");
    expect(transferErc20).not.toHaveBeenCalled();
  });
});

describe("POST /api/withdraw", () => {
  it("transfers pUSD to the bridge address once and confirms", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmed", txHash: TX, bridgeAddress: BRIDGE, chainId: "8453", recipient: RECIPIENT });
    expect(transferErc20).toHaveBeenCalledTimes(1);
    expect(transferErc20.mock.calls[0][1]).toEqual({ amount: 10_000_000n, recipientAddress: BRIDGE, tokenAddress: PUSD });
    expect(withdrawBody).toEqual({ address: WALLET, toChainId: "8453", toTokenAddress: USDC_BASE, recipientAddr: RECIPIENT });
  });

  it("returns submitted when confirmation times out", async () => {
    vi.useFakeTimers();
    transferErc20.mockResolvedValue({ transactionHash: TX, wait: () => new Promise(() => undefined) });
    const pending = post();
    await vi.advanceTimersByTimeAsync(61_000);
    const res = await pending;
    vi.useRealTimers();
    expect(await res.json()).toMatchObject({ status: "submitted", txHash: TX });
  });

  it("refuses a concurrent withdrawal", async () => {
    let release: (v: unknown) => void = () => undefined;
    transferErc20.mockReturnValue(new Promise((r) => (release = r)));
    const first = post();
    await vi.waitFor(() => expect(transferErc20).toHaveBeenCalled());
    const second = await post();
    expect(second.status).toBe(409);
    expect(await code(second)).toBe("WITHDRAW_IN_PROGRESS");
    release({ transactionHash: TX, wait: async () => ({ transactionHash: TX }) });
    expect((await first).status).toBe(200);
    expect(transferErc20).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/withdraw/quote", () => {
  const q = (b: unknown = body) => post(b, quoteRoute.POST as never);
  it("maps the bridge quote", async () => {
    const res = await q();
    expect(await res.json()).toEqual({ estOutputUsd: 9.9, estReceived: "9.9", minReceived: 9.8, totalFeeUsd: 0.15000000000000002, estCheckoutTimeMs: 5000 });
    expect(transferErc20).not.toHaveBeenCalled();
  });
  it("maps failure to QUOTE_UNAVAILABLE", async () => {
    mockBridge({ quote: "fail" });
    const res = await q();
    expect(res.status).toBe(502);
    expect(await code(res)).toBe("QUOTE_UNAVAILABLE");
  });
  it("rejects a malformed body", async () => {
    expect(await code(await q({}))).toBe("INVALID_BODY");
  });
});
