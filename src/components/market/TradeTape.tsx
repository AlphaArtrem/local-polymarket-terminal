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
  if (trades.length === 0) return <div className={market.muted}>No trades yet</div>;
  return (
    <div className={styles.tape} data-testid="trade-tape">
      <table className={market.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th className={market.num}>Price</th>
            <th className={market.num}>Shares</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((tr, i) => (
            <tr key={`${tr.t}-${tr.price}-${i}`} className={tr.side === "BUY" ? styles.buy : styles.sell}>
              <td>{clock(tr.t)}</td>
              <td>{tr.side}</td>
              <td className={market.num}>{cents(tr.price)}</td>
              <td className={market.num}>{tr.size ? shares(tr.size) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
