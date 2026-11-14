"use client";

import { orderColumns } from "../dashboard/columns";
import type { OrderDto } from "../dashboard/types";
import styles from "./activity.module.css";

/** Open-orders table for the event's bottom panel; each row keeps the Cancel button from the dashboard. */
export function YourOrders({ orders }: { orders: OrderDto[] }) {
  if (orders.length === 0) return <div className={styles.state}>No open orders on this event.</div>;
  return (
    <div className={styles.scroll} data-slot="your-orders">
      <table className={styles.table}>
        <thead>
          <tr>
            {orderColumns.map((c, i) => (
              <th key={i} className={c.numeric ? styles.num : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              {orderColumns.map((c, i) => (
                <td key={i} className={c.numeric ? styles.num : undefined} data-slot={c.slot}>
                  {c.render(o)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
