import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { OpEnvelope } from "@/lib/wallet-protocol";

// Cookie jar standing in for next/headers.
const jar = vi.hoisted(() => new Map<string, string>());
const setCookie = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
    set: (n: string, v: string, o?: { maxAge?: number }) => {
      setCookie(n, v, o);
      if (o?.maxAge === 0) jar.delete(n);
      else jar.set(n, v);
    },
  }),
}));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ privateKey: undefined, relayer: undefined, polygonRpcUrl: "https://rpc.example.com", automationEnabled: false }),
}));
const resolveAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/polymarket-core", async (orig) => ({
  ...(await orig<typeof import("@/lib/polymarket-core")>()),
  resolveAccount,
  fetchPolBalance: vi.fn().mockResolvedValue("1.5"),
}));
vi.mock("@/server/polymarket", () => ({ getEnvAccount: vi.fn() }));

import { WalletNotDeployedError } from "@/lib/polymarket-core";
import { DELETE, GET, POST } from "@/app/api/wallet/session/route";
import { POST as respond } from "@/app/api/wallet/respond/route";
import { GET as opsGet } from "@/app/api/wallet/ops/[id]/route";
import { COOKIE, currentSession, endSession } from "@/server/wallet/session";

const user = privateKeyToAccount(generatePrivateKey());
const clobAuth = {
  domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
  types: { ClobAuth: [{ name: "address", type: "address" }] },
  primaryType: "ClobAuth" as const,
  message: { address: user.address },
};

const post = (url: string, body: unknown) =>
  new Request(`http://127.0.0.1:3737${url}`, { method: "POST", body: JSON.stringify(body) });
const envelope = async (res: Response) => (await res.json()) as OpEnvelope;

function fakeAccount() {
  return {
    client: {
      account: { signer: user.address, wallet: user.address, walletType: 0, signerType: "OWNER" },
      closeSubscriptions: vi.fn().mockResolvedValue(undefined),
      endAuthentication: vi.fn(),
    },
    source: "eoa-default",
    gasless: false,
    relayerMismatch: false,
  };
}

/** resolveAccount that parks on a wallet signature, so the connect envelope is needs-wallet. */
const waitsForWallet = () =>
  resolveAccount.mockImplementation(async (args: { signer: { signTypedData(p: unknown): Promise<string> } }) => {
    await args.signer.signTypedData(clobAuth);
    return fakeAccount();
  });

beforeEach(() => {
  jar.clear();
  setCookie.mockClear();
  resolveAccount.mockReset();
});
afterEach(() => endSession());

describe("wallet session routes", () => {
  it("sets an HttpOnly, SameSite=Strict, Path=/ cookie and runs connect to done", async () => {
    const account = fakeAccount();
    resolveAccount.mockImplementation(async (args: { signer: { signTypedData(p: unknown): Promise<string> } }) => {
      await args.signer.signTypedData(clobAuth);
      return account;
    });

    const first = await POST(post("/api/wallet/session", { address: user.address }));
    expect(first.status).toBe(202);
    expect(first.headers.get("x-pmterm-op")).toBe("1");
    expect(setCookie).toHaveBeenCalledWith(COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/" }));
    expect(setCookie.mock.calls[0]![2]).not.toHaveProperty("secure");

    const env = await envelope(first);
    if (env.state !== "needs-wallet") throw new Error("expected needs-wallet");
    expect(env.pending.summary).toMatch(/ClobAuth/);
    const signature = await user.signTypedData(clobAuth);
    const done = await envelope(await respond(post("/api/wallet/respond", { opId: env.pending.opId, requestId: env.pending.requestId, result: { signature } })));
    expect(done).toMatchObject({ state: "done", status: 200, body: { connected: true, mode: "wallet", polBalance: "1.5" } });

    const info = (await (await GET()).json()) as { connected: boolean; walletType: string };
    expect(info).toMatchObject({ connected: true, walletType: "EOA" });
    // The finished envelope stays fetchable.
    const again = await opsGet(new Request("http://127.0.0.1/x"), { params: Promise.resolve({ id: env.pending.opId }) });
    expect((await envelope(again)).state).toBe("done");
  });

  it("stores only a hash and ignores a wrong token", async () => {
    waitsForWallet();
    await POST(post("/api/wallet/session", { address: user.address }));
    const session = (await currentSession())!;
    expect(session.tokenHash).toHaveLength(32);
    expect(JSON.stringify(session.tokenHash)).not.toContain(jar.get(COOKIE)!);
    jar.set(COOKIE, "wrong-token");
    expect(await currentSession()).toBeNull();
  });

  it("answers 401 on respond without a cookie, and 400 for a wrong opId", async () => {
    const body = { opId: "x", requestId: "y", result: { rejected: true } };
    expect((await respond(post("/api/wallet/respond", body))).status).toBe(401);

    waitsForWallet();
    await POST(post("/api/wallet/session", { address: user.address }));
    expect((await respond(post("/api/wallet/respond", body))).status).toBe(400);
    expect((await respond(post("/api/wallet/respond", { bad: true }))).status).toBe(400);
  });

  it("reports account errors as done envelopes and frees the slot", async () => {
    resolveAccount.mockRejectedValue(new WalletNotDeployedError("0x0000000000000000000000000000000000000001"));
    const res = await POST(post("/api/wallet/session", { address: user.address }));
    expect(await envelope(res)).toMatchObject({ state: "done", status: 409, body: { error: { code: "WALLET_CONFIG" } } });
    expect(await currentSession()).toBeNull();
  });

  it("rejects an invalid address", async () => {
    expect((await POST(post("/api/wallet/session", { address: "nope" }))).status).toBe(400);
  });

  it("DELETE ends the session, closes subscriptions, never calls endAuthentication, and clears the cookie", async () => {
    const account = fakeAccount();
    resolveAccount.mockResolvedValue(account);
    await POST(post("/api/wallet/session", { address: user.address }));
    await vi.waitFor(async () => expect((await currentSession())?.account).toBeTruthy());
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(account.client.closeSubscriptions).toHaveBeenCalledTimes(1);
    expect(account.client.endAuthentication).not.toHaveBeenCalled();
    expect(await currentSession()).toBeNull();
    expect(jar.has(COOKIE)).toBe(false);
  });

  it("a new connect replaces the active session", async () => {
    waitsForWallet();
    await POST(post("/api/wallet/session", { address: user.address }));
    const firstToken = jar.get(COOKIE);
    await POST(post("/api/wallet/session", { address: user.address }));
    expect(jar.get(COOKIE)).not.toBe(firstToken);
    jar.set(COOKIE, firstToken!);
    expect(await currentSession()).toBeNull();
  });
});
