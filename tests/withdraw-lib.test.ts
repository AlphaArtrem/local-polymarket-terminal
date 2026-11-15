import { describe, expect, it } from "vitest";
import { supportedAssetsSchema } from "@/lib/deposit";
import { buildDestinations, checkRecipient, findDestination, fromBaseUnits, toBaseUnits, withdrawRequestSchema } from "@/lib/withdraw";
import assets from "./fixtures/bridge-withdraw-assets.json";

const WALLET = "0x2222222222222222222222222222222222222222";
const dests = buildDestinations(supportedAssetsSchema.parse(assets));

describe("base units", () => {
  it("converts both ways", () => {
    expect(toBaseUnits("12.5", 6)).toBe(12_500_000n);
    expect(toBaseUnits("1.1234567", 6)).toBeNull();
    expect(toBaseUnits("x", 6)).toBeNull();
    expect(fromBaseUnits(12_500_000n, 6)).toBe("12.5");
    expect(fromBaseUnits("1000000000000000000", 18)).toBe("1");
    expect(fromBaseUnits("5", 6)).toBe("0.000005");
  });
});

describe("checkRecipient", () => {
  it("accepts and checksums, refuses wallet, zero and junk", () => {
    expect(checkRecipient("0x" + "ab".repeat(20), WALLET)).toBe("0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB");
    expect(checkRecipient(WALLET, WALLET)).toBeNull();
    expect(checkRecipient("0x" + "0".repeat(40), WALLET)).toBeNull();
    expect(checkRecipient("nope", WALLET)).toBeNull();
  });
});

describe("buildDestinations / findDestination", () => {
  it("keeps allowlisted EVM chains with valid tokens, Polygon first, USDC first", () => {
    expect(dests.map((d) => d.chainId)).toEqual(["137", "1", "8453"]);
    expect(dests[1].tokens.map((t) => t.symbol)).toEqual(["USDC", "USDT"]);
    expect(dests[1].chainName).toBe("Ethereum");
  });
  it("drops pUSD as a destination and orders stablecoins first, then alphabetically", () => {
    const tok = (symbol: string, address: string) => ({
      chainId: "137",
      chainName: "Polygon",
      token: { symbol, name: symbol, address, decimals: 6 },
      minCheckoutUsd: 2,
    });
    const out = buildDestinations({
      supportedAssets: [
        tok("WETH", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"),
        tok("pUSD", "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"),
        tok("DAI", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"),
        tok("CRV", "0x172370d5Cd63279eFa6d502DAB29171933a610AF"),
        tok("USDT", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"),
        tok("USDC.e", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"),
        tok("USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
      ],
    });
    expect(out[0].tokens.map((t) => t.symbol)).toEqual(["USDC", "USDC.e", "USDT", "DAI", "CRV", "WETH"]);
  });
  it("finds case-insensitively and rejects unknown", () => {
    expect(findDestination(dests, "8453", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")?.token.minUsd).toBe(5);
    expect(findDestination(dests, "10", "0x" + "1".repeat(40))).toBeNull();
  });
});

describe("withdrawRequestSchema", () => {
  it("rejects extra keys and bad amounts", () => {
    const ok = { amount: "5", chainId: "137", tokenAddress: "0x" + "1".repeat(40), recipient: "0x" + "2".repeat(40) };
    expect(withdrawRequestSchema.safeParse(ok).success).toBe(true);
    expect(withdrawRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(withdrawRequestSchema.safeParse({ ...ok, amount: "1.1234567" }).success).toBe(false);
  });
});
