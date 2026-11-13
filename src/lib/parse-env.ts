import { z } from "zod";

/**
 * Pure env parsing. Holds no state and does not touch process.env, so scripts and tests can reuse it.
 * Error messages never include input values (the private key must never be echoed).
 */

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
    POLYMARKET_WALLET_ADDRESS: z.preprocess(
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
  .refine((e) => !e.POLYMARKET_PRIVATE_KEY || e.POLYMARKET_WALLET_ADDRESS, {
    path: ["POLYMARKET_WALLET_ADDRESS"],
    message: "required when POLYMARKET_PRIVATE_KEY is set",
  });

export type Env = {
  privateKey: string | undefined;
  walletAddress: string | undefined;
  maxOrderUsdc: number;
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
    maxOrderUsdc: v.MAX_ORDER_USDC,
    port: v.PORT,
  };
}
