import { describe, expect, it } from "vitest";
import {
  chainOptions,
  tokenOptions,
  amountError, buildRequest, canReview, errorText, maxAmount, pickDefaultDestination, polygonscanTx, recipientError, tokenAfterChainChange,
} from "@/components/withdraw/helpers";
import { POLYGON_USDC, type WithdrawDestination, type WithdrawOptions } from "@/lib/withdraw";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const destinations: WithdrawDestination[] = [
  { chainId: "1", chainName: "Ethereum", tokens: [{ symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, minUsd: 7 }] },
  {
    chainId: "137",
    chainName: "Polygon",
    tokens: [{ symbol: "USDC", name: "USD Coin", address: POLYGON_USDC, decimals: 6, minUsd: 2 }],
  },
  { chainId: "8453", chainName: "Base", tokens: [{ symbol: "USDC", name: "USD Coin", address: BASE_USDC, decimals: 6, minUsd: 2 }] },
];
const options = (over: Partial<WithdrawOptions> = {}): WithdrawOptions => ({
  wallet: WALLET, balance: "25.5", path: "gasless", polBalance: null, destinations, ...over,
});
const form = { amount: "5", chainId: "137", tokenAddress: POLYGON_USDC, recipient: OTHER };

describe("withdraw destination", () => {
  it("defaults to Polygon USDC", () => {
    expect(pickDefaultDestination(destinations)).toEqual({ chainId: "137", tokenAddress: POLYGON_USDC });
  });
  it("falls back to the first token, or null", () => {
    expect(pickDefaultDestination([destinations[0]])?.chainId).toBe("1");
    expect(pickDefaultDestination([])).toBeNull();
  });
  it("keeps the symbol across chains when offered", () => {
    expect(tokenAfterChainChange(destinations[2], "USDC")).toBe(BASE_USDC);
    expect(tokenAfterChainChange(destinations[0], "USDC")).toBe(destinations[0].tokens[0].address);
  });
});

describe("withdraw amount", () => {
  it("max is the whole balance, truncated to 6 decimals", () => {
    expect(maxAmount("25.5")).toBe("25.5");
    expect(maxAmount("25.500000")).toBe("25.5");
    expect(maxAmount("1.23456789")).toBe("1.234567");
    expect(maxAmount("0")).toBe("");
    expect(maxAmount("0.0000001")).toBe("");
  });
  it("validates amount", () => {
    expect(amountError("", "10", 2)).toBeNull();
    expect(amountError("0", "10", 2)).toBe("Enter an amount above 0");
    expect(amountError("abc", "10", 2)).toBe("Enter a number");
    expect(amountError("1.1234567", "10", 2)).toBe("At most 6 decimal places");
    expect(amountError("11", "10", 2)).toBe("More than your available balance");
    expect(amountError("1.5", "10", 2)).toBe("Below the minimum of $2");
    expect(amountError("10", "10", 2)).toBeNull();
  });
});

describe("withdraw recipient", () => {
  it("explains each rejection", () => {
    expect(recipientError("", WALLET)).toBeNull();
    expect(recipientError("0x123", WALLET)).toBe("Not a valid address");
    expect(recipientError("0x" + "0".repeat(40), WALLET)).toMatch(/zero address/);
    expect(recipientError(WALLET.toUpperCase().replace("0X", "0x"), WALLET)).toMatch(/trading wallet/);
    expect(recipientError(OTHER, WALLET)).toBeNull();
  });
});

describe("withdraw request and review gate", () => {
  it("builds the exact body with a checksummed recipient", () => {
    expect(buildRequest(options(), { ...form, recipient: ` ${OTHER.toLowerCase()} ` })).toEqual({
      amount: "5", chainId: "137", tokenAddress: POLYGON_USDC, recipient: "0x2222222222222222222222222222222222222222",
    });
  });
  it("is disabled until amount, recipient and destination are valid", () => {
    expect(canReview(options(), form, false)).toBe(true);
    expect(canReview(options(), { ...form, amount: "" }, false)).toBe(false);
    expect(canReview(options(), { ...form, amount: "1" }, false)).toBe(false); // below $2
    expect(canReview(options(), { ...form, amount: "30" }, false)).toBe(false); // above balance
    expect(canReview(options(), { ...form, recipient: "" }, false)).toBe(false);
    expect(canReview(options(), { ...form, recipient: WALLET }, false)).toBe(false);
    expect(canReview(options(), { ...form, tokenAddress: BASE_USDC }, false)).toBe(false); // token not on chain
  });
  it("is disabled on the unavailable path and with too little POL", () => {
    expect(canReview(options({ path: "unavailable" }), form, false)).toBe(false);
    expect(canReview(options({ path: "onchain", polBalance: "0" }), form, true)).toBe(false);
    expect(canReview(options({ path: "onchain", polBalance: "1" }), form, false)).toBe(true);
  });
});

describe("withdraw messages", () => {
  it("maps USER_REJECTED and links polygonscan", () => {
    expect(errorText("USER_REJECTED", "x")).toBe("Cancelled in wallet");
    expect(errorText("NEEDS_POL", "Needs POL")).toBe("Needs POL");
    expect(polygonscanTx("0xabc")).toBe("https://polygonscan.com/tx/0xabc");
  });
});

describe("chainOptions / tokenOptions", () => {
  const usdc = (address: string, name = "USD Coin") => ({ symbol: "USDC", name, address, decimals: 6, minUsd: 2 });
  it("maps chains to label/value", () => {
    expect(chainOptions([{ chainId: "137", chainName: "Polygon", tokens: [] }])).toEqual([{ value: "137", label: "Polygon" }]);
  });
  it("uses the token name as hint and adds a short address only when symbols collide", () => {
    const single = tokenOptions([usdc("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")]);
    expect(single).toEqual([{ value: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", label: "USDC", hint: "USD Coin" }]);
    const dup = tokenOptions([usdc("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"), usdc("0x672147dD47674757C457eB155BAA382cc10705Dd")]);
    expect(dup.map((o) => o.hint)).toEqual(["USD Coin · 0x8AC7…580d", "USD Coin · 0x6721…05Dd"]);
  });
  it("omits a hint that would repeat the symbol", () => {
    expect(tokenOptions([{ symbol: "DAI", name: "DAI", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, minUsd: 2 }])[0].hint).toBeUndefined();
  });
});
