"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LookupResult } from "@/lib/market";
import styles from "./market/market.module.css";

/** Header search: resolves any Polymarket URL/slug/id via /api/lookup, then opens the event page. */
export function SearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(value)}`, { cache: "no-store" });
      const body: unknown = await res.json();
      if (!res.ok) {
        setError((body as { error?: { message?: string } }).error?.message ?? `Lookup failed (${res.status})`);
        return;
      }
      const { event, matched } = body as LookupResult;
      const asset = matched?.assetId ? `?asset=${encodeURIComponent(matched.assetId)}` : "";
      router.push(`/market/${encodeURIComponent(event.slug)}${asset}`);
    } catch {
      setError("Could not reach the lookup service");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.searchForm} onSubmit={onSubmit} role="search">
      <input
        className={styles.searchInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste a Polymarket URL, slug, id or condition id"
        aria-label="Search markets"
        disabled={busy}
      />
      {error ? <span className={styles.searchError} role="alert">{error}</span> : null}
    </form>
  );
}
