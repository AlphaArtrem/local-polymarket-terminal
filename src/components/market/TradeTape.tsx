"use client";

import { cents, shares } from "./fmt";
import market from "./market.module.css";
import styles from "./tape.module.css";
import { useLiveBook } from "./useLiveBook";

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}

/** Recent public trades for one asset; shares the asset's single live connection with OrderBook. */
export function TradeTape({ assetId }: { assetId: string }) {
  const { trades } = useLiveBook(assetId);
  return (
    <section className={`card ${styles.tapeWrap}`} aria-label="Trades">
      <div className={market.panelHead}>
        <span className="lbl">Trades</span>
      </div>
      {trades.length === 0 ? (
        <div className={styles.empty}>No trades yet</div>
      ) : (
        <div className={styles.tape} data-testid="trade-tape" role="table" aria-label="Recent trades">
          <div role="row" className={`${styles.row} ${styles.head}`}>
            <span role="columnheader">Time</span>
            <span role="columnheader">Side</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Shares</span>
          </div>
          {trades.map((tr, i) => (
            <div key={`${tr.t}-${tr.price}-${i}`} role="row" className={`${styles.row} ${tr.side === "BUY" ? styles.buy : styles.sell}`}>
              <span role="cell">{clock(tr.t)}</span>
              <span role="cell">{tr.side}</span>
              <span role="cell">{cents(tr.price)}</span>
              <span role="cell">{tr.size ? shares(tr.size) : "-"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
