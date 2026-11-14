"use client";

import { useEffect, useMemo, useState } from "react";
import { orderColumns } from "../dashboard/columns";
import styles from "../dashboard/dashboard.module.css";
import type { OrderDto, Page } from "../dashboard/types";
import { useApi } from "../dashboard/useApi";

const POLL_MS = 10_000;

/**
 * "Your orders" strip on the event page: the account's open orders on this event's markets, each
 * with Cancel. Filters the first page of `/api/orders` (up to 50 orders) by condition id.
 */
export function YourOrders({ conditionIds }: { conditionIds: string[] }) {
  const [token, setToken] = useState(0);
  const { data, error } = useApi<Page<OrderDto>>("/api/orders", token);
  const wanted = useMemo(() => new Set(conditionIds.map((c) => c.toLowerCase())), [conditionIds]);

  // Poll while visible so an order placed from the ticket appears without a reload.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setToken((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  if (error?.code === "NOT_CONFIGURED") return null;
  const orders = (data?.items ?? []).filter((o) => wanted.has(o.conditionId.toLowerCase()));

  return (
    <section aria-label="Your orders" data-slot="your-orders">
      <h2 className={styles.cardLabel}>Your orders</h2>
      {error ? <div className={styles.error}>Could not load orders: {error.message}</div> : null}
      {!data && !error ? <div className={styles.state}>Loading…</div> : null}
      {data && orders.length === 0 ? <div className={styles.state}>No open orders on this event.</div> : null}
      {orders.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {orderColumns.map((c, i) => (
                  <th key={i} className={c.numeric ? styles.num : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  {orderColumns.map((c, i) => (
                    <td key={i} className={[c.numeric ? styles.num : "", c.wrap ? styles.titleCell : ""].join(" ")} data-slot={c.slot}>
                      {c.render(o)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
