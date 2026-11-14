"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cents, shares, wholeUsd } from "./fmt";
import styles from "./tape.module.css";
import { useLiveBook } from "./useLiveBook";

const DEPTH = 8;
const FLASH_MS = 600;

const STATUS = { live: "Live", polling: "Polling", connecting: "Connecting…" } as const;

/** One price level with a depth bar sized by cumulative notional; flashes when its size changes. */
function Level({ price, size, total, depth, className }: { price: string; size: string; total: number; depth: number; className: string }) {
  const [prevSize, setPrevSize] = useState(size);
  const [flash, setFlash] = useState(false);
  if (prevSize !== size) {
    setPrevSize(size);
    setFlash(true);
  }
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash, size]);
  return (
    <div
      role="row"
      className={`${styles.row} ${className}${flash ? ` ${styles.flash}` : ""}`}
      style={{ "--depth": `${depth}%` } as CSSProperties}
    >
      <i className={styles.depth} aria-hidden="true" />
      <span role="cell">{cents(price)}</span>
      <span role="cell">{shares(size)}</span>
      <span role="cell" className={styles.muted}>{wholeUsd(total)}</span>
    </div>
  );
}

/** Running dollar total from the best price outward. `levels` must be ordered best-first. */
function withTotals(levels: { price: string; size: string }[]) {
  let running = 0;
  return levels.map((l) => {
    running += (Number(l.size) || 0) * (Number(l.price) || 0);
    return { ...l, total: running };
  });
}

/** Live depth ladder for one asset. Remount (via `key`) when the asset changes. */
export function OrderBook({ assetId, label }: { assetId: string; label: string }) {
  const { book, mode, error } = useLiveBook(assetId);

  const head = (
    <div className={styles.head}>
      <span className={styles.lbl}>Order book · {label}</span>
      <span className={`${styles.status} ${styles[mode]}`}>
        <span className={styles.dot} aria-hidden="true" />
        {STATUS[mode]}
      </span>
    </div>
  );
  const cols = (
    <div className={styles.cols} role="row">
      <span role="columnheader">Price</span>
      <span role="columnheader" className={styles.num}>Shares</span>
      <span role="columnheader" className={styles.num}>Total</span>
    </div>
  );

  if (!book) {
    return (
      <section className={`card ${styles.card}`} aria-label="Order book">
        {head}
        <div className={styles.empty}>{error ?? `Loading ${label} order book...`}</div>
      </section>
    );
  }
  // Stream books are worst-first, but a polled /api/book has no guaranteed order; sort explicitly.
  const asksBest = withTotals([...book.asks].sort((a, b) => Number(a.price) - Number(b.price)).slice(0, DEPTH));
  const bidsBest = withTotals([...book.bids].sort((a, b) => Number(b.price) - Number(a.price)).slice(0, DEPTH));
  const max = Math.max(1, asksBest.at(-1)?.total ?? 0, bidsBest.at(-1)?.total ?? 0);
  // Display asks worst-first so the best ask sits next to the spread row.
  const asks = [...asksBest].reverse();
  const empty = asks.length === 0 && bidsBest.length === 0;

  return (
    <section className={`card ${styles.card}`} aria-label="Order book" data-testid="order-book">
      {head}
      {error ? <div className={styles.error}>{error}</div> : null}
      {cols}
      {empty ? (
        <div className={styles.empty}>No resting orders on this outcome yet.</div>
      ) : (
        <div className={styles.bookBody} role="table" aria-label={`${label} order book`}>
          {asks.map((l) => (
            <Level key={`a${l.price}`} price={l.price} size={l.size} total={l.total} depth={(l.total / max) * 100} className={styles.ask!} />
          ))}
          <div className={styles.mid}>
            <strong>Mid {cents(book.midpoint)}</strong>
            <span className={styles.muted}>Spread {cents(book.spread)}</span>
          </div>
          {bidsBest.map((l) => (
            <Level key={`b${l.price}`} price={l.price} size={l.size} total={l.total} depth={(l.total / max) * 100} className={styles.bid!} />
          ))}
        </div>
      )}
    </section>
  );
}
