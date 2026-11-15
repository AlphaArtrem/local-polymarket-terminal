import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";
import type { SupportedAssets } from "./deposit";
import type { ApprovalPath } from "./wallet-protocol";

/**
 * Pure helpers and the API contract for withdrawals. Nothing here talks to the network, so the
 * withdraw dialog (client) and the server route share one set of rules.
 *
 * Flow (docs.polymarket.com/trading/bridge/withdraw, F42): the server asks the bridge for a one-off
 * address tied to (chain, token, recipient), then sends pUSD from the account wallet to it. The
 * bridge unwraps and swaps it and pays the recipient on the chosen chain.
 */

export const BRIDGE_WITHDRAW_URL = "https://bridge.polymarket.com/withdraw";
export const BRIDGE_QUOTE_URL = "https://bridge.polymarket.com/quote";

/** pUSD has 6 decimals (F17). */
export const PUSD_DECIMALS = 6;
export const POLYGON_CHAIN_ID = "137";
/** Native USDC on Polygon: the default destination. */
export const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

/**
 * EVM chains offered as destinations. The bridge lists more (Solana, Tron, Bitcoin, Hypercore, …), but
 * the recipient field takes an EVM address only, so the list is fixed to chains where that is certain.
 */
export const WITHDRAW_CHAINS: Readonly<Record<string, string>> = {
  "137": "Polygon",
  "1": "Ethereum",
  "8453": "Base",
  "42161": "Arbitrum",
  "10": "Optimism",
  "56": "BNB Smart Chain",
};

export type WithdrawToken = { symbol: string; name: string; address: string; decimals: number; minUsd: number };
export type WithdrawDestination = { chainId: string; chainName: string; tokens: WithdrawToken[] };

/** GET /api/withdraw */
export type WithdrawOptions = {
  wallet: string;
  /** pUSD balance of the account wallet, decimal string. */
  balance: string;
  /** Same matrix as Enable trading: onchain (EOA pays POL), gasless, or unavailable. */
  path: ApprovalPath;
  /** Signer POL balance on the onchain path, else null. */
  polBalance: string | null;
  destinations: WithdrawDestination[];
};

/** Body of POST /api/withdraw and POST /api/withdraw/quote. */
export const withdrawRequestSchema = z
  .object({
    /** pUSD, decimal string with at most 6 decimals. */
    amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "amount must be a decimal with at most 6 decimals"),
    chainId: z.string().regex(/^\d{1,12}$/),
    tokenAddress: z.string().refine((a) => isAddress(a, { strict: false }), "tokenAddress must be an EVM address"),
    recipient: z.string().refine((a) => isAddress(a, { strict: false }), "recipient must be an EVM address"),
  })
  .strict();
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

/** POST /api/withdraw/quote: an estimate only; the bridge may pay a little less. */
export type WithdrawQuote = {
  estOutputUsd: number;
  /** Destination token, decimal string. */
  estReceived: string;
  minReceived: number | null;
  totalFeeUsd: number | null;
  estCheckoutTimeMs: number | null;
};

/** POST /api/withdraw */
export type WithdrawResult = {
  status: "confirmed" | "submitted";
  txHash: string;
  /** The bridge address the pUSD went to; its progress is at bridge /status/<address>. */
  bridgeAddress: string;
  amount: string;
  chainId: string;
  tokenAddress: string;
  recipient: string;
};

export const bridgeWithdrawSchema = z.object({
  address: z.object({ evm: z.string() }),
  note: z.string().optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
});

export const bridgeQuoteSchema = z.object({
  estCheckoutTimeMs: z.number().optional(),
  estInputUsd: z.number().optional(),
  estOutputUsd: z.number(),
  estToTokenBaseUnit: z.string(),
  quoteId: z.string().optional(),
  estFeeBreakdown: z
    .object({ minReceived: z.number().optional(), totalImpactUsd: z.number().optional(), gasUsd: z.number().optional() })
    .partial()
    .optional(),
});

/** "12.5" → 12500000n for a token with `decimals`; null when malformed or too precise. */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] + frac.padEnd(decimals, "0"));
}

/** 12500000n, 6 → "12.5" (no trailing zeros, no exponent). */
export function fromBaseUnits(value: bigint | string, decimals: number): string {
  const v = typeof value === "bigint" ? value : BigInt(value);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Checksummed recipient, or null when it cannot receive (invalid, zero address, or the account wallet itself). */
export function checkRecipient(recipient: string, accountWallet: string): string | null {
  if (!isAddress(recipient, { strict: false })) return null;
  const r = getAddress(recipient);
  if (r === zeroAddress) return null;
  if (r.toLowerCase() === accountWallet.toLowerCase()) return null;
  return r;
}

/** The destination token entry for (chain, token), or null when it is not offered. */
export function findDestination(
  destinations: readonly WithdrawDestination[],
  chainId: string,
  tokenAddress: string,
): { chain: WithdrawDestination; token: WithdrawToken } | null {
  const chain = destinations.find((d) => d.chainId === chainId);
  const token = chain?.tokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());
  return chain && token ? { chain, token } : null;
}

/** Destinations from the bridge /supported-assets payload: allowlisted EVM chains, valid token addresses only. */
/** Stablecoins most people withdraw to come first, in this order; everything else alphabetically. */
const STABLE_ORDER = ["USDC", "USDC.e", "USDT", "USD₮0", "DAI"];
function byStableFirst(x: WithdrawToken, y: WithdrawToken): number {
  const rank = (t: WithdrawToken) => {
    const i = STABLE_ORDER.indexOf(t.symbol);
    return i === -1 ? STABLE_ORDER.length : i;
  };
  return rank(x) - rank(y) || x.symbol.localeCompare(y.symbol);
}

export function buildDestinations(assets: SupportedAssets): WithdrawDestination[] {
  const byChain = new Map<string, WithdrawToken[]>();
  for (const a of assets.supportedAssets) {
    const { address, decimals, name, symbol } = a.token;
    if (!(a.chainId in WITHDRAW_CHAINS)) continue;
    // pUSD is what is being withdrawn; offering it as the destination would round-trip through the bridge.
    if (symbol.toLowerCase() === "pusd") continue;
    if (!address || !isAddress(address, { strict: false }) || decimals === undefined || !Number.isInteger(decimals)) continue;
    const tokens = byChain.get(a.chainId) ?? [];
    tokens.push({ symbol, name: name ?? symbol, address: getAddress(address), decimals, minUsd: a.minCheckoutUsd });
    byChain.set(a.chainId, tokens);
  }
  // Integer-like keys iterate numerically, so pin Polygon first explicitly.
  const order = [POLYGON_CHAIN_ID, ...Object.keys(WITHDRAW_CHAINS).filter((id) => id !== POLYGON_CHAIN_ID)];
  return order
    .filter((id) => byChain.has(id))
    .map((chainId) => ({
      chainId,
      chainName: WITHDRAW_CHAINS[chainId],
      tokens: [...(byChain.get(chainId) ?? [])].sort(byStableFirst),
    }));
}
