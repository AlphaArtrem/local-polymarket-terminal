"use client";

import { useEffect, useState } from "react";
import { cents, shares } from "./fmt";
import styles from "./market.module.css";
import tape from "./tape.module.css";
import { useLiveBook } from "./useLiveBook";

const DEPTH = 12;
const FLASH_MS = 600;

const STATUS = { live: "● live", polling: "polling", connecting: "connecting…" } as const;

/** One price level; briefly highlights when its size changes after first render. */
function Level({ price, size, className }: { price: string; size: string; className: string }) {
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
    <tr className={`${className}${flash ? ` ${tape.flash}` : ""}`}>
      <td>{cents(price)}</td>
      <td className={styles.num}>{shares(size)}</td>
    </tr>
  );
}

/** Live depth table for one asset. Remount (via `key`) when the asset changes. */
export function OrderBook({ assetId, label }: { assetId: string; label: string }) {
  const { book, mode, error } = useLiveBook(assetId);

  if (!book) {
    return <div className={styles.muted}>{error ?? `Loading ${label} order book...`}</div>;
  }
  // Stream books are worst-first, but a polled /api/book has no guaranteed order; sort explicitly.
  const asks = [...book.asks].sort((a, b) => Number(b.price) - Number(a.price)).slice(-DEPTH);
  const bids = [...book.bids].sort((a, b) => Number(b.price) - Number(a.price)).slice(0, DEPTH);

  return (
    <div className={styles.book} data-testid="order-book">
      <div className={styles.bookStats}>
        <span>Mid {cents(book.midpoint)}</span>
        <span>Spread {cents(book.spread)}</span>
        <span>Tick {book.tickSize}</span>
        <span className={`${tape.status} ${tape[mode]}`}>{STATUS[mode]}</span>
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
          {asks.map((l) => (
            <Level key={`a${l.price}`} price={l.price} size={l.size} className={styles.ask!} />
          ))}
          <tr className={styles.sep}>
            <td colSpan={2}>{label}</td>
          </tr>
          {bids.map((l) => (
            <Level key={`b${l.price}`} price={l.price} size={l.size} className={styles.bid!} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
