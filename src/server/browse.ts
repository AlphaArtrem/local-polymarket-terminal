import "server-only";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";
import { z } from "zod";
import { BROWSE_SORTS, type BrowsePage, type BrowseSort, type Category, type EventCard } from "@/lib/browse-types";
import { CATEGORIES, CATEGORY_SLUGS } from "@/lib/categories";
import { toEventCard, type EventCardSource } from "@/lib/event-card";
import { jsonError } from "@/lib/http";
import { getPublicClient } from "./polymarket";

const PAGE_SIZE = 20;
const NEW_FETCH_SIZE = 50; // over-fetch: most of the newest events are auto-generated
const NEW_MIN_ITEMS = 12; // stop widening once a "new" page has this many real events
const NEW_MAX_FETCHES = 4;
const CACHE_TTL_MS = 45_000;
const CACHE_MAX_ENTRIES = 200;

// ---- Query validation (system boundary) -------------------------------------------------------

const cursorSchema = z.string().max(512).optional();

const eventsQuerySchema = z.object({
  sort: z.enum(BROWSE_SORTS).default("trending"),
  tag: z.enum(CATEGORY_SLUGS).optional(),
  cursor: cursorSchema,
});
const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(100), cursor: cursorSchema });

/** Absent or empty params count as unset; anything else must pass the schema. */
function param(url: URL, name: string): string | undefined {
  const v = url.searchParams.get(name);
  return v === null || v === "" ? undefined : v;
}

export function parseEventsQuery(url: URL) {
  return eventsQuerySchema.safeParse({ sort: param(url, "sort"), tag: param(url, "tag"), cursor: param(url, "cursor") });
}

export function parseSearchQuery(url: URL) {
  return searchQuerySchema.safeParse({ q: url.searchParams.get("q") ?? "", cursor: param(url, "cursor") });
}

// ---- Short in-memory cache ---------------------------------------------------------------------

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load(); // failures are never cached
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Test hook. */
export function clearBrowseCache(): void {
  cache.clear();
  tagIds.clear();
}

// ---- Recurring / auto-generated events (hazard H10) --------------------------------------------

type BrowseEvent = EventCardSource & {
  slug?: string | null;
  state?: { closed?: boolean | null } | null;
  series?: { slug?: string | null }[] | null;
  sports?: { gameId?: number | null } | null;
};

// "-updown-5m-<ts>" events, and series such as "xrp-up-or-down-5m" or "bitcoin-multi-strikes-hourly".
const RECURRING_SLUG = /-updown-\d+[mhd]-\d+$|-up-or-down-\d+[mh]$|-(?:hourly|daily)$|-multi-strikes/;
const RECURRING_SERIES = /up-or-down|multi-strikes|-(?:5m|15m|1h|4h|hourly)$/;

/**
 * Polymarket's own tags for bulk-generated events (live 2026-11-14, external-facts F25):
 * `hide-from-new` 102169 (the website hides these from its New list) and `recurring` 101757.
 * Excluded upstream so a page is not consumed by them; the slug/series check below stays as a
 * safety net in case tagging lags.
 */
export const EXCLUDED_FROM_NEW_TAG_IDS = [102169, 101757];

function isRecurring(event: BrowseEvent): boolean {
  if (RECURRING_SLUG.test(event.slug ?? "")) return true;
  return (event.series ?? []).some((s) => RECURRING_SERIES.test(s.slug ?? ""));
}

/** Per-match sports events are created in bulk too; hide them from "new" unless browsing Sports. */
function isGame(event: BrowseEvent): boolean {
  return event.sports?.gameId != null;
}

// ---- Tag slug -> id -----------------------------------------------------------------------------

const tagIds = new Map<string, number>();

async function resolveTagId(slug: string): Promise<number> {
  const known = tagIds.get(slug);
  if (known !== undefined) return known;
  const tag = await getPublicClient().fetchTag({ slug });
  const id = Number(tag.id);
  if (!Number.isInteger(id)) throw new Error("Tag id is not numeric");
  tagIds.set(slug, id);
  return id;
}

// ---- Listing ------------------------------------------------------------------------------------

type Paginator<T> = {
  firstPage(): Promise<{ items: T; nextCursor?: string | null; hasMore: boolean }>;
  from(cursor: never): Paginator<T>;
};

/** Hazard H11: `from(undefined)` returns an empty page, so only call it with a real cursor. */
async function fetchPage<T>(paginator: Paginator<T>, cursor: string | undefined) {
  return cursor ? (paginator.from(cursor as never) as Paginator<T>).firstPage() : paginator.firstPage();
}

const toPage = (items: EventCard[], hasMore: boolean, next: string | null | undefined): BrowsePage => ({
  items,
  nextCursor: hasMore && next ? next : null,
});

async function listNew(tagId: number | undefined, isSports: boolean, cursor: string | undefined): Promise<BrowsePage> {
  const client = getPublicClient();
  const kept: EventCard[] = [];
  let next = cursor;
  let hasMore = true;
  let nextCursor: string | null | undefined;
  for (let i = 0; i < NEW_MAX_FETCHES && hasMore && kept.length < NEW_MIN_ITEMS; i++) {
    const page = await fetchPage(
      client.listEvents({
        order: "createdAt",
        ascending: false,
        closed: false,
        pageSize: NEW_FETCH_SIZE,
        excludeTagIds: EXCLUDED_FROM_NEW_TAG_IDS,
        ...(tagId === undefined ? {} : { tagIds: [tagId] }),
      }),
      next,
    );
    for (const event of page.items as BrowseEvent[]) {
      if (isRecurring(event) || (isGame(event) && !isSports)) continue;
      kept.push(toEventCard(event));
    }
    hasMore = page.hasMore;
    nextCursor = page.nextCursor;
    next = page.nextCursor ?? undefined;
  }
  return toPage(kept, hasMore, nextCursor);
}

async function listOrdered(sort: "trending" | "ending", tagId: number | undefined, cursor: string | undefined) {
  const request =
    sort === "trending"
      ? ({ order: "volume24hr", ascending: false, closed: false, active: true } as const)
      : ({
          order: "endDate",
          ascending: true,
          closed: false,
          active: true,
          endDateMin: new Date().toISOString(),
          excludeTagIds: EXCLUDED_FROM_NEW_TAG_IDS,
        } as const);
  const page = await fetchPage(
    getPublicClient().listEvents({ ...request, pageSize: PAGE_SIZE, ...(tagId === undefined ? {} : { tagIds: [tagId] }) }),
    cursor,
  );
  // "Ending soon" is otherwise dominated by recurring 5/15-minute crypto events (hazard H10).
  const items = page.items as BrowseEvent[];
  const kept = sort === "ending" ? items.filter((e) => !isRecurring(e)) : items;
  return toPage(kept.map(toEventCard), page.hasMore, page.nextCursor);
}

export function browseEvents(input: { sort: BrowseSort; tag?: string | undefined; cursor?: string | undefined }): Promise<BrowsePage> {
  const { sort, tag, cursor } = input;
  return cached(JSON.stringify(["events", sort, tag ?? null, cursor ?? null]), async () => {
    const tagId = tag === undefined ? undefined : await resolveTagId(tag);
    return sort === "new" ? listNew(tagId, tag === "sports", cursor) : listOrdered(sort, tagId, cursor);
  });
}

export function browseSearch(input: { q: string; cursor?: string | undefined }): Promise<BrowsePage> {
  const { q, cursor } = input;
  return cached(JSON.stringify(["search", q, cursor ?? null]), async () => {
    const page = await fetchPage(getPublicClient().search({ q, pageSize: PAGE_SIZE }), cursor);
    const events = (page.items.events as BrowseEvent[]).filter((e) => e.state?.closed !== true);
    return toPage(events.map(toEventCard), page.hasMore, page.nextCursor);
  });
}

export function listCategories(): Category[] {
  return CATEGORIES.map((c) => ({ ...c }));
}

// ---- Route glue ---------------------------------------------------------------------------------

export const INVALID_QUERY = (message: string) => jsonError(400, "INVALID_QUERY", message);

/** Runs a read and maps failures to the shared error envelope. Logs the error name only. */
export async function respondBrowse(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("browse request failed:", err instanceof Error ? err.name : "unknown");
    if (err instanceof RateLimitError) return jsonError(429, "RATE_LIMITED", "Rate limited by Polymarket; retry shortly");
    if (err instanceof UserInputError) return INVALID_QUERY("Polymarket rejected the query");
    if (err instanceof RequestRejectedError && err.status === 404) return jsonError(404, "NOT_FOUND", "Not found");
    return jsonError(502, "UPSTREAM_ERROR", "Polymarket request failed");
  }
}

export function invalidQuery(error: z.ZodError): Response {
  return INVALID_QUERY(error.issues[0]?.message ?? "Invalid query");
}
