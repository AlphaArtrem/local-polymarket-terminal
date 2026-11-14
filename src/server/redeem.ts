import "server-only";
import { redeemPositions } from "@polymarket/client/actions";
import type { RedeemResult } from "@/lib/phase7-types";
import { getPositions } from "./portfolio";
import { getSecureClient } from "./polymarket";

export { RelayerKeyMissingError } from "./approvals";
import { currentPath, RelayerKeyMissingError, requirePol } from "./approvals";

/** The account holds no redeemable position in the requested market. */
export class NothingToRedeemError extends Error {
  constructor() {
    super("No redeemable position found for this market");
    this.name = "NothingToRedeemError";
  }
}

export const CONFIRM_TIMEOUT_MS = 60_000;
/** Pages of OPEN positions scanned for a redeemable row (50 per page). */
const MAX_SCAN_PAGES = 5;

async function holdsRedeemable(conditionId: string): Promise<boolean> {
  const wanted = conditionId.toLowerCase();
  let cursor: string | undefined;
  for (let i = 0; i < MAX_SCAN_PAGES; i++) {
    const page = await getPositions("OPEN", cursor);
    if (page.items.some((p) => p.redeemable && p.conditionId.toLowerCase() === wanted)) return true;
    if (!page.nextCursor) return false;
    cursor = page.nextCursor;
  }
  return false;
}

/** Resolves to the outcome hash, or null when `ms` passes first. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function run(conditionId: string): Promise<RedeemResult> {
  const client = await getSecureClient();
  // Same matrix as approvals: EOAs pay POL, smart wallets need a matching relayer key.
  const path = await currentPath(client);
  if (path === "unavailable") throw new RelayerKeyMissingError(client.account.signer);
  if (!(await holdsRedeemable(conditionId))) throw new NothingToRedeemError();
  if (path === "onchain") await requirePol(client.account.signer);
  const handle = await redeemPositions(client, { conditionId });
  // Confirmation is the handle's wait(): TransactionOutcome { transactionHash, transactionId }.
  const outcome = await withTimeout(handle.wait(), CONFIRM_TIMEOUT_MS);
  const result: RedeemResult = outcome
    ? { conditionId, txHash: outcome.transactionHash, status: "confirmed" }
    : { conditionId, txHash: handle.transactionHash, status: "submitted" };
  console.info(`[redeem] condition=${conditionId} status=${result.status}`);
  return result;
}

// One redemption per market at a time: a double click must not submit twice.
const inFlight = new Map<string, Promise<RedeemResult>>();

export function redeemMarket(conditionId: string): Promise<RedeemResult> {
  const key = conditionId.toLowerCase();
  let pending = inFlight.get(key);
  if (!pending) {
    pending = run(conditionId).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}
