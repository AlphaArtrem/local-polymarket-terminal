import type { Category } from "./browse-types";

/**
 * Curated Browse categories. `client.listTags({ isCarousel: true })` returns a single tag, so the
 * list is fixed here. Every slug was resolved with `fetchTag` on 2026-11-14 (external-facts F22);
 * the numeric tag id is looked up at runtime and cached, never hard-coded.
 */
export const CATEGORIES: readonly Category[] = [
  { slug: "politics", label: "Politics" },
  { slug: "sports", label: "Sports" },
  { slug: "crypto", label: "Crypto" },
  { slug: "tech", label: "Tech" },
  { slug: "ai", label: "AI" },
  { slug: "economy", label: "Economy" },
  { slug: "world", label: "World" },
  { slug: "pop-culture", label: "Culture" },
];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [string, ...string[]];
