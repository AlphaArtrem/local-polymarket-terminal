import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, WalletType } from "@polymarket/client";

// The SDK client is mocked: these tests never submit an on-chain approval.
const fetchTradingApprovalsState = vi.fn();
const setupTradingApprovals = vi.fn();
// Smart-wallet account that is gasless (matching relayer key): the pre-Phase-10 behaviour.
const account = { signer: "0x" + "1".repeat(40), walletType: WalletType.POLY_PROXY };
const getSecureClient = vi.fn(async () => ({ account, fetchTradingApprovalsState, setupTradingApprovals }));
let gasless = true;

vi.mock("@/server/env", () => ({ getEnv: () => ({ polygonRpcUrl: "https://rpc.invalid" }) }));
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));
vi.mock("@/lib/polymarket-core", async (orig) => ({ ...(await orig<object>()), fetchPolBalance: vi.fn(async () => "1.0") }));

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient,
    getCurrentAccountExtras: async () => ({ source: "env", gasless, relayerMismatch: false }),
  };
});

const { GET, POST } = await import("@/app/api/approvals/route");
const approvals = await import("@/server/approvals");
const sleep = vi.fn(async () => undefined);
approvals.setSleepForTests(sleep);
const { NotConfiguredError } = await import("@/server/polymarket");

const get = () => GET(new Request("http://127.0.0.1/api/approvals"), {});
const post = () => POST(new Request("http://127.0.0.1/api/approvals", { method: "POST" }), {});

const missingState = {
  isFullyApproved: false,
  missing: { erc20: [{ spenderAddress: "0x1" }], erc1155: [{ operatorAddress: "0x2" }, { operatorAddress: "0x3" }] },
};
const approvedState = { isFullyApproved: true, missing: { erc20: [], erc1155: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  gasless = true;
  account.walletType = WalletType.POLY_PROXY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("GET /api/approvals", () => {
  it("reports missing approvals with a count", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: false, missing: 3, path: "gasless", txCount: 1, polBalance: null });
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("returns 503 NOT_CONFIGURED without a key", async () => {
    getSecureClient.mockRejectedValueOnce(new NotConfiguredError());
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });
});

describe("POST /api/approvals", () => {
  it("submits approvals when missing and returns the new state", async () => {
    fetchTradingApprovalsState.mockResolvedValueOnce(missingState).mockResolvedValueOnce(approvedState);
    setupTradingApprovals.mockResolvedValue(undefined);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: true, missing: 0, path: "gasless", txCount: 0, polBalance: null });
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
  });

  it("re-reads the lagging state after submit until approved", async () => {
    fetchTradingApprovalsState
      .mockResolvedValueOnce(missingState) // before submit
      .mockResolvedValueOnce(missingState) // right after: still lagging
      .mockResolvedValueOnce(missingState)
      .mockResolvedValueOnce(approvedState);
    setupTradingApprovals.mockResolvedValue(undefined);
    const res = await post();
    expect(await res.json()).toEqual({ approved: true, missing: 0, path: "gasless", txCount: 0, polBalance: null });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last re-read and reports what is still missing", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    setupTradingApprovals.mockResolvedValue(undefined);
    const res = await post();
    expect(await res.json()).toEqual({ approved: false, missing: 3, path: "gasless", txCount: 1, polBalance: null });
    expect(sleep).toHaveBeenCalledTimes(approvals.RECHECK_ATTEMPTS - 1);
  });

  it("returns 400 RELAYER_KEY_REQUIRED without a relayer key, submitting nothing", async () => {
    gasless = false;
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    const res = await post();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("RELAYER_KEY_REQUIRED");
    expect(body.error.message).toContain("polymarket.com");
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("does nothing when already approved", async () => {
    fetchTradingApprovalsState.mockResolvedValue(approvedState);
    const res = await post();
    expect(await res.json()).toEqual({ approved: true, missing: 0, path: "gasless", txCount: 0, polBalance: null });
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("submits only once for concurrent requests", async () => {
    fetchTradingApprovalsState.mockResolvedValueOnce(missingState).mockResolvedValue(approvedState);
    let release: () => void = () => undefined;
    setupTradingApprovals.mockReturnValue(new Promise<void>((r) => (release = r)));
    const first = post();
    const second = post();
    await vi.waitFor(() => expect(setupTradingApprovals).toHaveBeenCalled());
    release();
    await Promise.all([first, second]);
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
  });

  it("maps SDK rate limits to 429", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    setupTradingApprovals.mockRejectedValue(Object.create(RateLimitError.prototype));
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});
