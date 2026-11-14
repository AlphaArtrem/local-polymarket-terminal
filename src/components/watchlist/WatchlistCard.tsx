"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toCents } from "@/lib/alerts";
import type { PricesDTO } from "@/lib/phase7-types";
import { deltaCents, outcomeIds, type WatchItem } from "@/lib/watchlist";
import styles from "./watchlist.module.css";
import { unwatch, useWatchlist } from "./useWatchlist";

const POLL_MS = 15_000;

/** Polls one /api/prices request for all ids while mounted and the tab is visible. */
function usePrices(ids: string[]): Record<string, string | null> {
  const [prices, setPrices] = useState<Record<string, string | null>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctl = new AbortController();

    async function tick() {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/prices?assetIds=${key}`, { cache: "no-store", signal: ctl.signal });
          if (res.ok) {
            const dto = (await res.json()) as PricesDTO;
            if (live) setPrices(dto.prices);
          }
        } catch {
          // Network error or abort: keep the last prices and retry on the next tick.
        }
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && live) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      ctl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  return prices;
}

function Row({ item, prices, editing }: { item: WatchItem; prices: Record<string, string | null>; editing: boolean }) {
  const slug = encodeURIComponent(item.eventSlug);
  let body;
  if (item.kind === "outcome") {
    const now = prices[item.assetId] ?? null;
    const delta = deltaCents(item.priceAtAdd, now);
    const tone = delta === null ? "" : delta.startsWith("+") ? "pos" : delta.startsWith("-") ? "neg" : "muted";
    body = (
      <Link className={styles.link} href={`/market/${slug}?asset=${item.assetId}`}>
        <span className={styles.name}>
          <span className={styles.label}>{item.label}</span>
          <span className={`muted ${styles.sub}`}>{item.eventTitle}</span>
        </span>
        <span className={styles.figs}>
          <span className="num">{now === null ? "—" : `${toCents(now)}¢`}</span>
          {delta !== null && (
            <span className={`num ${tone} ${styles.delta}`} title="since starred">
              {delta}¢
            </span>
          )}
        </span>
      </Link>
    );
  } else {
    body = (
      <Link className={styles.link} href={`/market/${slug}`}>
        <span className={styles.name}>
          <span className={styles.label}>{item.eventTitle}</span>
          <span className={`muted ${styles.sub}`}>Event</span>
        </span>
      </Link>
    );
  }
  return (
    <li className={styles.row}>
      {body}
      {editing && (
        <button
          type="button"
          className={`btn btn-ghost ${styles.remove}`}
          aria-label={`Remove ${item.kind === "outcome" ? item.label : item.eventTitle} from watchlist`}
          onClick={() => unwatch(item.id)}
        >
          ×
        </button>
      )}
    </li>
  );
}

export function WatchlistCard() {
  const items = useWatchlist();
  const [editing, setEditing] = useState(false);
  const ids = useMemo(() => outcomeIds(items), [items]);
  const prices = usePrices(ids);

  return (
    <section className={`card ${styles.card}`} aria-label="Watchlist">
      <div className={styles.head}>
        <span className="lbl">Watchlist ({items.length})</span>
        {items.length > 0 && (
          <button type="button" className="chip" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
            Edit
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Star a market to pin it here.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <Row key={item.id} item={item} prices={prices} editing={editing} />
          ))}
        </ul>
      )}
    </section>
  );
}
