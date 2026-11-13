"use client";

import { useEffect, useState } from "react";
import type { AccessLike } from "@/lib/access-state";
import type { BookDTO } from "@/lib/market";
import type { Page, PositionDto } from "@/components/dashboard/types";

type Loaded<T> = { data: T | null; error: string | null };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    throw new Error(code ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const failure = (signal: AbortSignal, err: unknown): string | null =>
  signal.aborted ? null : err instanceof Error ? err.message : "Request failed";

/** Access status (country, close-only flag, configured). Loaded once. */
export function useAccess(): Loaded<AccessLike> {
  const [state, setState] = useState<Loaded<AccessLike>>({ data: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    getJson<AccessLike>("/api/access", controller.signal)
      .then((data) => setState({ data, error: null }))
      .catch((err: unknown) => {
        const error = failure(controller.signal, err);
        if (error) setState({ data: null, error });
      });
    return () => controller.abort();
  }, []);
  return state;
}

/** Order book for the selected outcome; reloaded when `refreshToken` changes. */
export function useBook(assetId: string, refreshToken: number): Loaded<BookDTO> {
  const [state, setState] = useState<Loaded<BookDTO>>({ data: null, error: null });
  useEffect(() => {
    // No market selected yet: nothing to load (an empty id would just be a 400).
    if (!assetId) return;
    const controller = new AbortController();
    getJson<BookDTO>(`/api/book?assetId=${encodeURIComponent(assetId)}`, controller.signal)
      .then((data) => setState({ data, error: null }))
      .catch((err: unknown) => {
        const error = failure(controller.signal, err);
        if (error) setState((s) => ({ ...s, error }));
      });
    return () => controller.abort();
  }, [assetId, refreshToken]);
  return state;
}

const MAX_POSITION_PAGES = 10;

/** Shares held of `assetId` from /api/positions (pages followed). Null until known. */
export function useHeld(assetId: string, enabled: boolean, refreshToken: number): Loaded<string> {
  const [state, setState] = useState<Loaded<string>>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      let cursor: string | null = null;
      for (let i = 0; i < MAX_POSITION_PAGES; i++) {
        const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const page: Page<PositionDto> = await getJson(`/api/positions?status=OPEN${suffix}`, controller.signal);
        const hit = page.items.find((p) => p.assetId === assetId);
        if (hit) return hit.size;
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return "0";
    })()
      .then((data) => setState({ data, error: null }))
      .catch((err: unknown) => {
        const error = failure(controller.signal, err);
        if (error) setState((s) => ({ ...s, error }));
      });
    return () => controller.abort();
  }, [assetId, enabled, refreshToken]);
  return state;
}
