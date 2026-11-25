import {
  createPublicClient,
  createSecureClient,
  forkEnvironmentConfig,
  relayerApiKey,
  SignerType,
  type RelayerApiKeyConfig,
  type Signer,
} from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { AssetType } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { createPublicClient as createChainClient, formatEther, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { z } from "zod";
import type { Env } from "./parse-env";
import { sdkFetch } from "./sdk-fetch";
import type { WalletSource } from "./wallet-protocol";

/**
 * Client construction and access reads with no `server-only` and no module state, so
 * `scripts/doctor.ts` can reuse them. App code goes through `src/server/*`, which adds
 * `server-only` and memoisation. The key is passed in, never read from process.env. Never log it.
 */

export class NotConfiguredError extends Error {
  constructor(message = "Wallet not configured: set POLYMARKET_PRIVATE_KEY (optionally POLYMARKET_WALLET_ADDRESS)") {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** Profile lookup failed for a reason other than "not found". Never falls back to EOA (H18). */
export class AccountLookupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccountLookupError";
  }
}

/** The chosen non-signer wallet has no code on-chain; creating a client could deploy one (H17). */
export class WalletNotDeployedError extends Error {
  constructor(wallet: string) {
    super(`Account wallet ${wallet} is not deployed on Polygon. Finish setup on polymarket.com, or trade as the signer's EOA.`);
    this.name = "WalletNotDeployedError";
  }
}

/** The SDK classified the wallet as SESSION_KEY: the address is not derivable from this signer. */
export class WalletNotOwnedError extends Error {
  constructor(wallet: string) {
    super(`Account wallet ${wallet} does not belong to the connected signer.`);
    this.name = "WalletNotOwnedError";
  }
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type SecureClient = Awaited<ReturnType<typeof createSecureClient>>;

export function buildPublicClient(): PublicClient {
  return createPublicClient({ fetch: sdkFetch });
}

export type ResolvedAccount = {
  client: SecureClient;
  source: WalletSource;
  gasless: boolean;
  relayerMismatch: boolean;
};

export type ResolveDeps = {
  /** Profile wallet for a signer; null on 404 / no wallet; throws AccountLookupError otherwise. */
  fetchProfileWallet(address: string): Promise<string | null>;
  getCode(address: string): Promise<`0x${string}` | undefined>;
  createSecureClient: typeof createSecureClient;
};

/** The relayer key is used only when its address is the active signer's (F14f, assumed). */
export function relayerFor(
  relayer: Env["relayer"],
  signer: string,
): { config?: RelayerApiKeyConfig; mismatch: boolean } {
  if (!relayer) return { mismatch: false };
  if (relayer.address.toLowerCase() === signer.toLowerCase()) return { config: relayer, mismatch: false };
  return { mismatch: true };
}

function defaultDeps(rpcUrl: string): ResolveDeps {
  const chain = () => createChainClient({ chain: polygon, transport: http(rpcUrl) });
  return {
    async fetchProfileWallet(address) {
      try {
        // The SDK maps a 404 to null; every other failure throws (E8, E10).
        const profile = await buildPublicClient().fetchPublicProfile({ address });
        return profile?.wallet ?? null;
      } catch (err) {
        throw new AccountLookupError("Could not look up the Polymarket profile for this signer", { cause: err });
      }
    },
    getCode: (address) => chain().getCode({ address: address as `0x${string}` }),
    createSecureClient,
  };
}

/**
 * Picks the account wallet and builds the secure client.
 * 1. override; 2. public profile (404 -> signer as EOA, other errors throw); 3. a non-signer wallet
 * must have code on-chain, checked BEFORE createSecureClient so the SDK can never deploy one (H17);
 * 4. createSecureClient always gets an explicit `wallet`; 5. SESSION_KEY result is refused.
 */
export async function resolveAccount(
  args: {
    signer: Signer;
    signerAddress: `0x${string}`;
    walletOverride?: string;
    walletSource?: "env" | "user";
    polygonRpcUrl: string;
    relayer: Env["relayer"];
  },
  deps: Partial<ResolveDeps> = {},
): Promise<ResolvedAccount> {
  const d: ResolveDeps = { ...defaultDeps(args.polygonRpcUrl), ...deps };
  const { signerAddress } = args;

  let wallet: string;
  let source: WalletSource;
  if (args.walletOverride) {
    wallet = args.walletOverride;
    source = args.walletSource ?? "user";
  } else {
    const profileWallet = await d.fetchProfileWallet(signerAddress);
    if (profileWallet) {
      wallet = profileWallet;
      source = "profile";
    } else {
      wallet = signerAddress;
      source = "eoa-default";
    }
  }

  if (wallet.toLowerCase() !== signerAddress.toLowerCase()) {
    let code: `0x${string}` | undefined;
    try {
      code = await d.getCode(wallet);
    } catch (err) {
      throw new AccountLookupError("Could not check whether the account wallet is deployed", { cause: err });
    }
    if (!code || code === "0x") throw new WalletNotDeployedError(wallet);
  }

  const { config, mismatch } = relayerFor(args.relayer, signerAddress);
  const client = await d.createSecureClient({
    wallet,
    signer: args.signer,
    // Sets a User-Agent; Node's default one is refused on /v2/positions (H26).
    fetch: sdkFetch,
    // Production config with only the Polygon RPC replaced (see POLYGON_RPC_URL in parse-env.ts).
    environment: forkEnvironmentConfig({ name: "production", rpc: args.polygonRpcUrl }),
    // Gasless wallet operations are refused by the SDK without this.
    ...(config ? { apiKey: relayerApiKey(config) } : {}),
  });

  if (client.account.signerType === SignerType.SESSION_KEY) throw new WalletNotOwnedError(wallet);
  return { client, source, gasless: Boolean(config), relayerMismatch: mismatch };
}

/** Server-key signer. Transactions use POLYGON_RPC_URL, not the SDK's default transport (E7). */
export function keySigner(env: Env): { signer: Signer; address: `0x${string}` } {
  if (!env.privateKey) throw new NotConfiguredError();
  const key = env.privateKey as `0x${string}`;
  return {
    signer: privateKey(key, { chain: polygon, transport: http(env.polygonRpcUrl) }),
    address: privateKeyToAccount(key).address,
  };
}

/** Key mode only: throws NotConfiguredError without a key. */
export async function buildSecureClient(env: Env, deps?: Partial<ResolveDeps>): Promise<ResolvedAccount> {
  const { signer, address } = keySigner(env);
  return resolveAccount(
    {
      signer,
      signerAddress: address,
      walletOverride: env.walletAddress,
      walletSource: "env",
      polygonRpcUrl: env.polygonRpcUrl,
      relayer: env.relayer,
    },
    deps,
  );
}

/** Signer's POL balance as a decimal string. */
export async function fetchPolBalance(rpcUrl: string, address: string): Promise<string> {
  const balance = await createChainClient({ chain: polygon, transport: http(rpcUrl) }).getBalance({
    address: address as `0x${string}`,
  });
  return formatEther(balance);
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
