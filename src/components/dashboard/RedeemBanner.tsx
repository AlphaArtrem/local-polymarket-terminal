"use client";

import { formatUsd } from "@/lib/format";
import { RedeemButton } from "./RedeemButton";
import styles from "./dashboard.module.css";
import type { Page, PositionDto } from "./types";

/** Notice listing resolved markets that can be claimed. Renders nothing when there are none. */
export function RedeemBanner({ positions, onRedeemed }: { positions: Page<PositionDto> | null; onRedeemed?: () => void }) {
  // Until the positions load (or on any error, including NOT_CONFIGURED) nothing renders.
  if (!positions) return null;

  // One entry per market, summing every redeemable outcome held in it.
  const byCondition = new Map<string, { first: PositionDto; value: number }>();
  for (const p of positions.items) {
    if (!p.redeemable) continue;
    const entry = byCondition.get(p.conditionId);
    const value = Number(p.currentValue) || 0;
    if (entry) entry.value += value;
    else byCondition.set(p.conditionId, { first: p, value });
  }
  if (byCondition.size === 0) return null;
  const markets = [...byCondition.values()];
  const total = markets.reduce((sum, m) => sum + m.value, 0);

  return (
    <section className={`card ${styles.redeem}`} role="status">
      <strong>
        {markets.length} resolved {markets.length === 1 ? "position" : "positions"} worth {formatUsd(total)} can be claimed
      </strong>
      <ul className={styles.redeemList}>
        {markets.map(({ first, value }) => (
          <li key={first.conditionId} className={styles.redeemRow}>
            <span>
              {first.title ?? first.conditionId}
              {first.outcome ? ` · ${first.outcome}` : ""} <span className={`${styles.mono} muted`}>· {formatUsd(value)}</span>
            </span>
            <RedeemButton position={first} prominent onDone={onRedeemed} />
          </li>
        ))}
      </ul>
    </section>
  );
}
