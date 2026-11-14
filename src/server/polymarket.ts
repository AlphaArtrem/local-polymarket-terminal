import "server-only";
import {
  buildPublicClient,
  buildSecureClient,
  NotConfiguredError,
  type PublicClient,
  type ResolvedAccount,
  type SecureClient,
} from "@/lib/polymarket-core";
import { accountContext, getAccountMode } from "./account/context";
import { getEnv } from "./env";

export { NotConfiguredError };
export type { ResolvedAccount };

/** Wallet mode, and no browser session is attached to this request. */
export class WalletNotConnectedError extends NotConfiguredError {
  constructor() {
    super("Wallet not connected: connect a browser wallet");
    this.name = "WalletNotConnectedError";
  }
}

let publicClient: PublicClient | undefined;
let envAccountPromise: Promise<ResolvedAccount> | undefined;

export function getPublicClient(): PublicClient {
  publicClient ??= buildPublicClient();
  return publicClient;
}

/** Key mode with a key present. */
export function isConfigured(): boolean {
  return Boolean(getEnv().privateKey);
}

/** Key mode only. Lazy, memoised. Throws NotConfiguredError without a key. A failed creation is not cached. */
export function getEnvAccount(): Promise<ResolvedAccount> {
  if (!envAccountPromise) {
    envAccountPromise = buildSecureClient(getEnv()).catch((err: unknown) => {
      envAccountPromise = undefined;
      throw err;
    });
  }
  return envAccountPromise;
}

export async function getEnvSecureClient(): Promise<SecureClient> {
  return (await getEnvAccount()).client;
}

/** Request-scoped client (wallet mode) when present; else the env client in key mode; else rejects. */
export function getSecureClient(): Promise<SecureClient> {
  const ctx = accountContext.getStore();
  if (ctx) return Promise.resolve(ctx.client);
  if (getAccountMode() === "key") return getEnvSecureClient();
  return Promise.reject(new WalletNotConnectedError());
}

export async function getCurrentAccountExtras(): Promise<{
  source: ResolvedAccount["source"] | null;
  gasless: boolean;
  relayerMismatch: boolean;
}> {
  const ctx = accountContext.getStore();
  if (ctx) return ctx.info;
  const { source, gasless, relayerMismatch } = await getEnvAccount();
  return { source, gasless, relayerMismatch };
}
