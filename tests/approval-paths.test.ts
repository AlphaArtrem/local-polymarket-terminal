import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletType } from "@polymarket/client";

// The three-path matrix (EOA onchain / smart wallet gasless / smart wallet unavailable) for approvals
// and redeem, plus the engine's pinned client. Everything is mocked: nothing is submitted.
const SIGNER = "0x" + "1".repeat(40);
const COND = "0x" + "ab".repeat(32);

const fetchTradingApprovalsState = vi.fn();
const setupTradingApprovals = vi.fn();
const account = { signer: SIGNER, walletType: WalletType.EOA as WalletType };
const client = { account, fetchTradingApprovalsState, setupTradingApprovals };
let gasless = false;
let pol = "1.0";

vi.mock("@/server/env", () => ({ getEnv: () => ({ polygonRpcUrl: "https://rpc.invalid" }) }));
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));
vi.mock("@/lib/polymarket-core", async (orig) => ({ ...(await orig<object>()), fetchPolBalance: vi.fn(async () => pol) }));
vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient: async () => client,
    getCurrentAccountExtras: async () => ({ source: "env", gasless, relayerMismatch: false }),
  };
});
const redeemPositions = vi.fn();
vi.mock("@polymarket/client/actions", () => ({ redeemPositions }));
vi.mock("@/server/portfolio", () => ({ getPositions: async () => ({ items: [{ conditionId: COND, redeemable: true }], nextCursor: null }) }));

const approvals = await import("@/server/approvals");
approvals.setSleepForTests(async () => undefined);
const approvalsRoute = await import("@/app/api/approvals/route");
const redeemRoute = await import("@/app/api/redeem/route");

const missing = { isFullyApproved: false, missing: { erc20: [{}], erc1155: [{}, {}] } };
const approved = { isFullyApproved: true, missing: { erc20: [], erc1155: [] } };
const postApprovals = () => approvalsRoute.POST(new Request("http://127.0.0.1/api/approvals", { method: "POST" }), {});
const postRedeem = () =>
  redeemRoute.POST(new Request("http://127.0.0.1/api/redeem", { method: "POST", body: JSON.stringify({ conditionId: COND }) }), {});
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  vi.clearAllMocks();
  account.walletType = WalletType.EOA;
  gasless = false;
  pol = "1.0";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("approvalPath", () => {
  it("maps account type and relayer match to a path", () => {
    expect(approvals.approvalPath(WalletType.EOA, true)).toBe("onchain");
    expect(approvals.approvalPath(WalletType.EOA, false)).toBe("onchain");
    expect(approvals.approvalPath(WalletType.GNOSIS_SAFE, true)).toBe("gasless");
    expect(approvals.approvalPath(WalletType.DEPOSIT_WALLET, false)).toBe("unavailable");
  });
});

describe("approvals by path", () => {
  it("EOA without a relayer key runs setupTradingApprovals and reports one tx per approval", async () => {
    fetchTradingApprovalsState.mockResolvedValueOnce(missing).mockResolvedValueOnce(missing).mockResolvedValueOnce(approved);
    const res = await postApprovals();
    expect(res.status).toBe(200);
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ approved: true, path: "onchain", txCount: 0, polBalance: "1.0" });
  });

  it("EOA status shows txCount = missing and the POL balance", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missing);
    const res = await approvalsRoute.GET(new Request("http://127.0.0.1/api/approvals"), {});
    expect(await res.json()).toMatchObject({ path: "onchain", missing: 3, txCount: 3, polBalance: "1.0" });
  });

  it("EOA with POL 0 gets 409 NEEDS_POL and setup is not called", async () => {
    pol = "0";
    fetchTradingApprovalsState.mockResolvedValue(missing);
    const res = await postApprovals();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("NEEDS_POL");
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("Safe without a relayer key gets 400 RELAYER_KEY_REQUIRED", async () => {
    account.walletType = WalletType.GNOSIS_SAFE;
    fetchTradingApprovalsState.mockResolvedValue(missing);
    const res = await postApprovals();
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RELAYER_KEY_REQUIRED");
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("Safe with a matching key goes gasless without a POL check", async () => {
    account.walletType = WalletType.GNOSIS_SAFE;
    gasless = true;
    pol = "0";
    fetchTradingApprovalsState.mockResolvedValueOnce(missing).mockResolvedValueOnce(missing).mockResolvedValueOnce(approved);
    const res = await postApprovals();
    expect(res.status).toBe(200);
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ path: "gasless", polBalance: null });
  });
});

describe("redeem by path", () => {
  const handle = { transactionHash: "0x" + "12".repeat(32), wait: async () => ({ transactionHash: "0x" + "12".repeat(32) }) };

  it("EOA without a relayer key redeems", async () => {
    redeemPositions.mockResolvedValue(handle);
    expect((await postRedeem()).status).toBe(200);
    expect(redeemPositions).toHaveBeenCalledTimes(1);
  });

  it("EOA with POL 0 gets 409 NEEDS_POL and nothing is submitted", async () => {
    pol = "0";
    const res = await postRedeem();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("NEEDS_POL");
    expect(redeemPositions).not.toHaveBeenCalled();
  });

  it("Safe without a key gets RELAYER_KEY_REQUIRED; with a matching key it redeems", async () => {
    account.walletType = WalletType.GNOSIS_SAFE;
    const refused = await postRedeem();
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("RELAYER_KEY_REQUIRED");
    expect(redeemPositions).not.toHaveBeenCalled();

    gasless = true;
    redeemPositions.mockResolvedValue(handle);
    expect((await postRedeem()).status).toBe(200);
  });
});
