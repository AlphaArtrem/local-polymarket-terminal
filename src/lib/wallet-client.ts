import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { polygon } from "viem/chains";
import type { Eip1193Provider } from "./eip6963";
import { decodeJson, OP_HEADER, type OpEnvelope, type PendingSign, type WalletReply } from "./wallet-protocol";

/**
 * Browser side of the signing protocol (plan S2/S4). The server parks every SDK signature request in an
 * operation; this loop fetches it, asks the extension, and posts the answer back. No SDK, no secrets here.
 */

const POLYGON_HEX = "0x89";
const USER_REJECTED = 4001;
const UNRECOGNIZED_CHAIN = 4902;
const POLL_DELAY_MS = 250;
const MAX_REASON = 300;

export type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type WalletController = {
  address: `0x${string}`;
  ensurePolygon(): Promise<void>;
  signTypedData(p: unknown): Promise<`0x${string}`>;
  signMessage(h: `0x${string}`): Promise<`0x${string}`>;
  sendTransaction(r: { to: string; data?: string; value?: bigint; chainId: number }): Promise<`0x${string}`>;
};

/** viem derives EIP712Domain itself and rejects it as an explicit type; wallets get it back from viem. */
export function removeEip712Domain<T extends Record<string, unknown>>(types: T): Omit<T, "EIP712Domain"> {
  return Object.fromEntries(Object.entries(types).filter(([k]) => k !== "EIP712Domain")) as Omit<T, "EIP712Domain">;
}

function errorCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "number") return e.code;
  return e.cause ? errorCode(e.cause) : undefined;
}

function isTypedData(p: unknown): p is TypedDataPayload {
  if (typeof p !== "object" || p === null) return false;
  const t = p as Partial<TypedDataPayload>;
  return typeof t.primaryType === "string" && typeof t.types === "object" && t.types !== null && typeof t.message === "object" && t.message !== null;
}

export function makeController(provider: Eip1193Provider, address: `0x${string}`): WalletController {
  const client = createWalletClient({ account: address, chain: polygon, transport: custom(provider as EIP1193Provider) });

  async function ensurePolygon() {
    const current = await provider.request({ method: "eth_chainId" });
    if (typeof current === "string" && current.toLowerCase() === POLYGON_HEX) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: POLYGON_HEX }] });
    } catch (err) {
      if (errorCode(err) !== UNRECOGNIZED_CHAIN) throw err;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: POLYGON_HEX,
            chainName: polygon.name,
            nativeCurrency: polygon.nativeCurrency,
            rpcUrls: [...polygon.rpcUrls.default.http],
            blockExplorerUrls: polygon.blockExplorers ? [polygon.blockExplorers.default.url] : undefined,
          },
        ],
      });
    }
  }

  return {
    address,
    ensurePolygon,
    async signTypedData(p) {
      if (!isTypedData(p)) throw new Error("Malformed typed-data request");
      return client.signTypedData({
        account: address,
        domain: p.domain,
        types: removeEip712Domain(p.types),
        primaryType: p.primaryType,
        message: p.message,
      });
    },
    signMessage: (h) => client.signMessage({ account: address, message: { raw: h } }),
    sendTransaction: (r) =>
      client.sendTransaction({
        account: address,
        chain: polygon,
        to: r.to as `0x${string}`,
        data: r.data as `0x${string}` | undefined,
        value: r.value,
      }),
  };
}

type Reply = WalletReply["result"];

function rejection(err: unknown): Reply {
  if (errorCode(err) === USER_REJECTED) return { rejected: true };
  // Any other wallet failure also ends the request, so the server operation never waits for a timeout.
  const reason = err instanceof Error ? err.message.slice(0, MAX_REASON) : "Wallet request failed";
  return { rejected: true, reason };
}

async function sign(p: PendingSign, c: WalletController): Promise<Reply> {
  const payload = decodeJson(p.payload) as Record<string, unknown> | string;
  if (p.kind === "signTypedData") return { signature: await c.signTypedData(payload) };
  if (p.kind === "signMessage") {
    const raw = typeof payload === "string" ? payload : (payload.raw ?? payload.message);
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) throw new Error("Malformed message request");
    return { signature: await c.signMessage(raw as `0x${string}`) };
  }
  if (typeof payload !== "object" || typeof payload.to !== "string" || typeof payload.chainId !== "number") {
    throw new Error("Malformed transaction request");
  }
  const value = typeof payload.value === "bigint" ? payload.value : undefined;
  const data = typeof payload.data === "string" ? payload.data : undefined;
  return { txHash: await c.sendTransaction({ to: payload.to, data, value, chainId: payload.chainId }) };
}

export type WalletFetchDeps = {
  fetch?: typeof fetch;
  controller: WalletController | null;
  /** `cancel` lets the prompt reply {rejected:true} without waiting for the extension. */
  onPending?(p: PendingSign | null, cancel: () => void): void;
  pollDelayMs?: number;
};

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function toResponse(status: number, body: unknown): Response {
  if (NULL_BODY_STATUS.has(status)) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? null), { status, headers: { "content-type": "application/json" } });
}

/**
 * fetch that understands operation envelopes. Responses without the OP_HEADER pass through untouched, so
 * key mode (and non-interactive routes) behave exactly like fetch.
 */
export async function walletFetch(url: string, init: RequestInit, deps: WalletFetchDeps): Promise<Response> {
  const f = deps.fetch ?? fetch;
  const delay = deps.pollDelayMs ?? POLL_DELAY_MS;
  let res = await f(url, init);
  if (res.headers.get(OP_HEADER) !== "1") return res;
  let polygonChecked = false;

  for (;;) {
    const env = (await res.json()) as OpEnvelope;
    if (env.state === "done") return toResponse(env.status, env.body);

    if (env.state === "working") {
      await new Promise((r) => setTimeout(r, delay));
      res = await f(`/api/wallet/ops/${encodeURIComponent(env.opId)}`, { cache: "no-store" });
    } else {
      const { pending } = env;
      let cancel: () => void = () => undefined;
      const cancelled = new Promise<Reply>((resolve) => {
        cancel = () => resolve({ rejected: true });
      });
      deps.onPending?.(pending, cancel);
      let result: Reply;
      try {
        const c = deps.controller;
        const answer = c
          ? (async (): Promise<Reply> => {
              try {
                if (!polygonChecked) {
                  await c.ensurePolygon();
                  polygonChecked = true;
                }
                return await sign(pending, c);
              } catch (err) {
                return rejection(err);
              }
            })()
          : Promise.resolve<Reply>({ rejected: true, reason: "Wallet not available in this tab. Reconnect it." });
        result = await Promise.race([answer, cancelled]);
      } finally {
        deps.onPending?.(null, cancel);
      }
      const reply: WalletReply = { opId: pending.opId, requestId: pending.requestId, result };
      res = await f("/api/wallet/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reply),
      });
    }
    // Errors from the ops/respond routes (no envelope header) go straight to the caller.
    if (res.headers.get(OP_HEADER) !== "1") return res;
  }
}
