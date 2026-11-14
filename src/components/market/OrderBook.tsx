"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cents, shares } from "./fmt";
import styles from "./market.module.css";
import tape from "./tape.module.css";
import { useLiveBook } from "./useLiveBook";

const DEPTH = 12;
const FLASH_MS = 600;

const STATUS = { live: "● live", polling: "polling", connecting: "connecting…" } as const;

/** One price level with a depth bar sized by cumulative size; flashes when its size changes. */
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
      className={`${styles.bookRow} ${className}${flash ? ` ${tape.flash}` : ""}`}
      style={{ "--depth": `${depth}%` } as CSSProperties}
    >
      <span role="cell">{cents(price)}</span>
      <span role="cell">{shares(size)}</span>
      <span role="cell">{shares(String(total))}</span>
    </div>
  );
}

/** Running total from the best price outward. `levels` must be ordered best-first. */
function withTotals(levels: { price: string; size: string }[]) {
  let running = 0;
  return levels.map((l) => {
    running += Number(l.size) || 0;
    return { ...l, total: running };
  });
}

/** Live depth ladder for one asset. Remount (via `key`) when the asset changes. */
export function OrderBook({ assetId, label }: { assetId: string; label: string }) {
  const { book, mode, error } = useLiveBook(assetId);

  if (!book) {
    return (
      <section className={`card ${styles.panel}`} aria-label="Order book">
        <div className={styles.muted}>{error ?? `Loading ${label} order book...`}</div>
      </section>
    );
  }
  // Stream books are worst-first, but a polled /api/book has no guaranteed order; sort explicitly.
  const asksBest = [...book.asks].sort((a, b) => Number(a.price) - Number(b.price)).slice(0, DEPTH);
  const bidsBest = withTotals([...book.bids].sort((a, b) => Number(b.price) - Number(a.price)).slice(0, DEPTH));
  const asksTotals = withTotals(asksBest);
  const max = Math.max(1, asksTotals.at(-1)?.total ?? 0, bidsBest.at(-1)?.total ?? 0);
  // Display asks worst-first so the best ask sits next to the spread row.
  const asks = [...asksTotals].reverse();

  return (
    <section className={`card ${styles.panel}`} aria-label="Order book" data-testid="order-book">
      <div className={styles.panelHead}>
        <span className="lbl">Order book</span>
        <span className={`${tape.status} ${tape[mode]}`}>{STATUS[mode]}</span>
      </div>
      {error ? <div className={styles.bad}>{error}</div> : null}
      <div className={styles.bookGrid} role="table" aria-label={`${label} order book`}>
        <div role="row" className={`${styles.bookRow} ${styles.bookHead}`}>
          <span role="columnheader">Price</span>
          <span role="columnheader">Shares</span>
          <span role="columnheader">Total</span>
        </div>
        {asks.map((l) => (
          <Level key={`a${l.price}`} price={l.price} size={l.size} total={l.total} depth={(l.total / max) * 100} className={styles.ask!} />
        ))}
        <div className={styles.sep}>
          <span>Mid {cents(book.midpoint)}</span>
          <span>Spread {cents(book.spread)}</span>
          <span>Tick {book.tickSize}</span>
        </div>
        {bidsBest.map((l) => (
          <Level key={`b${l.price}`} price={l.price} size={l.size} total={l.total} depth={(l.total / max) * 100} className={styles.bid!} />
        ))}
        {asks.length === 0 && bidsBest.length === 0 ? <div className={styles.muted}>No resting orders.</div> : null}
      </div>
    </section>
  );
}
