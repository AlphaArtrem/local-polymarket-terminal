import "server-only";
import {
  buildPublicClient,
  buildSecureClient,
  NotConfiguredError,
  type PublicClient,
  type SecureClient,
} from "@/lib/polymarket-core";
import { getEnv } from "./env";

export { NotConfiguredError };

let publicClient: PublicClient | undefined;
let securePromise: Promise<SecureClient> | undefined;

export function getPublicClient(): PublicClient {
  publicClient ??= buildPublicClient();
  return publicClient;
}

export function isConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.privateKey && env.walletAddress);
}

/** Lazy, memoised. Throws NotConfiguredError without a key. A failed creation is not cached. */
export function getSecureClient(): Promise<SecureClient> {
  if (!securePromise) {
    securePromise = buildSecureClient(getEnv()).catch((err: unknown) => {
      securePromise = undefined;
      throw err;
    });
  }
  return securePromise;
}
