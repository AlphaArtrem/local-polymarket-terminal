/**
 * Phase 5 Browse contract, shared by the server (slice E) and the UI (slice F).
 * Owned by the main session: change it only together with both sides.
 *
 * Routes (all GET, no key needed, standard `{ error: { code, message } }` envelope on failure):
 *   /api/events?sort=<BrowseSort>&tag=<category slug>&cursor=<opaque>  -> BrowsePage
 *   /api/categories                                                    -> Category[]
 *   /api/search?q=<1..100 chars>&cursor=<opaque>                       -> BrowsePage
 */

export const BROWSE_SORTS = ["trending", "new", "ending"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

/** One event row in a Browse list. Prices and money are decimal strings, never floats. */
export type EventCard = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  /** 24h volume in dollars, or null when Polymarket does not report it. */
  volume24h: string | null;
  liquidity: string | null;
  /** ISO 8601 end date, or null. */
  endDate: string | null;
  /** Number of listed markets (inactive negRisk placeholders excluded, external-facts F14d). */
  marketCount: number;
  /**
   * Up to 2 outcomes to show on the row: for a binary event its Yes and No; for a multi-market
   * event the 2 listed markets with the highest Yes price, labelled by the market's short title.
   * `price` is a probability in 0..1 as a decimal string, or null when unknown.
   */
  top: { label: string; price: string | null }[];
};

/** A browse category backed by a Polymarket tag slug. */
export type Category = { slug: string; label: string };

export type BrowsePage = { items: EventCard[]; nextCursor: string | null };
