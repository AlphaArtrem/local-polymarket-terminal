"use client";

import type { RefObject } from "react";
import type { MarketDTO } from "@/lib/market";
import { cents, pct } from "./fmt";
import styles from "./market.module.css";

type Props = {
  markets: MarketDTO[];
  selectedId: string | null;
  filter: string;
  onFilter: (value: string) => void;
  hiddenCount: number;
  showInactive: boolean;
  onToggleInactive: () => void;
  onPick: (marketId: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
};

/** Outcomes list for the event. The 24h column of the design is omitted: no per-outcome 24h data exists. */
export function OutcomesRail({ markets, selectedId, filter, onFilter, hiddenCount, showInactive, onToggleInactive, onPick, filterRef }: Props) {
  return (
    <aside className={`card ${styles.rail}`} aria-label="Outcomes">
      <div className={styles.railInner}>
        <div className={styles.railHead}>
          <span className="lbl">Outcomes · {markets.length}</span>
          {hiddenCount > 0 ? (
            <button type="button" className={styles.chip} aria-pressed={showInactive} onClick={onToggleInactive}>
              {showInactive ? "Hide placeholders" : `Show placeholders (${hiddenCount})`}
            </button>
          ) : null}
        </div>
        <div className={styles.filterWrap}>
          <label className={styles.filter}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93A0AD" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input ref={filterRef} aria-label="Filter outcomes" placeholder="Filter" value={filter} onChange={(e) => onFilter(e.target.value)} />
          </label>
        </div>
        <div className={styles.colHead}><span>Name</span><span>Yes</span></div>
        <ul className={styles.list}>
          {markets.map((m) => (
            <li key={m.id}>
              <button type="button" className={styles.outcome} aria-pressed={m.id === selectedId} onClick={() => onPick(m.id)}>
                <span className={styles.outcomeText}>
                  <span className={styles.outcomeName}>{m.title}</span>
                  <span className={styles.bar} aria-hidden="true"><span className={styles.barFill} style={{ width: `${pct(m.outcomes[0]?.price)}%` }} /></span>
                </span>
                <span className={`num ${styles.outcomeYes}`}>{cents(m.outcomes[0]?.price)}</span>
              </button>
            </li>
          ))}
          {markets.length === 0 ? <li className={styles.empty}>No markets match.</li> : null}
        </ul>
      </div>
    </aside>
  );
}
