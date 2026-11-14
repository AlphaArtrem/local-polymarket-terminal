import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SecureClient } from "@/lib/polymarket-core";
import type { AccountInfo, AccountMode } from "@/lib/wallet-protocol";
import { getEnv } from "../env";

/**
 * Per-request account for wallet mode. Background code (automation) runs outside any request, so it
 * has no context and getSecureClient() refuses in wallet mode (H22).
 */
export type AccountContext = {
  client: SecureClient;
  info: Pick<AccountInfo, "source" | "gasless" | "relayerMismatch">;
};

export const accountContext = new AsyncLocalStorage<AccountContext>();

/** Exclusive modes: a key in the env means key mode; otherwise a browser wallet is connected. */
export function getAccountMode(): AccountMode {
  return getEnv().privateKey ? "key" : "wallet";
}

export function runWithAccount<T>(ctx: AccountContext, fn: () => Promise<T>): Promise<T> {
  return accountContext.run(ctx, fn);
}
