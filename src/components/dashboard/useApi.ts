"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorBody, Page } from "./types";

export type ApiFailure = { code: string; message: string };

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw { code: err?.code ?? "HTTP_ERROR", message: err?.message ?? `HTTP ${res.status}` } satisfies ApiFailure;
  }
  return body as T;
}

function toFailure(err: unknown): ApiFailure {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) return err as ApiFailure;
  return { code: "NETWORK", message: "Request failed" };
}

type State<T> = { data: T | null; error: ApiFailure | null; loading: boolean };

/**
 * Fetches `url`; refetches when `url` or `refreshToken` changes. `loading` is true only until the first
 * response (callers remount per endpoint), so refreshes keep showing old data instead of flashing.
 */
export function useApi<T>(url: string, refreshToken: number): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    request<T>(url, controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error: toFailure(err), loading: false }));
      });
    return () => controller.abort();
  }, [url, refreshToken]);
  return state;
}

/** Cursor-paginated list: first page reloads on refresh, `loadMore` appends. */
export function usePagedApi<T>(baseUrl: string, refreshToken: number) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const urlFor = useCallback(
    (cursor?: string) => {
      if (!cursor) return baseUrl;
      return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
    },
    [baseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    request<Page<T>>(urlFor(), controller.signal)
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(toFailure(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [urlFor, refreshToken]);

  const loadMore = useCallback(() => {
    const controller = controllerRef.current;
    if (!nextCursor || !controller) return;
    setLoadingMore(true);
    request<Page<T>>(urlFor(nextCursor), controller.signal)
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setNextCursor(page.nextCursor);
        setError(null);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(toFailure(err));
        setLoadingMore(false);
      });
  }, [nextCursor, urlFor]);

  return { items, error, loading, loadingMore, hasMore: nextCursor !== null, loadMore };
}
