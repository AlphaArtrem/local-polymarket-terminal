import { z } from "zod";

/** Decimal strings only (no exponents, no floats); at most 8 decimals to match src/lib/decimal.ts. */
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,8})?$/, "must be a decimal string");

export const placeOrderBody = z
  .object({
    assetId: z.string().regex(/^\d{1,100}$/, "must be a numeric asset id"),
    conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x condition id"),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["LIMIT", "MARKET"]),
    price: decimal.optional(),
    size: decimal.optional(),
    amount: decimal.optional(),
    /** LIMIT only: Unix seconds. Range is checked against the server clock in validateOrder. */
    expiresAt: z.number().int().positive().optional(),
    postOnly: z.boolean().optional(),
  })
  .strict();

export const cancelParams = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{1,100}$/, "invalid order id"),
});
