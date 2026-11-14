// Read-only account and access status. Never places or signs orders. Never prints the key.
import { existsSync } from "node:fs";
import { EnvError, parseEnv } from "../src/lib/parse-env";
import { WalletType } from "@polymarket/client";
import {
  buildSecureClient,
  fetchGeoblock,
  fetchPolBalance,
  fetchPusdBalance,
} from "../src/lib/polymarket-core";

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
}

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  try {
    const g = await fetchGeoblock();
    console.log(`geoblock: blocked=${g.blocked} country=${g.country || "?"} region=${g.region || "-"}`);
  } catch (err) {
    console.log(`geoblock: unavailable (${describe(err)})`);
  }

  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    console.error(err instanceof EnvError ? err.message : describe(err));
    return 1;
  }

  if (!env.privateKey) {
    console.log("mode: wallet (no POLYMARKET_PRIVATE_KEY) - connect a wallet in the browser");
    if (env.walletAddress) console.log("warning: POLYMARKET_WALLET_ADDRESS is ignored in wallet mode");
    return 0;
  }
  console.log("mode: key");

  try {
    const { client, source, gasless, relayerMismatch } = await buildSecureClient(env);
    const { walletType, signer, wallet } = client.account;
    console.log(`wallet source: ${source}`);
    console.log(`wallet type: ${WalletType[walletType] ?? walletType}`);
    console.log(`signer: ${signer}`);
    console.log(`wallet: ${wallet}`);
    console.log(`gasless: ${gasless}${relayerMismatch ? " (relayer key belongs to another address)" : ""}`);
    console.log(`POL balance (signer): ${await fetchPolBalance(env.polygonRpcUrl, signer)}`);
    console.log(`pUSD balance: ${await fetchPusdBalance(client)}`);
    console.log(`close-only mode: ${await client.fetchClosedOnlyMode()}`);
  } catch (err) {
    console.error(`account check failed: ${describe(err)}`);
    return 1;
  }
  return 0;
}

process.exit(await main());
