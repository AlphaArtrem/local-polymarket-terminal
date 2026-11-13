import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/parse-env";

const KEY = "0x" + "ab".repeat(32);
const WALLET = "0x" + "12".repeat(20);

describe("parseEnv", () => {
  it("applies defaults with an empty env", () => {
    expect(parseEnv({})).toEqual({ privateKey: undefined, walletAddress: undefined, maxOrderUsdc: 25, port: 3737 });
  });

  it("treats blank values as unset", () => {
    const env = parseEnv({ POLYMARKET_PRIVATE_KEY: "", POLYMARKET_WALLET_ADDRESS: " ", MAX_ORDER_USDC: "", PORT: "" });
    expect(env.privateKey).toBeUndefined();
    expect(env.port).toBe(3737);
  });

  it("accepts a valid key and wallet", () => {
    const env = parseEnv({ POLYMARKET_PRIVATE_KEY: KEY, POLYMARKET_WALLET_ADDRESS: WALLET, MAX_ORDER_USDC: "10", PORT: "4000" });
    expect(env).toMatchObject({ privateKey: KEY, walletAddress: WALLET, maxOrderUsdc: 10, port: 4000 });
  });

  it("requires the wallet when the key is set", () => {
    expect(() => parseEnv({ POLYMARKET_PRIVATE_KEY: KEY })).toThrow(EnvError);
  });

  it("rejects a malformed key without echoing it", () => {
    const bad = "0xSECRETSECRETnothex";
    try {
      parseEnv({ POLYMARKET_PRIVATE_KEY: bad, POLYMARKET_WALLET_ADDRESS: WALLET });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as Error).message).toContain("POLYMARKET_PRIVATE_KEY");
      expect((err as Error).message).not.toContain("SECRET");
    }
  });

  it("rejects bad numbers", () => {
    expect(() => parseEnv({ MAX_ORDER_USDC: "-1" })).toThrow(EnvError);
    expect(() => parseEnv({ MAX_ORDER_USDC: "abc" })).toThrow(EnvError);
    expect(() => parseEnv({ PORT: "70000" })).toThrow(EnvError);
  });
});
