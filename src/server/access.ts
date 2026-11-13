import "server-only";
import { fetchGeoblock, type Geoblock } from "@/lib/polymarket-core";
import { getSecureClient, isConfigured } from "./polymarket";

export type AccessStatus = {
  geoblock: Geoblock | null;
  closedOnly: boolean | null;
  configured: boolean;
};

/** Logs only the error class and message of SDK/network failures; never env values. */
function warn(what: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[access] ${what} unavailable: ${name}`);
}

/** Geoblock + close-only. Each part degrades to null on failure rather than failing the whole call. */
export async function getAccessStatus(
  deps: { fetchGeoblock?: typeof fetchGeoblock } = {},
): Promise<AccessStatus> {
  const configured = isConfigured();

  const geoblockPromise = (deps.fetchGeoblock ?? fetchGeoblock)().catch((err: unknown) => {
    warn("geoblock", err);
    return null;
  });

  const closedOnlyPromise = configured
    ? getSecureClient()
        .then((client) => client.fetchClosedOnlyMode())
        .catch((err: unknown) => {
          warn("closed-only mode", err);
          return null;
        })
    : Promise.resolve(null);

  const [geoblock, closedOnly] = await Promise.all([geoblockPromise, closedOnlyPromise]);
  return { geoblock, closedOnly, configured };
}
