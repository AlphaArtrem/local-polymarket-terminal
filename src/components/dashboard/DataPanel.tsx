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

/** Table body of the Portfolio card: headers always show, empty/loading/error are centred rows. */
export function DataPanel<T>({ endpoint, columns, rowKey, empty, refreshToken }: Props<T>) {
  const { items, error, loading, loadingMore, hasMore, loadMore } = usePagedApi<T>(endpoint, refreshToken);

  if (error?.code === "NOT_CONFIGURED") return <NotConfiguredHint />;

  let message: ReactNode = null;
  if (loading && items.length === 0) message = "Loading…";
  else if (error && items.length === 0) message = <span className={styles.exportError}>Error: {error.message}</span>;
  else if (items.length === 0) message = empty;

  return (
    <div>
      {error && items.length > 0 ? <div className={styles.error}>Error: {error.message}</div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={c.numeric ? "num" : undefined}>
                  {c.header ? c.header : <span className={styles.srOnly}>Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {message !== null ? (
              <tr>
                <td colSpan={columns.length} className={styles.emptyRow}>{message}</td>
              </tr>
            ) : (
              items.map((row) => (
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
              ))
            )}
          </tbody>
        </table>
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
