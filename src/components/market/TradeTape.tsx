"use client";

import { cents, shares } from "./fmt";
import styles from "./tape.module.css";
import { useLiveBook } from "./useLiveBook";

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}

/** Recent public trades for one asset; shares the asset's single live connection with OrderBook. */
export function TradeTape({ assetId }: { assetId: string }) {
  const { trades } = useLiveBook(assetId);
  return (
    <section className={`card ${styles.card} ${styles.cardTape}`} aria-label="Recent trades">
      <div className={styles.head}>
        <span className={styles.lbl}>Trades</span>
      </div>
      <div className={styles.cols}>
        <span>Price</span>
        <span className={styles.num}>Shares</span>
        <span className={styles.num}>Time</span>
      </div>
      {trades.length === 0 ? (
        <div className={styles.empty}>No trades yet. New fills appear here live.</div>
      ) : (
        <div className={styles.scroller}>
          <div className={styles.scrollInner} data-testid="trade-tape" role="table" aria-label="Recent trades">
            {trades.map((tr, i) => (
              <div
                key={`${tr.t}-${tr.price}-${i}`}
                role="row"
                className={styles.tapeRow}
                title={tr.side === "BUY" ? "Buy" : "Sell"}
              >
                <span role="cell" className={tr.side === "BUY" ? styles.buy : styles.sell}>{cents(tr.price)}</span>
                <span role="cell" className={styles.num}>{tr.size ? shares(tr.size) : "-"}</span>
                <span role="cell" className={`${styles.num} ${styles.muted}`}>{clock(tr.t)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
