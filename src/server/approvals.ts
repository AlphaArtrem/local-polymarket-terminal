import "server-only";
import { WalletType } from "@polymarket/client";
import { fetchPolBalance } from "@/lib/polymarket-core";
import { MIN_POL_TO_START, type ApprovalPath, type ApprovalStatus } from "@/lib/wallet-protocol";
import { getEnv } from "./env";
import { getCurrentAccountExtras, getSecureClient } from "./polymarket";

/** Smart-wallet accounts need a gasless relayer; without a matching key the user must act elsewhere. */
export class RelayerKeyMissingError extends Error {
  constructor(signer?: string) {
    super(
      "This account type cannot send transactions itself. Enable trading or redeem on polymarket.com, or add a Relayer API key " +
        `(polymarket.com → Settings → API Keys → Relayer API Keys) whose Signer Address matches ${signer ?? "the connected signer"}.`,
    );
    this.name = "RelayerKeyMissingError";
  }
}

/** Onchain path (EOA) with too little POL to pay gas: nothing was submitted. */
export class NeedsPolError extends Error {
  constructor(signer: string, balance: string) {
    super(`The signer ${signer} holds ${balance} POL; at least ${MIN_POL_TO_START} POL is needed to pay for the transactions.`);
    this.name = "NeedsPolError";
  }
}

type ApprovalsClient = {
  account: { signer: string; walletType: WalletType };
  fetchTradingApprovalsState(): Promise<{
    isFullyApproved: boolean;
    missing: { erc20: readonly unknown[]; erc1155: readonly unknown[] };
  }>;
  setupTradingApprovals(): Promise<void>;
};

async function client(): Promise<ApprovalsClient> {
  return getSecureClient();
}

/** EOAs pay POL themselves; smart wallets are gasless only with a relayer key that matches the signer. */
export function approvalPath(walletType: WalletType, gasless: boolean): ApprovalPath {
  if (walletType === WalletType.EOA) return "onchain";
  return gasless ? "gasless" : "unavailable";
}

/** Path for the current account (request context in wallet mode, env account in key mode). */
export async function currentPath(c: ApprovalsClient): Promise<ApprovalPath> {
  return approvalPath(c.account.walletType, (await getCurrentAccountExtras()).gasless);
}

/** Refuses (before anything is submitted) when the signer cannot pay gas. Returns the balance. */
export async function requirePol(signer: string): Promise<string> {
  const balance = await fetchPolBalance(getEnv().polygonRpcUrl, signer);
  if (Number(balance) < Number(MIN_POL_TO_START)) throw new NeedsPolError(signer, balance);
  return balance;
}

export async function getApprovalStatus(): Promise<ApprovalStatus> {
  const c = await client();
  const [state, path] = await Promise.all([c.fetchTradingApprovalsState(), currentPath(c)]);
  const missing = state.missing.erc20.length + state.missing.erc1155.length;
  const onchain = path === "onchain";
  return {
    approved: state.isFullyApproved,
    missing,
    path,
    // Onchain: the SDK sends one transaction per missing approval. Otherwise one gasless batch.
    txCount: onchain ? missing : missing ? 1 : 0,
    polBalance: onchain ? await fetchPolBalance(getEnv().polygonRpcUrl, c.account.signer) : null,
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

/** Submits the missing approvals (gasless for smart wallets, POL-paid for EOAs), then re-reads the state. */
export function enableTrading(): Promise<ApprovalStatus> {
  inFlight ??= (async () => {
    const c = await client();
    const path = await currentPath(c);
    if (path === "unavailable") throw new RelayerKeyMissingError(c.account.signer);
    const before = await getApprovalStatus();
    if (before.approved) return before;
    if (path === "onchain") await requirePol(c.account.signer);
    await c.setupTradingApprovals();
    console.info("[approvals] trading approvals submitted");
    return settledStatus();
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
