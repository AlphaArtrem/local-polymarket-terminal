import { describe, expect, it } from "vitest";
import { placeOrderBody } from "@/server/orders/body";

const base = {
  assetId: "111",
  conditionId: "0xa82699004214aa3f755ede5d9e6d5c4850e3f69ec821a3b15433a1bd6a3a19aa",
  side: "BUY",
  type: "LIMIT",
  price: "0.013",
  size: "5",
};

describe("placeOrderBody expiresAt / postOnly", () => {
  it("accepts them as optional", () => {
    expect(placeOrderBody.safeParse(base).success).toBe(true);
    const parsed = placeOrderBody.parse({ ...base, expiresAt: 1_800_000_000, postOnly: true });
    expect(parsed).toMatchObject({ expiresAt: 1_800_000_000, postOnly: true });
  });

  it("rejects non-integer, non-positive, string or millisecond-free bad expiries", () => {
    for (const expiresAt of [1.5, 0, -5, "1800000000", null]) {
      expect(placeOrderBody.safeParse({ ...base, expiresAt }).success).toBe(false);
    }
  });

  it("rejects a non-boolean postOnly", () => {
    expect(placeOrderBody.safeParse({ ...base, postOnly: "true" }).success).toBe(false);
  });

  it("stays strict about unknown fields", () => {
    expect(placeOrderBody.safeParse({ ...base, expiration: 1 }).success).toBe(false);
  });
});
