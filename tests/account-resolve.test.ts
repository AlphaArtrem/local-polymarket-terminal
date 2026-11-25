import { describe, expect, it, vi } from "vitest";
import { SignerType, type Signer } from "@polymarket/client";
import {
  AccountLookupError,
  keySigner,
  relayerFor,
  resolveAccount,
  WalletNotDeployedError,
  WalletNotOwnedError,
  type ResolveDeps,
} from "@/lib/polymarket-core";
import { parseEnv } from "@/lib/parse-env";
import { sdkFetch } from "@/lib/sdk-fetch";

// The SDK viem adapter is mocked so we can inspect the options keySigner passes.
const privateKeyMock = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ tag: "key-signer", args })));
vi.mock("@polymarket/client/viem", () => ({ privateKey: privateKeyMock }));

const SIGNER = "0x" + "11".repeat(20);
const PROFILE_WALLET = "0x" + "22".repeat(20);
const OVERRIDE = "0x" + "33".repeat(20);
const RELAYER_ADDR = "0x" + "44".repeat(20);
const signer = {} as Signer;
const base = { signer, signerAddress: SIGNER as `0x${string}`, polygonRpcUrl: "https://rpc.example.com", relayer: undefined };

function setup(over: { profile?: string | null | Error; code?: `0x${string}` | undefined; signerType?: SignerType } = {}) {
  const createSecureClient = vi.fn(async (...args: unknown[]) => ({ args, account: { signerType: over.signerType ?? SignerType.OWNER } }));
  const fetchProfileWallet = vi.fn(async () => {
    if (over.profile instanceof Error) throw over.profile;
    return over.profile ?? null;
  });
  const getCode = vi.fn(async () => ("code" in over ? over.code : ("0x6080" as const)));
  const deps = { createSecureClient, fetchProfileWallet, getCode } as unknown as Partial<ResolveDeps>;
  return { deps, createSecureClient, fetchProfileWallet, getCode };
}

const optionsOf = (spy: ReturnType<typeof setup>["createSecureClient"]) =>
  spy.mock.calls[0]![0] as { wallet?: string; apiKey?: unknown; fetch?: unknown };

describe("resolveAccount", () => {
  it("override wins over the profile", async () => {
    const t = setup({ profile: PROFILE_WALLET });
    const r = await resolveAccount({ ...base, walletOverride: OVERRIDE, walletSource: "env" }, t.deps);
    expect(optionsOf(t.createSecureClient).wallet).toBe(OVERRIDE);
    expect(t.fetchProfileWallet).not.toHaveBeenCalled();
    expect(r.source).toBe("env");
  });

  it("uses the profile wallet without an override", async () => {
    const t = setup({ profile: PROFILE_WALLET });
    const r = await resolveAccount(base, t.deps);
    expect(optionsOf(t.createSecureClient).wallet).toBe(PROFILE_WALLET);
    expect(r.source).toBe("profile");
  });

  it("gives the secure client the User-Agent fetch (H26)", async () => {
    const t = setup({ profile: PROFILE_WALLET });
    await resolveAccount(base, t.deps);
    expect(optionsOf(t.createSecureClient).fetch).toBe(sdkFetch);
  });

  it("falls back to an EOA on a 404 (null) profile", async () => {
    const t = setup({ profile: null });
    const r = await resolveAccount(base, t.deps);
    expect(optionsOf(t.createSecureClient).wallet).toBe(SIGNER);
    expect(t.getCode).not.toHaveBeenCalled();
    expect(r.source).toBe("eoa-default");
  });

  it("throws AccountLookupError on a lookup failure and never creates a client", async () => {
    const t = setup({ profile: new AccountLookupError("503") });
    await expect(resolveAccount(base, t.deps)).rejects.toBeInstanceOf(AccountLookupError);
    expect(t.createSecureClient).not.toHaveBeenCalled();
  });

  it("refuses a non-signer wallet with no code before creating a client", async () => {
    for (const code of [undefined, "0x" as const]) {
      const t = setup({ profile: PROFILE_WALLET, code });
      await expect(resolveAccount(base, t.deps)).rejects.toBeInstanceOf(WalletNotDeployedError);
      expect(t.createSecureClient).not.toHaveBeenCalled();
    }
  });

  it("wraps an eth_getCode failure as AccountLookupError without creating a client", async () => {
    const t = setup({ profile: PROFILE_WALLET });
    t.getCode.mockRejectedValueOnce(new Error("rpc down"));
    await expect(resolveAccount(base, t.deps)).rejects.toBeInstanceOf(AccountLookupError);
    expect(t.createSecureClient).not.toHaveBeenCalled();
  });

  it("always passes an explicit wallet to createSecureClient", async () => {
    for (const args of [{}, { walletOverride: OVERRIDE }]) {
      for (const profile of [null, PROFILE_WALLET]) {
        const t = setup({ profile });
        await resolveAccount({ ...base, ...args }, t.deps);
        expect(optionsOf(t.createSecureClient).wallet).toEqual(expect.stringMatching(/^0x[0-9a-f]{40}$/));
      }
    }
  });

  it("throws WalletNotOwnedError for a SESSION_KEY result", async () => {
    const t = setup({ profile: null, signerType: SignerType.SESSION_KEY });
    await expect(resolveAccount(base, t.deps)).rejects.toBeInstanceOf(WalletNotOwnedError);
  });

  it("passes the relayer key only when its address matches the signer", async () => {
    const match = setup({ profile: null });
    const ok = await resolveAccount({ ...base, relayer: { key: "k", address: SIGNER.toUpperCase().replace("0X", "0x") } }, match.deps);
    expect(optionsOf(match.createSecureClient).apiKey).toBeDefined();
    expect(ok).toMatchObject({ gasless: true, relayerMismatch: false });

    const other = setup({ profile: null });
    const bad = await resolveAccount({ ...base, relayer: { key: "k", address: RELAYER_ADDR } }, other.deps);
    expect(optionsOf(other.createSecureClient).apiKey).toBeUndefined();
    expect(bad).toMatchObject({ gasless: false, relayerMismatch: true });
  });
});

describe("relayerFor", () => {
  it("reports no mismatch without a relayer key", () => {
    expect(relayerFor(undefined, SIGNER)).toEqual({ mismatch: false });
  });
});

describe("keySigner", () => {
  it("builds the signer with a transport from POLYGON_RPC_URL", () => {
    const key = "0x" + "ab".repeat(32);
    const env = parseEnv({ POLYMARKET_PRIVATE_KEY: key, POLYGON_RPC_URL: "https://rpc.example.com/x" });
    const { address } = keySigner(env);
    const [passedKey, opts] = privateKeyMock.mock.calls[0]!;
    expect(passedKey).toBe(key);
    const o = opts as { chain: { id: number }; transport: unknown };
    expect(o.chain.id).toBe(137);
    expect(typeof o.transport).toBe("function");
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
