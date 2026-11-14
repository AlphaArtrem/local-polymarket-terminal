import "server-only";
import { WalletType } from "@polymarket/client";
import { cancelAll, cancelAllWalletOrders, cancelMarketOrders } from "@polymarket/client/actions";
import type { CancelAllResult } from "@/lib/phase7-types";
import { getSecureClient } from "../polymarket";

type Raw = { canceled: readonly string[]; notCanceled: Readonly<Record<string, string>> };

const normalize = (r: Raw): CancelAllResult => ({ canceled: [...r.canceled], notCanceled: { ...r.notCanceled } });

/**
 * Cancels every open order. A Deposit Wallet owner cancels wallet-wide (whichever signer placed the
 * order); other wallet types cancel the orders placed with this client's credentials.
 */
export async function cancelAllOrders(): Promise<CancelAllResult> {
  const client = await getSecureClient();
  const raw =
    client.account.walletType === WalletType.DEPOSIT_WALLET ? await cancelAllWalletOrders(client) : await cancelAll(client);
  const result = normalize(raw);
  console.info(`[orders] cancel all: canceled=${result.canceled.length} notCanceled=${Object.keys(result.notCanceled).length}`);
  return result;
}

/** Cancels open orders in the given markets, sequentially; one market failing does not stop the rest. */
export async function cancelOrdersInMarkets(conditionIds: string[]): Promise<CancelAllResult> {
  const client = await getSecureClient();
  const merged: CancelAllResult = { canceled: [], notCanceled: {} };
  for (const market of conditionIds) {
    try {
      const r = normalize(await cancelMarketOrders(client, { market: market as never }));
      merged.canceled.push(...r.canceled);
      Object.assign(merged.notCanceled, r.notCanceled);
    } catch (err) {
      console.error(`[orders] cancel market failed: ${err instanceof Error ? err.name : "unknown"}`);
      merged.notCanceled[`market:${market}`] = "Market orders could not be canceled";
    }
  }
  console.info(
    `[orders] cancel markets: markets=${conditionIds.length} canceled=${merged.canceled.length} notCanceled=${Object.keys(merged.notCanceled).length}`,
  );
  return merged;
}
