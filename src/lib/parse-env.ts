import { z } from "zod";

/**
 * Pure env parsing. Holds no state and does not touch process.env, so scripts and tests can reuse it.
 * Error messages never include input values (the private key must never be echoed).
 */

/** Public Polygon RPC verified on 2026-11-14 to accept 25-request JSON-RPC batches. */
export const DEFAULT_POLYGON_RPC_URL = "https://polygon-bor-rpc.publicnode.com";

/** Resolved from the working directory by the store. */
export const DEFAULT_AUTOMATION_FILE = ".data/automation.json";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z
  .object({
    POLYMARKET_PRIVATE_KEY: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters")
        .optional(),
    ),
    // Optional override of the account wallet. Without it the wallet is resolved from the key
    // (public profile, else the signer itself as an EOA).
    POLYMARKET_WALLET_ADDRESS: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x followed by 40 hex characters")
        .optional(),
    ),
    // Relayer API key (polymarket.com → Settings → API Keys → Relayer API Keys). Secret. Needed only
    // for gasless wallet operations such as trading approvals (external-facts F13, F14f).
    POLYMARKET_RELAYER_API_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    // The "Signer Address" Polymarket shows next to that key.
    POLYMARKET_RELAYER_API_KEY_ADDRESS: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x followed by 40 hex characters")
        .optional(),
    ),
    MAX_ORDER_USDC: z.preprocess(
      blankToUndefined,
      z.coerce.number({ error: "must be a number" }).positive("must be greater than 0").default(25),
    ),
    // The SDK's default RPC (polygon.drpc.org, free tier) rejects JSON-RPC batches over 10 requests,
    // which breaks wallet operations such as trading approvals (hazard H9).
    POLYGON_RPC_URL: z.preprocess(
      blankToUndefined,
      z.url({ protocol: /^https$/, error: "must be an https URL" }).default(DEFAULT_POLYGON_RPC_URL),
    ),
    // Explicit opt-in: the app places TP/SL and TWAP orders unattended while it runs.
    AUTOMATION_ENABLED: z.preprocess(blankToUndefined, z.enum(["true", "false"], { error: 'must be "true" or "false"' }).default("false")),
    AUTOMATION_FILE: z.preprocess(blankToUndefined, z.string().max(500).default(DEFAULT_AUTOMATION_FILE)),
    PORT: z.preprocess(
      blankToUndefined,
      z.coerce
        .number({ error: "must be a number" })
        .int("must be an integer")
        .min(1, "must be 1-65535")
        .max(65535, "must be 1-65535")
        .default(3737),
    ),
  })
  .refine((e) => Boolean(e.POLYMARKET_RELAYER_API_KEY) === Boolean(e.POLYMARKET_RELAYER_API_KEY_ADDRESS), {
    path: ["POLYMARKET_RELAYER_API_KEY_ADDRESS"],
    message: "set both POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS, or neither",
  });

export type Env = {
  privateKey: string | undefined;
  walletAddress: string | undefined;
  /** Both set or both undefined (enforced by the schema). */
  relayer: { key: string; address: string } | undefined;
  maxOrderUsdc: number;
  polygonRpcUrl: string;
  automationEnabled: boolean;
  automationFile: string;
  port: number;
};

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment: ${issues.join("; ")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Only variable name + our own message; never the received value.
    throw new EnvError(result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  const v = result.data;
  return {
    privateKey: v.POLYMARKET_PRIVATE_KEY,
    walletAddress: v.POLYMARKET_WALLET_ADDRESS,
    relayer:
      v.POLYMARKET_RELAYER_API_KEY && v.POLYMARKET_RELAYER_API_KEY_ADDRESS
        ? { key: v.POLYMARKET_RELAYER_API_KEY, address: v.POLYMARKET_RELAYER_API_KEY_ADDRESS }
        : undefined,
    maxOrderUsdc: v.MAX_ORDER_USDC,
    polygonRpcUrl: v.POLYGON_RPC_URL,
    automationEnabled: v.AUTOMATION_ENABLED === "true",
    automationFile: v.AUTOMATION_FILE,
    port: v.PORT,
  };
}
