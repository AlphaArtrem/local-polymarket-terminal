import { describe, expect, it, vi } from "vitest";
import pkg from "../package.json";
import { SDK_USER_AGENT, withUserAgent } from "@/lib/sdk-fetch";

const URL_ = "https://data-api.polymarket.com/v2/positions?user=0x1&status=OPEN&limit=50";

function capture() {
  const base = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("{}"));
  const headersOf = () => new Headers(base.mock.calls[0]![1]?.headers);
  return { base, headersOf };
}

describe("withUserAgent", () => {
  it("adds the SDK User-Agent when the request has none (Node's default 'node' gets 429 on /v2/positions)", async () => {
    const t = capture();
    await withUserAgent(t.base)(URL_);
    expect(t.base.mock.calls[0]![0]).toBe(URL_);
    expect(t.headersOf().get("user-agent")).toBe(SDK_USER_AGENT);
  });

  it("keeps every other header, the method and the body unchanged", async () => {
    const t = capture();
    await withUserAgent(t.base)(URL_, { method: "POST", body: "x", headers: { "POLY_SIGNATURE": "sig", "content-type": "application/json" } });
    const init = t.base.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("x");
    expect(t.headersOf().get("poly_signature")).toBe("sig");
    expect(t.headersOf().get("content-type")).toBe("application/json");
  });

  it("does not override a User-Agent the caller set, in init or on a Request", async () => {
    const a = capture();
    await withUserAgent(a.base)(URL_, { headers: { "User-Agent": "custom" } });
    expect(a.headersOf().get("user-agent")).toBe("custom");

    const b = capture();
    await withUserAgent(b.base)(new Request(URL_, { headers: { "user-agent": "from-request", "x-k": "v" } }));
    expect(b.headersOf().get("user-agent")).toBe("from-request");
    expect(b.headersOf().get("x-k")).toBe("v");
  });

  it("names the pinned SDK version", () => {
    expect(SDK_USER_AGENT).toBe(`@polymarket/client/${pkg.dependencies["@polymarket/client"]}`);
  });
});
