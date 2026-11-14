"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BROWSE_SORTS, type BrowsePage, type Category, type EventCard } from "@/lib/browse-types";
import { browseApiUrl, browseHref, parseBrowseState, rowView, type BrowseState } from "./helpers";
import { ShortcutsCard } from "../shortcuts/ShortcutsCard";
import { StarButton } from "../watchlist/StarButton";
import { WatchlistCard } from "../watchlist/WatchlistCard";
import styles from "./browse.module.css";

const SORT_LABEL = { trending: "Trending", new: "New", ending: "Ending soon" } as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body: fall through to the generic message below.
  }
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

function outcomeClass(label: string, binary: boolean): string {
  const no = binary ? label.trim().toLowerCase() === "no" : false;
  return `${styles.outcome} ${no ? styles.outNo : styles.outYes}`;
}

function EventCardView({ card, featured = false }: { card: EventCard; featured?: boolean }) {
  const v = rowView(card);
  const binary = v.top.length === 2 && v.top[0]?.label.toLowerCase() === "yes";
  return (
    <li className={`${styles.item} ${featured ? styles.featured : ""}`} data-slot={featured ? "browse-featured" : "browse-card"}>
      <Link href={v.href} className={`card ${styles.card}`}>
        <span className={styles.head}>
          {v.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Polymarket CDN images, no loader configured
            <img className={styles.img} src={v.image} alt={v.title} width={featured ? 56 : 40} height={featured ? 56 : 40} loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className={styles.imgPlaceholder} aria-hidden="true" />
          )}
          <span className={styles.title}>{v.title}</span>
        </span>
        <span className={styles.outcomes}>
          {v.top.map((t, i) => (
            <span key={`${t.label}-${i}`} className={outcomeClass(t.label, binary)}>
              <span className={styles.outLabel}>{t.label}</span>
              <span className={`num ${styles.price}`}>{t.price}</span>
            </span>
          ))}
        </span>
        <span className={`muted ${styles.meta}`}>
          <span className="num">{v.volume}</span>
          <span>ends <span className="num">{v.ends}</span></span>
          <span>{v.markets}</span>
        </span>
      </Link>
      <StarButton
        className={styles.star}
        label={v.title}
        item={{ kind: "event", eventSlug: card.slug, eventTitle: card.title }}
      />
    </li>
  );
}

function Skeletons() {
  return (
    <ul className={styles.grid} role="status" aria-label="Loading markets">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className={`card ${styles.skeleton}`} aria-hidden="true" />
      ))}
    </ul>
  );
}

export function BrowseView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseBrowseState(params);
  const key = browseHref(state);

  const [categories, setCategories] = useState<Category[]>([]);
  type Loaded = { id: string; items: EventCard[]; cursor: string | null; error: string | null };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = `${key}#${attempt}`;
  // Data belonging to an older id means the current request is still in flight.
  const loading = loaded?.id !== id;
  const items = loaded && !loading ? loaded.items : [];
  const cursor = loaded && !loading ? loaded.cursor : null;
  const error = (loaded && !loading ? loaded.error : null) ?? moreError;

  useEffect(() => {
    getJson<Category[]>("/api/categories").then(setCategories, () => setCategories([]));
  }, []);

  // Reload from the first page whenever the URL state (or Retry) changes.
  useEffect(() => {
    let live = true;
    const s = parseBrowseState(new URLSearchParams(key.split("?")[1] ?? ""));
    getJson<BrowsePage>(browseApiUrl(s, null)).then(
      (page) => live && (setMoreError(null), setLoaded({ id, items: page.items, cursor: page.nextCursor, error: null })),
      (e: unknown) =>
        live && setLoaded({ id, items: [], cursor: null, error: e instanceof Error ? e.message : "Could not load markets" }),
    );
    return () => {
      live = false;
    };
  }, [key, id]);

  const go = useCallback((next: BrowseState) => router.replace(browseHref(next) === "/" ? pathname : browseHref(next)), [router, pathname]);

  async function loadMore() {
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const page = await getJson<BrowsePage>(browseApiUrl(state, cursor));
      setLoaded((prev) => (prev && prev.id === id ? { ...prev, items: [...prev.items, ...page.items], cursor: page.nextCursor } : prev));
      setMoreError(null);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setMoreBusy(false);
    }
  }

  const searching = state.q !== null;

  return (
    <div className={styles.layout}>
    <div className={styles.wrap}>
      {searching ? (
        <h1 className={styles.heading}>
          <span>Results for &quot;{state.q}&quot;</span>
          <button type="button" className="btn" onClick={() => go({ ...state, q: null })}>
            Clear
          </button>
        </h1>
      ) : (
        <>
          <div className={styles.controls}>
          <div className={styles.chips} role="group" aria-label="Categories">
            <button type="button" className="chip" aria-pressed={state.tag === null} onClick={() => go({ ...state, tag: null })}>
              All
            </button>
            {categories.map((c) => (
              <button key={c.slug} type="button" className="chip" aria-pressed={state.tag === c.slug} onClick={() => go({ ...state, tag: c.slug })}>
                {c.label}
              </button>
            ))}
          </div>
          <div className={`pill-tabs ${styles.sort}`} role="tablist" aria-label="Sort">
            {BROWSE_SORTS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={state.sort === s} onClick={() => go({ ...state, sort: s })}>
                {SORT_LABEL[s]}
              </button>
            ))}
          </div>
          </div>
        </>
      )}

      {loading ? (
        <Skeletons />
      ) : error && items.length === 0 ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className={`card muted ${styles.state}`}>{searching ? "No markets match that search." : "No markets found."}</div>
      ) : (
        <>
          <ul className={styles.grid}>
            {items.map((card, i) => (
              <EventCardView key={card.id} card={card} featured={i === 0 && !searching} />
            ))}
          </ul>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {cursor ? (
            <button type="button" className={`btn ${styles.more}`} onClick={loadMore} disabled={moreBusy}>
              {moreBusy ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      )}
    </div>
    <aside className={styles.rail} aria-label="Sidebar">
      <WatchlistCard />
      <ShortcutsCard />
    </aside>
    </div>
  );
}
