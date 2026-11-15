import "server-only";
import { SignerType, WalletType } from "@polymarket/client";
import { transferErc20 } from "@polymarket/client/actions";
import { getAddress, isAddress, zeroAddress } from "viem";
import { BRIDGE_ASSETS_URL, supportedAssetsSchema } from "@/lib/deposit";
import { jsonError } from "@/lib/http";
import { EnvError } from "@/lib/parse-env";
import { fetchPolBalance, fetchPusdBalance } from "@/lib/polymarket-core";
import {
  BRIDGE_QUOTE_URL,
  BRIDGE_WITHDRAW_URL,
  POLYGON_CHAIN_ID,
  PUSD_DECIMALS,
  bridgeQuoteSchema,
  bridgeWithdrawSchema,
  buildDestinations,
  checkRecipient,
  findDestination,
  fromBaseUnits,
  toBaseUnits,
  type WithdrawDestination,
  type WithdrawOptions,
  type WithdrawQuote,
  type WithdrawRequest,
  type WithdrawResult,
} from "@/lib/withdraw";
import { currentPath, RelayerKeyMissingError, requirePol } from "./approvals";
import { getEnv } from "./env";
import { accountError, tradingError } from "./orders/errors";
import { getSecureClient } from "./polymarket";

/**
 * Withdraw: ask the bridge for a one-off address for (chain, token, recipient), then send pUSD from the
 * account wallet to it. Every refusal runs before the address is requested and before any transfer.
 */

export { RelayerKeyMissingError };
const TIMEOUT_MS = 10_000;
export const CONFIRM_TIMEOUT_MS = 60_000;

export class WithdrawError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "WithdrawError";
  }
}

const upstream = (msg: string) => new WithdrawError(502, "BAD_UPSTREAM", msg);

async function fetchDestinations(): Promise<WithdrawDestination[]> {
  let dests: WithdrawDestination[];
  try {
    const res = await fetch(BRIDGE_ASSETS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dests = buildDestinations(supportedAssetsSchema.parse(await res.json()));
  } catch (err) {
    console.error("bridge supported-assets failed:", err instanceof Error ? err.name : "unknown");
    throw upstream("Could not load withdrawal destinations from Polymarket");
  }
  if (dests.length === 0) throw upstream("Polymarket returned no withdrawal destinations");
  return dests;
}

type Client = Awaited<ReturnType<typeof getSecureClient>>;

/**
 * pUSD address from the client's environment. The SDK documents `client.environment.contracts` but its
 * public types omit it, so read it through a narrow shape and validate it before funds move.
 */
function pusdAddress(client: Client): `0x${string}` {
  const token = (client as unknown as { environment?: { contracts?: { collateralToken?: string } } }).environment?.contracts?.collateralToken;
  if (!token || !isAddress(token, { strict: false })) throw new WithdrawError(500, "CONFIG_ERROR", "pUSD token address unavailable");
  return getAddress(token);
}

/** Same wallet-config refusal as deposit: funds must never move for a wallet the bridge cannot match. */
function assertWalletConfig(client: Client): void {
  const { signer, wallet, walletType, signerType } = client.account;
  const sameAsSigner = wallet.toLowerCase() === signer.toLowerCase();
  if (signerType === SignerType.SESSION_KEY || (walletType !== WalletType.EOA && sameAsSigner)) {
    throw new WithdrawError(409, "WALLET_CONFIG", "Account wallet does not match the connected signer; check the account wallet setting");
  }
}

export async function getWithdrawOptions(): Promise<WithdrawOptions> {
  const client = await getSecureClient();
  assertWalletConfig(client);
  const path = await currentPath(client);
  const [balance, polBalance, destinations] = await Promise.all([
    fetchPusdBalance(client),
    path === "onchain" ? fetchPolBalance(getEnv().polygonRpcUrl, client.account.signer) : Promise.resolve(null),
    fetchDestinations(),
  ]);
  return { wallet: client.account.wallet, balance, path, polBalance, destinations };
}

export async function quoteWithdraw(req: WithdrawRequest): Promise<WithdrawQuote> {
  const client = await getSecureClient();
  const destinations = await fetchDestinations();
  const found = findDestination(destinations, req.chainId, req.tokenAddress);
  if (!found) throw new WithdrawError(400, "UNSUPPORTED_DESTINATION", "That chain and token are not available for withdrawal");
  const recipient = checkRecipient(req.recipient, client.account.wallet);
  if (!recipient) throw new WithdrawError(400, "INVALID_RECIPIENT", "Enter a different, valid EVM address");
  const base = toBaseUnits(req.amount, PUSD_DECIMALS);
  if (base === null || base <= 0n) throw new WithdrawError(400, "INVALID_AMOUNT", "Enter an amount greater than zero");
  try {
    const res = await fetch(BRIDGE_QUOTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fromAmountBaseUnit: base.toString(),
        fromChainId: POLYGON_CHAIN_ID,
        fromTokenAddress: pusdAddress(client),
        recipientAddress: recipient,
        toChainId: found.chain.chainId,
        toTokenAddress: found.token.address,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = bridgeQuoteSchema.parse(await res.json());
    const fb = q.estFeeBreakdown;
    const totalFeeUsd = fb?.totalImpactUsd === undefined ? null : fb.totalImpactUsd + (fb.gasUsd ?? 0);
    return {
      estOutputUsd: q.estOutputUsd,
      estReceived: fromBaseUnits(q.estToTokenBaseUnit, found.token.decimals),
      minReceived: fb?.minReceived ?? null,
      totalFeeUsd,
      estCheckoutTimeMs: q.estCheckoutTimeMs ?? null,
    };
  } catch (err) {
    console.error("bridge quote failed:", err instanceof Error ? err.name : "unknown");
    throw new WithdrawError(502, "QUOTE_UNAVAILABLE", "Could not get a quote from Polymarket");
  }
}

/** Resolves to the work's value, or null when `ms` passes first. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Fresh one-off bridge address; never cached. Refuses any address that could misroute the funds. */
async function fetchBridgeAddress(wallet: string, signer: string, recipient: string, chainId: string, tokenAddress: string): Promise<string> {
  let evm: string;
  try {
    const res = await fetch(BRIDGE_WITHDRAW_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address: wallet, toChainId: chainId, toTokenAddress: tokenAddress, recipientAddr: recipient }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    evm = bridgeWithdrawSchema.parse(await res.json()).address.evm;
  } catch (err) {
    console.error("bridge withdraw failed:", err instanceof Error ? err.name : "unknown");
    throw upstream("Could not get a withdrawal address from Polymarket");
  }
  if (!isAddress(evm, { strict: false })) throw upstream("Polymarket returned an invalid withdrawal address");
  const addr = getAddress(evm);
  const banned = [wallet, recipient, signer, zeroAddress].map((a) => a.toLowerCase());
  if (banned.includes(addr.toLowerCase())) throw upstream("Polymarket returned an unusable withdrawal address");
  return addr;
}

async function run(req: WithdrawRequest): Promise<WithdrawResult> {
  const client = await getSecureClient();
  assertWalletConfig(client);
  const { wallet, signer } = client.account;
  const path = await currentPath(client);
  if (path === "unavailable") throw new RelayerKeyMissingError(signer);

  const found = findDestination(await fetchDestinations(), req.chainId, req.tokenAddress);
  if (!found) throw new WithdrawError(400, "UNSUPPORTED_DESTINATION", "That chain and token are not available for withdrawal");
  const recipient = checkRecipient(req.recipient, wallet);
  if (!recipient) throw new WithdrawError(400, "INVALID_RECIPIENT", "Enter a different, valid EVM address");

  const amount = toBaseUnits(req.amount, PUSD_DECIMALS);
  if (amount === null || amount <= 0n) throw new WithdrawError(400, "INVALID_AMOUNT", "Enter an amount greater than zero");
  if (Number(req.amount) < found.token.minUsd) {
    throw new WithdrawError(400, "BELOW_MINIMUM", `The minimum withdrawal to ${found.token.symbol} on ${found.chain.chainName} is $${found.token.minUsd}`);
  }
  const balance = toBaseUnits(await fetchPusdBalance(client), PUSD_DECIMALS) ?? 0n;
  if (amount > balance) throw new WithdrawError(409, "INSUFFICIENT_BALANCE", "The amount is more than the pUSD balance");
  if (path === "onchain") await requirePol(signer);

  const bridgeAddress = await fetchBridgeAddress(wallet, signer, recipient, found.chain.chainId, found.token.address);
  const handle = await transferErc20(client, {
    amount,
    recipientAddress: bridgeAddress,
    tokenAddress: pusdAddress(client),
  });
  const outcome = await withTimeout(handle.wait(), CONFIRM_TIMEOUT_MS);
  const status = outcome ? "confirmed" : "submitted";
  console.info(`[withdraw] chain=${found.chain.chainId} status=${status}`);
  return {
    status,
    txHash: outcome ? outcome.transactionHash : (handle.transactionHash ?? ""),
    bridgeAddress,
    amount: req.amount,
    chainId: found.chain.chainId,
    tokenAddress: found.token.address,
    recipient,
  };
}

// One withdrawal at a time: a second call is refused, never merged (bodies may differ).
let inFlight: Promise<WithdrawResult> | null = null;

export function withdraw(req: WithdrawRequest): Promise<WithdrawResult> {
  if (inFlight) return Promise.reject(new WithdrawError(409, "WITHDRAW_IN_PROGRESS", "Another withdrawal is still in progress"));
  const p = run(req).finally(() => {
    inFlight = null;
  });
  inFlight = p;
  return p;
}

/** Maps any withdraw failure to a JSON error response. */
export function withdrawError(err: unknown): Response {
  if (err instanceof WithdrawError) return jsonError(err.status, err.code, err.message);
  if (err instanceof RelayerKeyMissingError) return jsonError(400, "RELAYER_KEY_REQUIRED", err.message);
  if (err instanceof EnvError) return jsonError(500, "CONFIG_ERROR", err.message);
  return accountError(err) ?? tradingError(err, "withdraw");
}
