import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { polygon } from "viem/chains";
import type { ResolvedAccount } from "@/lib/polymarket-core";
import type { OpEnvelope, OpKind } from "@/lib/wallet-protocol";
import { getEnv } from "../env";
import { BridgeSigner } from "./bridge-signer";
import { errorBody, Operation } from "./operation";

export const COOKIE = "pmterm_wallet";
/** Idle and absolute lifetimes; the session is also lost on server restart. */
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a finished envelope stays fetchable, so a closed tab can still see what happened (H20). */
const RECENT_TTL_MS = 10 * 60 * 1000;

/** Not Secure: the app is plain HTTP on loopback. */
export const cookieOptions = { httpOnly: true, sameSite: "strict", path: "/" } as const;

export type WalletSession = {
  /** SHA-256 of the cookie token; the token itself is never stored. */
  tokenHash: Buffer;
  signer: `0x${string}`;
  walletOverride?: string;
  bridge: BridgeSigner;
  /** L2 creds live inside this client, in server memory only. */
  account: ResolvedAccount | null;
  op: Operation | null;
  recent: Map<string, OpEnvelope>;
  createdAt: number;
  lastSeen: number;
};

// globalThis singleton so Next dev HMR does not drop the session or duplicate the slot.
const STORE_KEY = Symbol.for("pmterm.walletSession");
type Store = { session: WalletSession | null };
function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[STORE_KEY] ??= { session: null });
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** The session bound to the request's cookie, or null (no cookie, wrong token, expired). */
export async function currentSession(): Promise<WalletSession | null> {
  const s = store().session;
  if (!s) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const given = hashToken(token);
  if (given.length !== s.tokenHash.length || !timingSafeEqual(given, s.tokenHash)) return null;
  const now = Date.now();
  if (now - s.lastSeen > IDLE_TTL_MS || now - s.createdAt > ABSOLUTE_TTL_MS) {
    endSession();
    return null;
  }
  s.lastSeen = now;
  return s;
}

/** Replaces any existing session (one active slot) and returns the new token for the cookie. */
export function beginConnect(address: string, walletOverride?: string): { token: string; session: WalletSession } {
  if (!isAddress(address, { strict: false })) throw new Error("Invalid address");
  if (walletOverride !== undefined && !isAddress(walletOverride, { strict: false })) throw new Error("Invalid account wallet");
  endSession();
  const signer = getAddress(address);
  const rpc = createPublicClient({ chain: polygon, transport: http(getEnv().polygonRpcUrl) });
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: WalletSession = {
    tokenHash: hashToken(token),
    signer,
    walletOverride: walletOverride ? getAddress(walletOverride) : undefined,
    bridge: new BridgeSigner(signer, { rpc }),
    account: null,
    op: null,
    recent: new Map(),
    createdAt: now,
    lastSeen: now,
  };
  store().session = session;
  return { token, session };
}

/**
 * Drops the session. Does NOT call endAuthentication: that revokes the API key server-side, which
 * would also break the same account's other sessions. Only local subscriptions are closed.
 */
export function endSession(): void {
  const s = store().session;
  if (!s) return;
  store().session = null;
  s.op?.fail(new Error("Session ended"));
  s.bridge.detach();
  s.op = null;
  s.account?.client.closeSubscriptions().catch((err: unknown) => {
    console.error(`[wallet] closeSubscriptions failed: ${err instanceof Error ? err.name : "error"}`);
  });
  s.account = null;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, { ...cookieOptions, maxAge: ABSOLUTE_TTL_MS / 1000 });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

/**
 * Starts the session's one interactive operation and runs `work` in the background. The signer is
 * attached for exactly its lifetime. The finished envelope is kept 10 min under the op id.
 */
export function startOperation(
  session: WalletSession,
  kind: OpKind,
  work: () => Promise<{ status: number; body: unknown }>,
): Operation {
  const op = new Operation(kind);
  session.op = op;
  session.bridge.attach(op);
  void work()
    .then((r) => op.settle(r))
    .catch((err: unknown) => {
      console.error(`[wallet] ${kind} operation failed: ${err instanceof Error ? err.name : "error"}`);
      op.settle({ status: 500, body: errorBody("OP_FAILED", err instanceof Error ? err.message : "Operation failed") });
    })
    .finally(() => {
      void op.next(0).then((env) => {
        session.recent.set(op.id, env);
        setTimeout(() => session.recent.delete(op.id), RECENT_TTL_MS).unref();
      });
      if (session.op === op) {
        session.op = null;
        session.bridge.detach();
      }
    });
  return op;
}

/** True while `session` is still the active slot (it may have been replaced during a long op). */
export function isCurrent(session: WalletSession): boolean {
  return store().session === session;
}
