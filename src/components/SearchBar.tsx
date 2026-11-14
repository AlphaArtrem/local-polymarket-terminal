"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LookupResult } from "@/lib/market";
import { routeSearchInput, searchHref } from "./browse/helpers";
import styles from "./market/market.module.css";

/** Header search: URLs/ids/slugs resolve via /api/lookup; free text goes to Browse search (see routeSearchInput). */
export function SearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = value.trim();
    if (!text) return;
    const route = routeSearchInput(text);
    if (route.action === "search") {
      setError(null);
      router.push(searchHref(route.q));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(text)}`, { cache: "no-store" });
      const body: unknown = await res.json();
      if (!res.ok) {
        const code = (body as { error?: { code?: string } }).error?.code;
        if (route.fallbackQ && (res.status === 404 || code === "NOT_FOUND")) {
          router.push(searchHref(route.fallbackQ));
          return;
        }
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
        placeholder="Search markets or paste a Polymarket URL"
        aria-label="Search markets"
        disabled={busy}
      />
      {error ? <span className={styles.searchError} role="alert">{error}</span> : null}
    </form>
  );
}
