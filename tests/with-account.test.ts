import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { OpEnvelope } from "@/lib/wallet-protocol";

const env = vi.hoisted(() => ({ privateKey: undefined as string | undefined }));
const jar = vi.hoisted(() => new Map<string, string>());
const cookiesCalled = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: async () => {
    cookiesCalled();
    return { get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n: string, v: string) => void jar.set(n, v) };
  },
}));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ ...env, relayer: undefined, polygonRpcUrl: "https://rpc.example.com", automationEnabled: false }),
}));

import { jsonError } from "@/lib/http";
import { POST as respond } from "@/app/api/wallet/respond/route";
import { getSecureClient } from "@/server/polymarket";
import { withAccount } from "@/server/account/with-account";
import { beginConnect, COOKIE, endSession, setSessionCookie } from "@/server/wallet/session";

const user = privateKeyToAccount(generatePrivateKey());
const orderTyped = {
  domain: { name: "Exchange", version: "2", chainId: 137 },
  types: { Order: [{ name: "salt", type: "uint256" }] },
  primaryType: "Order" as const,
  message: { salt: 1n },
};
const req = () => new Request("http://127.0.0.1:3737/api/orders", { method: "POST", body: JSON.stringify({ a: 1 }) });
const reply = (opId: string, requestId: string, signature: `0x${string}`) =>
  respond(new Request("http://127.0.0.1:3737/api/wallet/respond", { method: "POST", body: JSON.stringify({ opId, requestId, result: { signature } }) }));

/** A wallet-mode session with a connected (fake) account. */
async function connected() {
  const { token, session } = beginConnect(user.address);
  await setSessionCookie(token);
  const client = { id: "ctx-client", closeSubscriptions: vi.fn().mockResolvedValue(undefined) };
  session.account = { client: client as never, source: "eoa-default", gasless: false, relayerMismatch: false };
  cookiesCalled.mockClear();
  return { session, client };
}

beforeEach(() => {
  jar.clear();
  cookiesCalled.mockClear();
  env.privateKey = undefined;
});
afterEach(() => endSession());

describe("withAccount", () => {
  it("in key mode calls the handler and never touches cookies", async () => {
    env.privateKey = "0x" + "ab".repeat(32);
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const res = await withAccount(handler, { interactive: "order" })(req(), {});
    expect(await res.text()).toBe("ok");
    expect(cookiesCalled).not.toHaveBeenCalled();
  });

  it("answers 401 WALLET_NOT_CONNECTED without a session, or runs the handler when optional", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("bare"));
    const res = await withAccount(handler)(req(), {});
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "WALLET_NOT_CONNECTED" } });
    expect(handler).not.toHaveBeenCalled();
    expect(await (await withAccount(handler, { optional: true })(req(), {})).text()).toBe("bare");
  });

  it("puts the session client in context for plain handlers", async () => {
    const { client } = await connected();
    const res = await withAccount(async () => Response.json({ same: (await getSecureClient()) === (client as never) }))(req(), {});
    expect(await res.json()).toEqual({ same: true });
  });

  it("runs an interactive handler: needs-wallet, reply, done with the inner status preserved", async () => {
    const { session } = await connected();
    const handler = withAccount(
      async () => {
        await session.bridge.signTypedData(orderTyped as never);
        return jsonError(422, "BELOW_MIN", "too small");
      },
      { interactive: "order" },
    );
    const first = await handler(req(), {});
    expect(first.status).toBe(202);
    expect(first.headers.get("x-pmterm-op")).toBe("1");
    const env1 = (await first.json()) as OpEnvelope;
    if (env1.state !== "needs-wallet") throw new Error("expected needs-wallet");

    // While the operation is open, a second interactive call is refused.
    const second = await withAccount(vi.fn(), { interactive: "order" })(req(), {});
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "OP_IN_PROGRESS" } });

    const signature = await user.signTypedData(orderTyped);
    const done = (await (await reply(env1.pending.opId, env1.pending.requestId, signature)).json()) as OpEnvelope;
    expect(done).toMatchObject({ state: "done", status: 422, body: { error: { code: "BELOW_MIN" } } });
    expect(session.op).toBeNull();
  });

  it("a signer call after the operation ended is inert", async () => {
    const { session } = await connected();
    const res = await withAccount(async () => Response.json({}), { interactive: "order" })(req(), {});
    expect(((await res.json()) as OpEnvelope).state).toBe("done");
    await expect(session.bridge.signTypedData(orderTyped as never)).rejects.toThrow(/no operation/);
  });
});

describe("session cookie", () => {
  it("is named pmterm_wallet", () => expect(COOKIE).toBe("pmterm_wallet"));
});
