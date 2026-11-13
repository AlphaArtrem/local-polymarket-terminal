import { describe, expect, it } from "vitest";
import { decideRequest } from "@/lib/guard";

const base = { method: "GET", host: "127.0.0.1:3737", origin: null, port: 3737 };

describe("decideRequest", () => {
  it("allows loopback hosts on the configured port", () => {
    expect(decideRequest(base).allow).toBe(true);
    expect(decideRequest({ ...base, host: "localhost:3737" }).allow).toBe(true);
    expect(decideRequest({ ...base, method: "HEAD" }).allow).toBe(true);
  });

  it.each(["evil.com", "127.0.0.1:9999", "127.0.0.1", "0.0.0.0:3737", "127.0.0.1:3737.evil.com", null])(
    "rejects host %s",
    (host) => {
      expect(decideRequest({ ...base, host }).allow).toBe(false);
    },
  );

  it("requires a same-origin Origin for mutating methods", () => {
    const post = { ...base, method: "POST" };
    expect(decideRequest(post).allow).toBe(false);
    expect(decideRequest({ ...post, origin: "http://127.0.0.1:3737" }).allow).toBe(true);
    expect(decideRequest({ ...post, origin: "http://localhost:3737", host: "localhost:3737" }).allow).toBe(true);
    expect(decideRequest({ ...post, origin: "http://evil.com" }).allow).toBe(false);
    expect(decideRequest({ ...post, origin: "http://localhost:3737" }).allow).toBe(false);
    expect(decideRequest({ ...post, origin: "https://127.0.0.1:3737" }).allow).toBe(false);
    expect(decideRequest({ ...post, origin: "null" }).allow).toBe(false);
    expect(decideRequest({ ...post, method: "DELETE", origin: null }).allow).toBe(false);
  });
});
