import { createPublicClient, createSecureClient } from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { AssetType } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { formatUnits } from "viem";
import { z } from "zod";
import type { Env } from "./parse-env";

/**
 * Client construction and access reads with no `server-only` and no module state, so
 * `scripts/doctor.ts` can reuse them. App code goes through `src/server/*`, which adds
 * `server-only` and memoisation. Never log the private key.
 */

export class NotConfiguredError extends Error {
  constructor() {
    super("Wallet not configured: set POLYMARKET_PRIVATE_KEY and POLYMARKET_WALLET_ADDRESS");
    this.name = "NotConfiguredError";
  }
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type SecureClient = Awaited<ReturnType<typeof createSecureClient>>;

export function buildPublicClient(): PublicClient {
  return createPublicClient();
}

export async function buildSecureClient(env: Env): Promise<SecureClient> {
  if (!env.privateKey || !env.walletAddress) throw new NotConfiguredError();
  return createSecureClient({ wallet: env.walletAddress, signer: privateKey(env.privateKey) });
}

export const GEOBLOCK_URL = "https://polymarket.com/api/geoblock";
const GEOBLOCK_TIMEOUT_MS = 5000;

export type Geoblock = { blocked: boolean; country: string; region: string };

const geoblockSchema = z.object({
  blocked: z.boolean(),
  country: z.string().default(""),
  region: z.string().nullish(),
});

/** Fetches geoblock status. The response `ip` field is deliberately dropped (privacy). Throws on failure. */
export async function fetchGeoblock(fetchImpl: typeof fetch = fetch): Promise<Geoblock> {
  const res = await fetchImpl(GEOBLOCK_URL, {
    signal: AbortSignal.timeout(GEOBLOCK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`geoblock endpoint returned HTTP ${res.status}`);
  const parsed = geoblockSchema.parse(await res.json());
  return { blocked: parsed.blocked, country: parsed.country, region: parsed.region ?? "" };
}

/** pUSD collateral balance in whole dollars (pUSD has 6 decimals), as a decimal string. */
export async function fetchPusdBalance(client: SecureClient): Promise<string> {
  const res = await fetchBalanceAllowance(client, { assetType: AssetType.COLLATERAL });
  return formatUnits(BigInt(res.balance), 6);
}
