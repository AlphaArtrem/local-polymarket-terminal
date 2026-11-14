// Fails if the client bundle contains the private key, the env var names or SDK client code (invariant 1).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
if (!existsSync(root)) {
  console.error(`check-bundle: ${root} not found; run \`npm run build\` first`);
  process.exit(1);
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = (process.env.POLYMARKET_PRIVATE_KEY ?? "").trim().toLowerCase();
const hasKey = /^0x[0-9a-f]{64}$/.test(key);
const relayerKey = (process.env.POLYMARKET_RELAYER_API_KEY ?? "").trim();

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const hits = [];
for (const file of walk(root)) {
  files += 1;
  const text = readFileSync(file, "utf8");
  if (text.includes("POLYMARKET_PRIVATE_KEY")) hits.push(`${file}: contains POLYMARKET_PRIVATE_KEY`);
  if (text.includes("POLYMARKET_RELAYER_API_KEY")) hits.push(`${file}: contains POLYMARKET_RELAYER_API_KEY`);
  if (text.includes("createSecureClient")) hits.push(`${file}: contains SDK code (createSecureClient)`);
  if (relayerKey && text.includes(relayerKey)) hits.push(`${file}: contains the relayer API key value`);
  if (hasKey && text.toLowerCase().includes(key)) hits.push(`${file}: contains the private key value`);
}

if (hits.length > 0) {
  console.error("check-bundle: FAIL");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check-bundle: ok (${files} files scanned, key ${hasKey ? "checked" : "not set"})`);
