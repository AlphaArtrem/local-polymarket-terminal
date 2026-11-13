"use client";

import { useEffect, useState } from "react";
import type { BookDTO } from "@/lib/market";
import { cents, shares } from "./fmt";
import styles from "./market.module.css";

const POLL_MS = 5000;
const DEPTH = 12;

type State = { book: BookDTO | null; error: string | null };

/** Live depth table for one asset. Remount (via `key`) when the asset changes. */
export function OrderBook({ assetId, label }: { assetId: string; label: string }) {
  const [state, setState] = useState<State>({ book: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function load() {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch(`/api/book?assetId=${encodeURIComponent(assetId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body: unknown = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const message = (body as { error?: { message?: string } }).error?.message;
          setState((s) => ({ ...s, error: message ?? `Request failed (${res.status})` }));
          return;
        }
        setState({ book: body as BookDTO, error: null });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setState((s) => ({ ...s, error: "Could not reach the order book" }));
      }
    }

    void load();
    // Poll only while the tab is visible; refresh immediately when it becomes visible again.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [assetId]);

  const { book, error } = state;
  if (!book) {
    return <div className={styles.muted}>{error ?? `Loading ${label} order book...`}</div>;
  }
  // The CLOB returns levels in no guaranteed order; sort explicitly.
  const asks = [...book.asks].sort((a, b) => Number(a.price) - Number(b.price)).slice(0, DEPTH);
  const bids = [...book.bids].sort((a, b) => Number(b.price) - Number(a.price)).slice(0, DEPTH);

  return (
    <div className={styles.book} data-testid="order-book">
      <div className={styles.bookStats}>
        <span>Mid {cents(book.midpoint)}</span>
        <span>Spread {cents(book.spread)}</span>
        <span>Tick {book.tickSize}</span>
        {error ? <span className={styles.bad}>{error}</span> : null}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Price</th>
            <th className={styles.num}>Shares</th>
          </tr>
        </thead>
        <tbody>
          {[...asks].reverse().map((l) => (
            <tr key={`a${l.price}`} className={styles.ask}>
              <td>{cents(l.price)}</td>
              <td className={styles.num}>{shares(l.size)}</td>
            </tr>
          ))}
          <tr className={styles.sep}>
            <td colSpan={2}>{label}</td>
          </tr>
          {bids.map((l) => (
            <tr key={`b${l.price}`} className={styles.bid}>
              <td>{cents(l.price)}</td>
              <td className={styles.num}>{shares(l.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
