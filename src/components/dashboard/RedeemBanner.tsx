"use client";

import { useState } from "react";
import { formatUsd } from "@/lib/format";
import { RedeemButton } from "./RedeemButton";
import styles from "./dashboard.module.css";
import type { Page, PositionDto } from "./types";
import { useApi } from "./useApi";

/** Notice listing resolved markets that can be claimed. Renders nothing when there are none. */
export function RedeemBanner({ refreshToken, onRedeemed }: { refreshToken: number; onRedeemed?: () => void }) {
  const [localToken, setLocalToken] = useState(0);
  const { data } = useApi<Page<PositionDto>>("/api/positions?status=OPEN", refreshToken + localToken);
  // On any error (including NOT_CONFIGURED) `data` stays null and nothing renders.
  if (!data) return null;

  // One entry per market, summing every redeemable outcome held in it.
  const byCondition = new Map<string, { first: PositionDto; value: number }>();
  for (const p of data.items) {
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
    <div className={`${styles.notice} ${styles.noticeSpaced}`} role="status">
      <p>
        <strong>
          {markets.length} resolved {markets.length === 1 ? "position" : "positions"} worth {formatUsd(total)} can be claimed
        </strong>
      </p>
      <ul className={styles.noticeList}>
        {markets.map(({ first, value }) => (
          <li key={first.conditionId}>
            {first.title ?? first.conditionId} · {formatUsd(value)}{" "}
            <RedeemButton
              position={first}
              onDone={() => {
                setLocalToken((n) => n + 1);
                onRedeemed?.();
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
