/** Pure helpers for the Browse UI: URL state, search routing and row formatting. */
import { BROWSE_SORTS, type BrowseSort, type EventCard } from "@/lib/browse-types";
import { parseQuery } from "@/lib/search";
import { cents, shortDate, usd } from "@/components/market/fmt";

export type BrowseState = { sort: BrowseSort; tag: string | null; q: string | null };

export const DEFAULT_SORT: BrowseSort = "trending";
const TAG = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MAX_Q = 100;

type Params = { get(name: string): string | null };

/** Reads ?sort=&tag=&q=; invalid values fall back to defaults. */
export function parseBrowseState(params: Params): BrowseState {
  const sort = params.get("sort");
  const tag = params.get("tag");
  const q = params.get("q")?.trim().slice(0, MAX_Q) ?? "";
  return {
    sort: (BROWSE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as BrowseSort) : DEFAULT_SORT,
    tag: tag && TAG.test(tag) ? tag : null,
    q: q || null,
  };
}

/** Builds the href for a state; defaults are omitted. Search mode drops sort/tag. */
export function browseHref(state: BrowseState): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  else {
    if (state.sort !== DEFAULT_SORT) p.set("sort", state.sort);
    if (state.tag) p.set("tag", state.tag);
  }
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

/** API URL for a state and optional cursor. */
export function browseApiUrl(state: BrowseState, cursor: string | null): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  else {
    p.set("sort", state.sort);
    if (state.tag) p.set("tag", state.tag);
  }
  if (cursor) p.set("cursor", cursor);
  return `${state.q ? "/api/search" : "/api/events"}?${p.toString()}`;
}

export type SearchRoute =
  | { action: "lookup"; fallbackQ: string | null }
  | { action: "search"; q: string };

/**
 * Header search decision. URLs, condition ids and numeric ids go to lookup only; a hyphenated
 * slug tries lookup and falls back to text search on NOT_FOUND; everything else is text search.
 */
export function routeSearchInput(input: string): SearchRoute {
  const text = input.trim();
  const parsed = parseQuery(text);
  if (!parsed.ok) return { action: "search", q: text };
  const { query } = parsed;
  // A bare slug (not a URL) is ambiguous with free text; URLs always go to lookup.
  if (query.kind === "eventSlug" && query.slug === text) {
    return text.includes("-") ? { action: "lookup", fallbackQ: text } : { action: "search", q: text };
  }
  return { action: "lookup", fallbackQ: null };
}

export function searchHref(q: string): string {
  return `/?q=${encodeURIComponent(q)}`;
}

export type RowView = {
  href: string;
  title: string;
  image: string | null;
  volume: string;
  ends: string;
  markets: string;
  top: { label: string; price: string }[];
};

export function rowView(card: EventCard): RowView {
  return {
    href: `/market/${encodeURIComponent(card.slug)}`,
    title: card.title,
    image: card.image || null,
    volume: card.volume24h == null ? "-" : `${usd(card.volume24h)} 24h`,
    ends: shortDate(card.endDate),
    markets: `${card.marketCount} ${card.marketCount === 1 ? "market" : "markets"}`,
    top: card.top.slice(0, 2).map((t) => ({ label: t.label, price: cents(t.price) })),
  };
}
