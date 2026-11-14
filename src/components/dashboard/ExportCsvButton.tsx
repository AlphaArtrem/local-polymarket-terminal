"use client";

import { useState } from "react";
import { EXPORT_MAX_PAGES, EXPORTS, exportFilename, fetchAllPages, rowsToCsv, type ExportKind } from "@/lib/export";
import styles from "./dashboard.module.css";
import type { ApiErrorBody, Page } from "./types";

async function fetchJson(url: string): Promise<Page<unknown>> {
  const res = await fetch(url, { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) throw new Error("Rate limited, retry shortly");
    throw new Error((body as ApiErrorBody | null)?.error?.message ?? `Export failed (HTTP ${res.status})`);
  }
  return body as Page<unknown>;
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Exports every page of the current Portfolio tab (capped) as a CSV download. */
export function ExportCsvButton({ kind }: { kind: ExportKind }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setStatus({ text: "Exporting… (0 rows)", error: false });
    try {
      const { rows, truncated } = await fetchAllPages(EXPORTS[kind].endpoint, fetchJson, EXPORT_MAX_PAGES, (n) =>
        setStatus({ text: `Exporting… (${n} ${n === 1 ? "row" : "rows"})`, error: false }),
      );
      download(rowsToCsv(kind, rows), exportFilename(kind, new Date()));
      setStatus(
        truncated
          ? { text: `Exported the first ${(EXPORT_MAX_PAGES * 50).toLocaleString("en-US")} rows`, error: false }
          : { text: `Exported ${rows.length} ${rows.length === 1 ? "row" : "rows"}`, error: false },
      );
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "Export failed", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status && (
        <span className={status.error ? styles.exportError : styles.status} role="status">
          {status.text}
        </span>
      )}
      <button type="button" className="chip" disabled={busy} onClick={() => void run()}>
        <svg className={styles.chipIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        Export CSV
      </button>
    </>
  );
}
