import "server-only";
import { getSecureClient } from "./polymarket";

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

// One setup at a time: a double click must not submit the approval transactions twice.
let inFlight: Promise<ApprovalStatus> | undefined;

/** Submits the missing approvals (gasless for smart wallets), then re-reads the state. */
export function enableTrading(): Promise<ApprovalStatus> {
  inFlight ??= (async () => {
    const c = await client();
    const before = await getApprovalStatus();
    if (before.approved) return before;
    await c.setupTradingApprovals();
    console.info("[approvals] trading approvals submitted");
    return getApprovalStatus();
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
