import "server-only";
import { PositionStatus } from "@polymarket/client";
import { listPositions } from "@polymarket/client/actions";
import { jsonError } from "@/lib/http";
import { EnvError } from "@/lib/parse-env";
import { getEnv } from "../env";
import { getAccountMode } from "../account/context";
import { placeOrder } from "../orders/place";
import type { OrderRequest } from "../orders/validate";
import { getEnvSecureClient, getPublicClient } from "../polymarket";
import { AutomationEngine, AutomationError } from "./engine";
import { StoreCorruptError } from "./store";

/** Wires the engine to the real SDK and exposes the route guard. */

/** Shares held of one outcome token (same lookup as place.ts). */
export async function heldSize(assetId: string, conditionId: string): Promise<string> {
  // Always the env account: automation runs outside any request and never uses a browser session.
  const client = await getEnvSecureClient();
  const page = await listPositions(client, {
    user: client.account.wallet,
    status: PositionStatus.Open,
    conditionId,
  } as Parameters<typeof listPositions>[1]).firstPage();
  return page.items.find((p) => p.assetId === assetId)?.currentSize ?? "0";
}

/** The engine's order placer: pinned to the env account even if called inside a request context. */
export const enginePlaceOrder = (request: OrderRequest) => placeOrder(request, { getClient: getEnvSecureClient });

/** Fresh midpoints, bypassing the 10 s route cache so consecutive ticks are separate samples. */
export async function fetchMidpoints(assetIds: string[]): Promise<Record<string, string | null>> {
  const raw = (await getPublicClient().fetchMidpoints(assetIds.map((assetId) => ({ assetId })))) as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const id of assetIds) out[id] = typeof raw[id] === "string" ? raw[id] : null;
  return out;
}

const KEY = "__localPolymarketAutomationEngine";
type Holder = typeof globalThis & { [KEY]?: AutomationEngine };

/** One engine per process, kept on globalThis so Next dev hot reloads never start a second timer. */
export function getEngine(): AutomationEngine {
  const g = globalThis as Holder;
  g[KEY] ??= new AutomationEngine({
    file: getEnv().automationFile,
    now: () => Date.now(),
    fetchMidpoints,
    placeOrder: enginePlaceOrder,
    heldSize,
  });
  return g[KEY];
}

/** Common gate for every automation route: flag, key, store. Returns the engine or an error response. */
export async function requireEngine(): Promise<AutomationEngine | Response> {
  try {
    const env = getEnv();
    if (getAccountMode() !== "key") {
      return jsonError(403, "AUTOMATION_NEEDS_KEY", "Automation needs a server-held key: set POLYMARKET_PRIVATE_KEY (it does not run with a browser wallet)");
    }
    if (!env.automationEnabled) {
      return jsonError(403, "AUTOMATION_DISABLED", "Set AUTOMATION_ENABLED=true in .env.local to use automation");
    }
    const engine = getEngine();
    await engine.ready();
    return engine;
  } catch (err) {
    return automationErrorResponse(err);
  }
}

export function automationErrorResponse(err: unknown): Response {
  if (err instanceof AutomationError) return jsonError(err.status, err.code, err.message);
  if (err instanceof StoreCorruptError) return jsonError(500, "AUTOMATION_STORE_CORRUPT", err.message);
  if (err instanceof EnvError) return jsonError(500, "CONFIG_ERROR", err.message);
  console.error(`[automation] route failed: ${err instanceof Error ? err.name : "unknown"}`);
  return jsonError(500, "AUTOMATION_ERROR", "Automation request failed");
}
