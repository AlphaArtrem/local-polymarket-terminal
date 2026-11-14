import { z } from "zod";

/**
 * Contract shared by the server (BridgeSigner, routes) and the browser (wallet client).
 * Importable from client components: only zod and pure TS, no viem wallet code, no server imports.
 */

export type AccountMode = "key" | "wallet";
export type WalletSource = "env" | "profile" | "eoa-default" | "user";
export type WalletTypeName = "EOA" | "POLY_PROXY" | "GNOSIS_SAFE" | "DEPOSIT_WALLET";

export type AccountInfo = {
  mode: AccountMode;
  connected: boolean;
  signer: string | null;
  wallet: string | null;
  walletType: WalletTypeName | null;
  source: WalletSource | null;
  /** Relayer key present AND its address matches the signer. */
  gasless: boolean;
  relayerMismatch: boolean;
  /** Signer's POL balance, decimal string. */
  polBalance: string | null;
  /** mode === "key" && AUTOMATION_ENABLED. */
  automationAvailable: boolean;
};

/** Interactive operations the user can start; the server asks the wallet to sign only inside one. */
export const OP_KINDS = ["connect", "order", "approvals", "redeem"] as const;
export type OpKind = (typeof OP_KINDS)[number];

/** EIP-712 primary types the wallet may be asked to sign, per operation. */
export const ALLOWED_PRIMARY_TYPES: Record<OpKind, readonly string[]> = {
  connect: ["ClobAuth"],
  order: ["Order", "TypedDataSign"],
  approvals: ["SafeTx", "Batch"],
  redeem: ["SafeTx", "Batch"],
};
export const TX_ALLOWED: readonly OpKind[] = ["approvals", "redeem"];
export const MESSAGE_ALLOWED: readonly OpKind[] = ["approvals", "redeem"];

export type SignRequestKind = "signTypedData" | "signMessage" | "sendTransaction";
export type PendingSign = {
  opId: string;
  requestId: string;
  kind: SignRequestKind;
  summary: string;
  /** encodeJson output (bigints survive the round trip). */
  payload: string;
};

export type OpEnvelope =
  | { state: "needs-wallet"; pending: PendingSign }
  | { state: "working"; opId: string }
  | { state: "done"; opId: string; status: number; body: unknown };

/** "1" on every envelope response so the browser knows to run the signing loop. */
export const OP_HEADER = "x-pmterm-op";

export type WalletReply = {
  opId: string;
  requestId: string;
  result: { signature: `0x${string}` } | { txHash: `0x${string}` } | { rejected: true; reason?: string };
};

const id = z.string().min(1).max(100);
// 65-byte ECDSA signature.
const signature = z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v), {
  error: "must be a 65-byte hex signature",
});
const txHash = z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v), {
  error: "must be a 32-byte hex hash",
});

export const walletReplySchema: z.ZodType<WalletReply> = z.object({
  opId: id,
  requestId: id,
  result: z.union([
    z.object({ signature }).strict(),
    z.object({ txHash }).strict(),
    z.object({ rejected: z.literal(true), reason: z.string().max(300).optional() }).strict(),
  ]),
});

export type ApprovalPath = "gasless" | "onchain" | "unavailable";
export type ApprovalStatus = {
  approved: boolean;
  missing: number;
  path: ApprovalPath;
  txCount: number;
  polBalance: string | null;
};

/** Assumed thresholds (unverified live): refuse onchain setup/redeem below MIN, warn below RECOMMENDED. */
export const MIN_POL_TO_START = "0.02";
export const RECOMMENDED_POL = "0.2";

const BIGINT_TAG = "$bigint";

/** JSON with bigint encoded as {"$bigint":"123"}. */
export function encodeJson(v: unknown): string {
  return JSON.stringify(v, (_k, value: unknown) => (typeof value === "bigint" ? { [BIGINT_TAG]: value.toString() } : value));
}

/** Reverse of encodeJson. Rejects malformed bigint tags and any other "$"-prefixed key. */
export function decodeJson(s: string): unknown {
  return JSON.parse(s, (_k, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const keys = Object.keys(value);
    const tagged = keys.filter((k) => k.startsWith("$"));
    if (tagged.length === 0) return value;
    const raw = (value as Record<string, unknown>)[BIGINT_TAG];
    if (keys.length !== 1 || tagged[0] !== BIGINT_TAG || typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
      throw new Error("decodeJson: unknown or malformed $ tag");
    }
    return BigInt(raw);
  });
}

export const SIGN_TIMEOUT_MS = 120_000;
export const OP_TIMEOUT_MS = 600_000;
export const LONG_POLL_MS = 20_000;
