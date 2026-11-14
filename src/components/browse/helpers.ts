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

/** Tile colours (background, text) from the design; picked by title so a card keeps its colour. */
const TILES: [string, string][] = [
  ["#14233A", "#7AA7FF"],
  ["#2A1712", "#FF8F73"],
  ["#221C10", "#E8C27A"],
  ["#12251F", "#4FD1A5"],
  ["#211533", "#B99CFF"],
  ["#102229", "#6FD3E8"],
];

/** Up to two uppercase initials from the first words of a title. */
export function initials(title: string): string {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!;
  return (words.length === 1 ? first.slice(0, 2) : first[0]! + words[1]![0]!).toUpperCase();
}

export function tileColors(title: string): { background: string; color: string } {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [background, color] = TILES[h % TILES.length]!;
  return { background, color };
}

/** "0.285" -> "29%" (whole percent, display only); unknown -> "-". */
export function pctText(price: string | null | undefined): string {
  if (price == null) return "-";
  const n = Number(price);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "-";
}

export type GridRow = { label: string; pct: string; href: string };

/** Two outcome rows for a grid card. */
export function gridRows(card: EventCard): GridRow[] {
  return card.top.slice(0, 2).map((t) => ({
    label: t.label,
    pct: pctText(t.price),
    href: buyHref(card.slug, t.assetId ?? null),
  }));
}

export type FeaturedRow = {
  name: string;
  pct: number;
  pctLabel: string;
  yesAssetId: string | null;
  yesPrice: string;
  noAssetId: string | null;
  noPrice: string;
};

type LookupMarket = {
  title: string;
  listed: boolean;
  outcomes: { label: string; assetId: string; price: string | null }[];
};

const yesOf = (m: LookupMarket) => Number(m.outcomes[0]?.price ?? -1);

/** Top rows of a looked-up event: listed, still-open markets by Yes price (settled ones only as a fallback). */
export function featuredRows(markets: LookupMarket[], limit = 4): FeaturedRow[] {
  const listed = markets.filter((m) => m.listed && m.outcomes.length > 0);
  const open = listed.filter((m) => yesOf(m) > 0 && yesOf(m) < 1);
  return [...(open.length > 0 ? open : listed)]
    .sort((a, b) => yesOf(b) - yesOf(a))
    .slice(0, limit)
    .map((m) => {
      const yes = m.outcomes[0];
      const no = m.outcomes[1];
      const p = Number(yes?.price);
      return {
        name: m.title,
        pct: Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p * 100))) : 0,
        pctLabel: pctText(yes?.price),
        yesAssetId: yes?.assetId ?? null,
        yesPrice: cents(yes?.price),
        noAssetId: no?.assetId ?? null,
        noPrice: cents(no?.price),
      };
    });
}

/** Link that opens the market page on a prefilled buy of one outcome. */
export function buyHref(slug: string, assetId: string | null): string {
  const base = `/market/${encodeURIComponent(slug)}`;
  return assetId && /^\d+$/.test(assetId) ? `${base}?asset=${assetId}&side=BUY` : base;
}

export type Series = { t: number; p: number }[];

/**
 * SVG path strings (viewBox width x height) for several series on one shared time and price
 * scale, so lines are comparable. Empty input yields no paths.
 */
export function linePaths(series: Series[], width: number, height: number, pad = 12): string[] {
  const all = series.flat();
  if (all.length < 2) return series.map(() => "");
  const ts = all.map((s) => s.t);
  const ps = all.map((s) => s.p);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const p0 = Math.min(...ps);
  const p1 = Math.max(...ps);
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * width);
  const y = (p: number) => (p1 === p0 ? height / 2 : pad + (1 - (p - p0) / (p1 - p0)) * (height - 2 * pad));
  return series.map((s) =>
    s.length < 2 ? "" : s.map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(""),
  );
}
