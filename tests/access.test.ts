import { afterEach, describe, expect, it, vi } from "vitest";
import { badgeState } from "@/lib/access-state";
import { fetchGeoblock } from "@/lib/polymarket-core";

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("fetchGeoblock", () => {
  it("drops the ip field", async () => {
    const g = await fetchGeoblock(mockFetch({ blocked: true, ip: "1.2.3.4", country: "AR", region: "C" }));
    expect(g).toEqual({ blocked: true, country: "AR", region: "C" });
    expect(JSON.stringify(g)).not.toContain("1.2.3.4");
  });

  it("throws on HTTP errors", async () => {
    await expect(fetchGeoblock(mockFetch({}, 500))).rejects.toThrow(/500/);
  });
});

describe("getAccessStatus", () => {
  it("reports not configured without a key and skips close-only", async () => {
    vi.stubEnv("POLYMARKET_PRIVATE_KEY", "");
    vi.stubEnv("POLYMARKET_WALLET_ADDRESS", "");
    const { getAccessStatus } = await import("@/server/access");
    const s = await getAccessStatus({ fetchGeoblock: async () => ({ blocked: false, country: "US", region: "" }) });
    expect(s).toEqual({ geoblock: { blocked: false, country: "US", region: "" }, closedOnly: null, configured: false });
  });

  it("degrades geoblock to null on failure", async () => {
    vi.stubEnv("POLYMARKET_PRIVATE_KEY", "");
    vi.stubEnv("POLYMARKET_WALLET_ADDRESS", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getAccessStatus } = await import("@/server/access");
    const s = await getAccessStatus({
      fetchGeoblock: async () => {
        throw new Error("down");
      },
    });
    expect(s.geoblock).toBeNull();
  });
});

describe("badgeState", () => {
  const geo = { blocked: false };
  it("maps states", () => {
    expect(badgeState(null)).toBe("UNKNOWN");
    expect(badgeState({ geoblock: geo, closedOnly: false, configured: true })).toBe("OK");
    expect(badgeState({ geoblock: { blocked: true }, closedOnly: true, configured: true })).toBe("CLOSE-ONLY");
    // geoblock.blocked alone is a website flag: IE is website-blocked but API-open.
    expect(badgeState({ geoblock: { blocked: true, country: "IE" }, closedOnly: null, configured: false })).toBe("NOT CONFIGURED");
    expect(badgeState({ geoblock: { blocked: true, country: "IE" }, closedOnly: false, configured: true })).toBe("OK");
    expect(badgeState({ geoblock: { blocked: true, country: "AR" }, closedOnly: null, configured: false })).toBe("CLOSE-ONLY");
    expect(badgeState({ geoblock: { blocked: true, country: "IR" }, closedOnly: false, configured: true })).toBe("BLOCKED");
    expect(badgeState({ geoblock: geo, closedOnly: null, configured: false })).toBe("NOT CONFIGURED");
  });
});
