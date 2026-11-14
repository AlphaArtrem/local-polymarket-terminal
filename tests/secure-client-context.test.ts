import { describe, expect, it, vi } from "vitest";

// Env mock: wallet mode (no key) by default; the key-mode case flips it.
const env = vi.hoisted(() => ({ privateKey: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ getEnv: () => ({ ...env, relayer: undefined, polygonRpcUrl: "https://rpc.example.com" }) }));
const buildSecureClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/polymarket-core", async (orig) => ({ ...(await orig<typeof import("@/lib/polymarket-core")>()), buildSecureClient }));

import { runWithAccount } from "@/server/account/context";
import { getSecureClient, isConfigured, WalletNotConnectedError, NotConfiguredError } from "@/server/polymarket";

describe("getSecureClient context", () => {
  it("rejects with WalletNotConnectedError in wallet mode without a context", async () => {
    env.privateKey = undefined;
    const err = await getSecureClient().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletNotConnectedError);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect(isConfigured()).toBe(false);
  });

  it("returns the context client inside runWithAccount", async () => {
    env.privateKey = undefined;
    const client = { id: "ctx" } as never;
    const got = await runWithAccount({ client, info: { source: "user", gasless: false, relayerMismatch: false } }, () => getSecureClient());
    expect(got).toBe(client);
  });

  it("uses the env account in key mode and does not cache failures", async () => {
    env.privateKey = "0x" + "ab".repeat(32);
    expect(isConfigured()).toBe(true);
    buildSecureClient.mockRejectedValueOnce(new Error("boom"));
    await expect(getSecureClient()).rejects.toThrow("boom");
    const client = { id: "env" };
    buildSecureClient.mockResolvedValueOnce({ client, source: "env", gasless: false, relayerMismatch: false });
    await expect(getSecureClient()).resolves.toBe(client);
    await getSecureClient();
    expect(buildSecureClient).toHaveBeenCalledTimes(2);
  });
});
