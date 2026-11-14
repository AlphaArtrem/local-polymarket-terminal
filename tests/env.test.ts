import { describe, expect, it } from "vitest";
import { DEFAULT_POLYGON_RPC_URL, EnvError, parseEnv } from "@/lib/parse-env";

const KEY = "0x" + "ab".repeat(32);
const WALLET = "0x" + "12".repeat(20);

describe("parseEnv", () => {
  it("applies defaults with an empty env", () => {
    expect(parseEnv({})).toEqual({
      privateKey: undefined,
      walletAddress: undefined,
      relayer: undefined,
      maxOrderUsdc: 25,
      polygonRpcUrl: DEFAULT_POLYGON_RPC_URL,
      automationEnabled: false,
      automationFile: ".data/automation.json",
      port: 3737,
    });
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

  it("accepts an https POLYGON_RPC_URL and rejects http", () => {
    expect(parseEnv({ POLYGON_RPC_URL: "https://rpc.example.com/x" }).polygonRpcUrl).toBe("https://rpc.example.com/x");
    expect(() => parseEnv({ POLYGON_RPC_URL: "http://rpc.example.com" })).toThrow(/POLYGON_RPC_URL: must be an https URL/);
  });

  it("requires the relayer key and its address together", () => {
    const address = "0x" + "34".repeat(20);
    expect(parseEnv({ POLYMARKET_RELAYER_API_KEY: "k", POLYMARKET_RELAYER_API_KEY_ADDRESS: address }).relayer).toEqual({ key: "k", address });
    expect(() => parseEnv({ POLYMARKET_RELAYER_API_KEY: "k" })).toThrow(/set both/);
    expect(() => parseEnv({ POLYMARKET_RELAYER_API_KEY_ADDRESS: address })).toThrow(/set both/);
  });

  it("never echoes the relayer key in errors", () => {
    try {
      parseEnv({ POLYMARKET_RELAYER_API_KEY: "SECRET-RELAYER-VALUE" });
      throw new Error("expected EnvError");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SECRET-RELAYER-VALUE");
    }
  });
});

describe("parseEnv automation", () => {
  it("opts in only with the exact string true and takes a custom file", () => {
    expect(parseEnv({ AUTOMATION_ENABLED: "true", AUTOMATION_FILE: "x/y.json" })).toMatchObject({ automationEnabled: true, automationFile: "x/y.json" });
    expect(parseEnv({ AUTOMATION_ENABLED: "" }).automationEnabled).toBe(false);
    expect(() => parseEnv({ AUTOMATION_ENABLED: "yes" })).toThrow(EnvError);
  });
});
