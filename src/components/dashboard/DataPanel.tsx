"use client";

import type { ReactNode } from "react";
import { NotConfiguredHint } from "./NotConfiguredHint";
import styles from "./dashboard.module.css";
import { usePagedApi } from "./useApi";

export type Column<T> = {
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  wrap?: boolean;
  /** Adds `data-slot` to the cell (slice D hooks into `order-actions`). */
  slot?: string;
};

type Props<T> = {
  endpoint: string;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
  refreshToken: number;
};

export function DataPanel<T>({ endpoint, columns, rowKey, empty, refreshToken }: Props<T>) {
  const { items, error, loading, loadingMore, hasMore, loadMore } = usePagedApi<T>(endpoint, refreshToken);

  if (error?.code === "NOT_CONFIGURED") return <NotConfiguredHint />;
  if (loading && items.length === 0) return <div className={styles.state}>Loading…</div>;
  if (error && items.length === 0) return <div className={styles.error}>Error: {error.message}</div>;
  if (items.length === 0) return <div className={styles.state}>{empty}</div>;

  return (
    <div>
      {error ? <div className={styles.error}>Error: {error.message}</div> : null}
      <div className={`card ${styles.panel}`}>
      <div className={styles.tableWrap}>
        <table className="table-dense">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={c.numeric ? "num" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c, i) => (
                  <td
                    key={i}
                    data-slot={c.slot}
                    className={[c.numeric ? "num" : "", c.wrap ? styles.titleCell : ""].join(" ").trim() || undefined}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      {hasMore ? (
        <div className={styles.more}>
          <button type="button" className={`btn ${styles.sm}`} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
