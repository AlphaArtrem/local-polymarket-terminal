import "server-only";
import { SignerType, WalletType } from "@polymarket/client";
import { jsonError } from "@/lib/http";
import { EnvError } from "@/lib/parse-env";
import {
  BRIDGE_ASSETS_URL,
  BRIDGE_DEPOSIT_URL,
  bridgeDepositSchema,
  pickEvmAddress,
  polygonMinimums,
  supportedAssetsSchema,
  type DepositInfo,
  type PolygonMinimum,
} from "@/lib/deposit";
import { accountError } from "./orders/errors";
import { getSecureClient } from "./polymarket";

/**
 * Read-only: asks Polymarket's bridge for the deposit address of the account wallet. The app never
 * sends, bridges or signs anything. The POST may create an address mapping upstream (F29).
 */

const TIMEOUT_MS = 10_000;

class DepositError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "DepositError";
  }
}

async function fetchMinimums(): Promise<PolygonMinimum[] | null> {
  try {
    const res = await fetch(BRIDGE_ASSETS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const mins = polygonMinimums(supportedAssetsSchema.parse(await res.json()));
    return mins.length > 0 ? mins : null;
  } catch (err) {
    console.error("bridge supported-assets failed:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

async function fetchEvm(wallet: string): Promise<string> {
  let evm: string | null;
  try {
    const res = await fetch(BRIDGE_DEPOSIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address: wallet }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    evm = pickEvmAddress(bridgeDepositSchema.parse(await res.json()));
  } catch (err) {
    console.error("bridge deposit failed:", err instanceof Error ? err.name : "unknown");
    throw new DepositError(502, "BAD_UPSTREAM", "Could not get a deposit address from Polymarket");
  }
  if (!evm) throw new DepositError(502, "BAD_UPSTREAM", "Polymarket returned an invalid deposit address");
  return evm;
}

export async function getDepositInfo(): Promise<DepositInfo> {
  const client = await getSecureClient();
  const { signer, wallet, walletType } = client.account;
  // Never deposit to an address the bridge could not credit: a smart-wallet type whose wallet is the
  // signer itself, or an account whose wallet was not derived from this signer.
  const sameAsSigner = wallet.toLowerCase() === signer.toLowerCase();
  if (client.account.signerType === SignerType.SESSION_KEY || (walletType !== WalletType.EOA && sameAsSigner)) {
    throw new DepositError(409, "WALLET_CONFIG", "Account wallet does not match the connected signer; check the account wallet setting");
  }
  const evm = await fetchEvm(wallet);
  const minimums = await fetchMinimums();
  return { wallet, walletType: WalletType[walletType] ?? String(walletType), evm, minimums };
}

export async function respondDeposit(): Promise<Response> {
  try {
    return Response.json(await getDepositInfo(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const mapped = accountError(err);
    if (mapped) return mapped;
    if (err instanceof EnvError) return jsonError(500, "CONFIG_ERROR", err.message);
    if (err instanceof DepositError) return jsonError(err.status, err.code, err.message);
    console.error("deposit request failed:", err instanceof Error ? err.name : "unknown");
    return jsonError(502, "UPSTREAM_ERROR", "Polymarket request failed");
  }
}
