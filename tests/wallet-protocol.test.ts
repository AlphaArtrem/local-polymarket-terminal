import { describe, expect, it } from "vitest";
import {
  ALLOWED_PRIMARY_TYPES,
  decodeJson,
  encodeJson,
  MESSAGE_ALLOWED,
  TX_ALLOWED,
  walletReplySchema,
} from "@/lib/wallet-protocol";

const SIG = `0x${"ab".repeat(65)}`;
const HASH = `0x${"cd".repeat(32)}`;

describe("encodeJson / decodeJson", () => {
  it("round-trips nested bigints, including in arrays", () => {
    const v = { a: 1n, n: { salt: 123456789012345678901234567890n, list: [1n, { x: -2n }, "s", 3] }, s: "plain", z: null };
    const s = encodeJson(v);
    expect(s).toContain('{"$bigint":"1"}');
    expect(decodeJson(s)).toEqual(v);
  });

  it("rejects a malformed bigint tag", () => {
    expect(() => decodeJson('{"$bigint":"x"}')).toThrow();
    expect(() => decodeJson('{"$bigint":1}')).toThrow();
  });

  it("rejects unknown $ tags and tags mixed with other keys", () => {
    expect(() => decodeJson('{"$date":"2020"}')).toThrow();
    expect(() => decodeJson('{"$bigint":"1","b":2}')).toThrow();
  });
});

describe("walletReplySchema", () => {
  it("accepts signature, txHash and rejection replies", () => {
    for (const result of [{ signature: SIG }, { txHash: HASH }, { rejected: true as const, reason: "no" }]) {
      expect(walletReplySchema.safeParse({ opId: "o", requestId: "r", result }).success).toBe(true);
    }
  });

  it("rejects bad hex and wrong lengths", () => {
    const bad = [{ signature: "0xzz" }, { signature: HASH }, { txHash: "0x12" }, { txHash: SIG }, { rejected: false }, {}];
    for (const result of bad) {
      expect(walletReplySchema.safeParse({ opId: "o", requestId: "r", result }).success).toBe(false);
    }
  });
});

describe("allowlists", () => {
  it("share no primary type between connect and order", () => {
    const overlap = ALLOWED_PRIMARY_TYPES.connect.filter((t) => ALLOWED_PRIMARY_TYPES.order.includes(t));
    expect(overlap).toEqual([]);
  });

  it("allow transactions and messages only for approvals and redeem", () => {
    expect([...TX_ALLOWED]).toEqual(["approvals", "redeem"]);
    expect([...MESSAGE_ALLOWED]).toEqual(["approvals", "redeem"]);
  });
});
