import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError } from "@polymarket/client";
import type { BrowsePage, Category } from "@/lib/browse-types";
import { CATEGORIES } from "@/lib/categories";

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
type Fx = { items: unknown; nextCursor?: string; hasMore: boolean };
const trending = load<Fx>("browse-trending.json");
const fresh = load<{ items: { slug: string }[]; nextCursor?: string; hasMore: boolean }>("browse-new.json");
const search = load<Fx>("browse-search.json");
const tags = load<Record<string, { id: string; slug: string }>>("browse-tags.json");

const paginator = vi.fn();
const client = {
  listEvents: vi.fn(),
  search: vi.fn(),
  fetchTag: vi.fn(),
};
vi.mock("@/server/polymarket", () => ({ getPublicClient: () => client }));

const { GET: events } = await import("@/app/api/events/route");
const { GET: categories } = await import("@/app/api/categories/route");
const { GET: searchRoute } = await import("@/app/api/search/route");
const { clearBrowseCache } = await import("@/server/browse");

/** A paginator whose first page is `page`; `from` records the cursor it was given. */
function pager(page: Fx) {
  const p = { firstPage: vi.fn(async () => page), from: vi.fn((cursor: string) => (paginator(cursor), p)) };
  return p;
}
const get = (handler: (r: Request) => Promise<Response>, path: string) =>
  handler(new Request(`http://127.0.0.1:3737${path}`));

beforeEach(() => {
  clearBrowseCache();
  paginator.mockReset();
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchTag.mockImplementation(async ({ slug }: { slug: string }) => tags[slug]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("curated categories", () => {
  it("GET /api/categories returns the curated list", async () => {
    const res = await get(categories, "/api/categories");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()) as Category[]).toEqual(CATEGORIES);
  });

  it("every curated slug resolved to a numeric tag id in the recorded fixture", () => {
    for (const c of CATEGORIES) expect(Number.isInteger(Number(tags[c.slug]?.id))).toBe(true);
  });
});

describe("GET /api/events", () => {
  it("trending: first page without cursor never calls from()", async () => {
    const p = pager(trending);
    client.listEvents.mockReturnValue(p);
    const res = await get(events, "/api/events");
    const body = (await res.json()) as BrowsePage;
    expect(res.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.nextCursor).toBe(trending.nextCursor);
    expect(p.from).not.toHaveBeenCalled();
    expect(client.listEvents.mock.calls[0]![0]).toMatchObject({ order: "volume24hr", ascending: false, closed: false });
  });

  it("passes the cursor through from()", async () => {
    const p = pager(trending);
    client.listEvents.mockReturnValue(p);
    await get(events, "/api/events?cursor=abc");
    expect(paginator).toHaveBeenCalledWith("abc");
  });

  it("omits nextCursor when there are no more pages", async () => {
    client.listEvents.mockReturnValue(pager({ ...trending, hasMore: false }));
    const body = (await (await get(events, "/api/events")).json()) as BrowsePage;
    expect(body.nextCursor).toBeNull();
  });

  it("ending: orders by endDate ascending from now", async () => {
    client.listEvents.mockReturnValue(pager(trending));
    await get(events, "/api/events?sort=ending");
    expect(client.listEvents.mock.calls[0]![0]).toMatchObject({ order: "endDate", ascending: true, closed: false });
    expect(typeof client.listEvents.mock.calls[0]![0].endDateMin).toBe("string");
  });

  it("tag: resolves the slug to a numeric id once and filters by it", async () => {
    client.listEvents.mockImplementation(() => pager(trending));
    await get(events, "/api/events?tag=politics");
    await get(events, "/api/events?tag=politics&sort=ending");
    expect(client.fetchTag).toHaveBeenCalledTimes(1);
    expect(client.listEvents.mock.calls[0]![0].tagIds).toEqual([Number(tags.politics!.id)]);
  });

  it("new and ending: exclude Polymarket's hide-from-new and recurring tags upstream", async () => {
    client.listEvents.mockImplementation(() => pager({ ...fresh, hasMore: false }));
    await get(events, "/api/events?sort=new&tag=crypto");
    await get(events, "/api/events?sort=ending&tag=crypto");
    for (const call of client.listEvents.mock.calls) expect(call[0].excludeTagIds).toEqual([102169, 101757]);
  });

  it("ending: drops recurring up/down events too (H10)", async () => {
    client.listEvents.mockImplementation(() => pager({ ...fresh, hasMore: false }));
    const body = (await (await get(events, "/api/events?sort=ending")).json()) as BrowsePage;
    expect(body.items.some((c) => /-updown-\d+[mh]-/.test(c.slug))).toBe(false);
  });

  it("new: drops recurring up/down events and still returns a page", async () => {
    expect(fresh.items.some((e) => e.slug.includes("-updown-5m-"))).toBe(true); // fixture sanity
    client.listEvents.mockImplementation(() => pager({ ...fresh, hasMore: false }));
    const body = (await (await get(events, "/api/events?sort=new")).json()) as BrowsePage;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((c) => c.slug.includes("-updown-"))).toBe(false);
    expect(body.items.some((c) => c.slug.includes("multi-strikes") || c.slug.startsWith("bitcoin-above-on"))).toBe(false);
  });

  it("new: widens over several upstream pages when the first is all recurring", async () => {
    const recurring = { ...fresh, items: fresh.items.filter((e) => e.slug.includes("-updown-5m-")), hasMore: true, nextCursor: "n1" };
    const real = { ...fresh, items: fresh.items.filter((e) => !e.slug.includes("-updown-5m-")), hasMore: false };
    const first = pager(recurring);
    const second = pager(real);
    client.listEvents.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const body = (await (await get(events, "/api/events?sort=new")).json()) as BrowsePage;
    expect(paginator).toHaveBeenCalledWith("n1");
    expect(body.items.length).toBeGreaterThan(0);
  });

  it.each(["sort=bogus", "tag=nope", `cursor=${"x".repeat(513)}`])("rejects %s with INVALID_QUERY before any SDK call", async (qs) => {
    const res = await get(events, `/api/events?${qs}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_QUERY");
    expect(client.listEvents).not.toHaveBeenCalled();
    expect(client.fetchTag).not.toHaveBeenCalled();
  });

  it("maps RateLimitError to 429 and other failures to 502", async () => {
    client.listEvents.mockReturnValueOnce({ firstPage: async () => { throw Object.create(RateLimitError.prototype); } });
    const limited = await get(events, "/api/events");
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    client.listEvents.mockReturnValueOnce({ firstPage: async () => { throw new Error("boom"); } });
    expect((await get(events, "/api/events")).status).toBe(502);
  });

  it("serves a repeat request from the cache without a second SDK call", async () => {
    client.listEvents.mockImplementation(() => pager(trending));
    await get(events, "/api/events?sort=trending");
    await get(events, "/api/events?sort=trending");
    expect(client.listEvents).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/search", () => {
  it("returns event cards from the search results and trims q", async () => {
    const p = pager(search);
    client.search.mockReturnValue(p);
    const res = await get(searchRoute, "/api/search?q=%20bitcoin%20");
    const body = (await res.json()) as BrowsePage;
    expect(res.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(client.search.mock.calls[0]![0].q).toBe("bitcoin");
    expect(p.from).not.toHaveBeenCalled();
  });

  it("passes a cursor to from()", async () => {
    client.search.mockReturnValue(pager(search));
    await get(searchRoute, "/api/search?q=bitcoin&cursor=zzz");
    expect(paginator).toHaveBeenCalledWith("zzz");
  });

  it.each(["", "q=", "q=%20%20", `q=${"a".repeat(101)}`])("rejects %j with INVALID_QUERY", async (qs) => {
    const res = await get(searchRoute, `/api/search?${qs}`);
    expect(res.status).toBe(400);
    expect(client.search).not.toHaveBeenCalled();
  });
});
