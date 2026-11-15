import { getAddress, isAddress } from "viem";
import { z } from "zod";

/** Pure helpers for the deposit dialog. Nothing here talks to the network. */

export const BRIDGE_DEPOSIT_URL = "https://bridge.polymarket.com/deposit";
export const BRIDGE_ASSETS_URL = "https://bridge.polymarket.com/supported-assets";

export const bridgeDepositSchema = z.object({
  address: z.object({ evm: z.string() }),
  note: z.string().optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
});

export const supportedAssetsSchema = z.object({
  supportedAssets: z.array(
    z.object({
      chainId: z.string(),
      chainName: z.string(),
      token: z.object({ symbol: z.string(), name: z.string().optional(), address: z.string().optional(), decimals: z.number().optional() }),
      minCheckoutUsd: z.number(),
    }),
  ),
});

export type BridgeDeposit = z.infer<typeof bridgeDepositSchema>;
export type SupportedAssets = z.infer<typeof supportedAssetsSchema>;
export type PolygonMinimum = { token: "USDC" | "USDC.e"; minUsd: number };

/** Checksummed EVM deposit address, or null when the upstream value is not a valid address. */
export function pickEvmAddress(deposit: BridgeDeposit): string | null {
  const evm = deposit.address.evm;
  return isAddress(evm, { strict: false }) ? getAddress(evm) : null;
}

/** Polygon (chain 137) USDC and USDC.e minimums only. */
export function polygonMinimums(assets: SupportedAssets): PolygonMinimum[] {
  const out: PolygonMinimum[] = [];
  for (const a of assets.supportedAssets) {
    if (a.chainId !== "137") continue;
    const symbol = a.token.symbol;
    if (symbol === "USDC" || symbol === "USDC.e") out.push({ token: symbol, minUsd: a.minCheckoutUsd });
  }
  return out;
}

/** "0x1234 5678 ..." in 4-character groups for reading and comparing. */
export function groupAddress(addr: string): string {
  return addr.match(/.{1,4}/g)?.join(" ") ?? addr;
}

export type DepositInfo = {
  wallet: string;
  walletType: string;
  evm: string;
  minimums: PolygonMinimum[] | null;
};
