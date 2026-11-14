import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError } from "@polymarket/client";

// The SDK client is mocked: these tests never submit an on-chain approval.
const fetchTradingApprovalsState = vi.fn();
const setupTradingApprovals = vi.fn();
const getSecureClient = vi.fn(async () => ({ fetchTradingApprovalsState, setupTradingApprovals }));

let relayer: { key: string; address: string } | undefined = { key: "test-relayer-key", address: "0x" + "1".repeat(40) };
vi.mock("@/server/env", () => ({ getEnv: () => ({ relayer }) }));

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  return { NotConfiguredError, getSecureClient };
});

const { GET, POST } = await import("@/app/api/approvals/route");
const { NotConfiguredError } = await import("@/server/polymarket");

const missingState = {
  isFullyApproved: false,
  missing: { erc20: [{ spenderAddress: "0x1" }], erc1155: [{ operatorAddress: "0x2" }, { operatorAddress: "0x3" }] },
};
const approvedState = { isFullyApproved: true, missing: { erc20: [], erc1155: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  relayer = { key: "test-relayer-key", address: "0x" + "1".repeat(40) };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("GET /api/approvals", () => {
  it("reports missing approvals with a count", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: false, missing: 3 });
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("returns 503 NOT_CONFIGURED without a key", async () => {
    getSecureClient.mockRejectedValueOnce(new NotConfiguredError());
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });
});

describe("POST /api/approvals", () => {
  it("submits approvals when missing and returns the new state", async () => {
    fetchTradingApprovalsState.mockResolvedValueOnce(missingState).mockResolvedValueOnce(approvedState);
    setupTradingApprovals.mockResolvedValue(undefined);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: true, missing: 0 });
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
  });

  it("returns 400 RELAYER_KEY_REQUIRED without a relayer key, submitting nothing", async () => {
    relayer = undefined;
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    const res = await POST();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("RELAYER_KEY_REQUIRED");
    expect(body.error.message).toContain("POLYMARKET_RELAYER_API_KEY");
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("does nothing when already approved", async () => {
    fetchTradingApprovalsState.mockResolvedValue(approvedState);
    const res = await POST();
    expect(await res.json()).toEqual({ approved: true, missing: 0 });
    expect(setupTradingApprovals).not.toHaveBeenCalled();
  });

  it("submits only once for concurrent requests", async () => {
    fetchTradingApprovalsState.mockResolvedValueOnce(missingState).mockResolvedValue(approvedState);
    let release: () => void = () => undefined;
    setupTradingApprovals.mockReturnValue(new Promise<void>((r) => (release = r)));
    const first = POST();
    const second = POST();
    await vi.waitFor(() => expect(setupTradingApprovals).toHaveBeenCalled());
    release();
    await Promise.all([first, second]);
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
  });

  it("maps SDK rate limits to 429", async () => {
    fetchTradingApprovalsState.mockResolvedValue(missingState);
    setupTradingApprovals.mockRejectedValue(Object.create(RateLimitError.prototype));
    const res = await POST();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});
