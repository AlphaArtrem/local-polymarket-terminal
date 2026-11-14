import "server-only";
import { getEnv } from "./env";
import { getSecureClient } from "./polymarket";

/** Setting approvals is gasless and the SDK refuses it without a Relayer API key (external-facts F14f). */
export class RelayerKeyMissingError extends Error {
  constructor() {
    super(
      "Enabling trading needs a Relayer API key: create one at polymarket.com → Settings → API Keys → Relayer API Keys, " +
        "then set POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS (the Signer Address shown with it) in .env.local and restart.",
    );
    this.name = "RelayerKeyMissingError";
  }
}

/**
 * Trading approvals (external-facts F14f). A wallet cannot trade until it has granted the exchange
 * its ERC-20 (pUSD) and ERC-1155 (outcome token) approvals. This is a one-time on-chain step the
 * user triggers from the dashboard; nothing here runs it automatically.
 */
export type ApprovalStatus = {
  approved: boolean;
  /** Number of approvals still missing (ERC-20 + ERC-1155). */
  missing: number;
};

type ApprovalsClient = {
  fetchTradingApprovalsState(): Promise<{
    isFullyApproved: boolean;
    missing: { erc20: readonly unknown[]; erc1155: readonly unknown[] };
  }>;
  setupTradingApprovals(): Promise<void>;
};

async function client(): Promise<ApprovalsClient> {
  return getSecureClient();
}

export async function getApprovalStatus(): Promise<ApprovalStatus> {
  const state = await (await client()).fetchTradingApprovalsState();
  return {
    approved: state.isFullyApproved,
    missing: state.missing.erc20.length + state.missing.erc1155.length,
  };
}

/** Re-read attempts after a submit; the approval state lags the transaction by a few seconds (F14f). */
export const RECHECK_ATTEMPTS = 5;
export const RECHECK_DELAY_MS = 3000;

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Test hook: replace the delay so tests do not wait in real time. */
export function setSleepForTests(fn: (ms: number) => Promise<void>): void {
  sleep = fn;
}

async function settledStatus(): Promise<ApprovalStatus> {
  let status = await getApprovalStatus();
  for (let i = 1; i < RECHECK_ATTEMPTS && !status.approved; i++) {
    await sleep(RECHECK_DELAY_MS);
    status = await getApprovalStatus();
  }
  return status;
}

// One setup at a time: a double click must not submit the approval transactions twice.
let inFlight: Promise<ApprovalStatus> | undefined;

/** Submits the missing approvals (gasless for smart wallets), then re-reads the state. */
export function enableTrading(): Promise<ApprovalStatus> {
  inFlight ??= (async () => {
    if (!getEnv().relayer) throw new RelayerKeyMissingError();
    const c = await client();
    const before = await getApprovalStatus();
    if (before.approved) return before;
    await c.setupTradingApprovals();
    console.info("[approvals] trading approvals submitted");
    return settledStatus();
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
