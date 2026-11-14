"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { BookDTO } from "@/lib/market";
import {
  backoffMs,
  INITIAL_LIVE_STATE,
  liveReducer,
  POLL_MS,
  type LiveAction,
  type LiveState,
} from "@/lib/book-state";
import type { TradePrint } from "@/lib/live-types";

export type { LiveState };

/**
 * One store per asset, shared by every component that calls `useLiveBook(assetId)` (OrderBook and
 * TradeTape), so there is a single EventSource per asset. Ref-counted: the connection opens on the
 * first subscriber and everything is torn down when the last one unmounts.
 */
type Store = {
  state: LiveState;
  listeners: Set<() => void>;
  disconnect: () => void;
  /** Pending teardown after the last listener left; cancelled if a listener returns in time. */
  idleTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Grace period before closing an asset's connection once nobody listens. React may unsubscribe and
 * resubscribe around re-renders and Strict Mode double-mounts; tearing down immediately restarted
 * the stream on every render and the book never left "Loading" (found in browser acceptance).
 */
const IDLE_CLOSE_MS = 2000;
const stores = new Map<string, Store>();

function createConnection(assetId: string, store: Store): () => void {
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollAbort: AbortController | null = null;
  let attempt = 0;
  let stopped = false;

  const dispatch = (action: LiveAction) => {
    const next = liveReducer(store.state, action);
    if (next === store.state) return;
    store.state = next;
    store.listeners.forEach((l) => l());
  };

  async function poll() {
    pollAbort?.abort();
    const controller = (pollAbort = new AbortController());
    try {
      const res = await fetch(`/api/book?assetId=${encodeURIComponent(assetId)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body: unknown = await res.json();
      if (stopped || controller.signal.aborted) return;
      if (!res.ok) {
        const message = (body as { error?: { message?: string } }).error?.message;
        dispatch({ type: "pollError", error: message ?? `Request failed (${res.status})` });
        return;
      }
      dispatch({ type: "polled", book: body as BookDTO });
    } catch (err) {
      if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
      dispatch({ type: "pollError", error: "Could not reach the order book" });
    }
  }

  function startPolling() {
    if (pollTimer) return;
    void poll();
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    pollAbort?.abort();
  }

  function fail(message: string | null) {
    es?.close();
    es = null;
    dispatch({ type: "fallback", error: message });
    startPolling();
    if (retryTimer || stopped) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, backoffMs(attempt++));
  }

  function connect() {
    if (stopped) return;
    const source = (es = new EventSource(`/api/stream?assetId=${encodeURIComponent(assetId)}`));
    source.addEventListener("book", (e) => {
      attempt = 0;
      stopPolling();
      dispatch({ type: "book", book: JSON.parse((e as MessageEvent<string>).data) as BookDTO });
    });
    source.addEventListener("trade", (e) => {
      dispatch({ type: "trade", trade: JSON.parse((e as MessageEvent<string>).data) as TradePrint });
    });
    // Both a server `event: error` (has data) and a transport failure (no data) land here.
    source.addEventListener("error", (e) => {
      if (es !== source) return;
      const data = (e as MessageEvent<string | undefined>).data;
      let message: string | null = null;
      if (typeof data === "string") {
        try {
          message = (JSON.parse(data) as { message?: string }).message ?? null;
        } catch {
          message = null; // Not JSON: treat as a plain transport error.
        }
      }
      fail(message);
    });
  }

  const onVisible = () => {
    if (pollTimer && document.visibilityState === "visible") void poll();
  };
  document.addEventListener("visibilitychange", onVisible);
  connect();

  return () => {
    stopped = true;
    es?.close();
    es = null;
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function subscribe(assetId: string, listener: () => void): () => void {
  let store = stores.get(assetId);
  if (!store) {
    store = { state: INITIAL_LIVE_STATE, listeners: new Set(), disconnect: () => undefined, idleTimer: null };
    stores.set(assetId, store);
    store.disconnect = createConnection(assetId, store);
  }
  const owned = store;
  if (owned.idleTimer) clearTimeout(owned.idleTimer);
  owned.idleTimer = null;
  owned.listeners.add(listener);
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size > 0 || owned.idleTimer) return;
    owned.idleTimer = setTimeout(() => {
      owned.idleTimer = null;
      if (owned.listeners.size > 0) return;
      if (stores.get(assetId) === owned) stores.delete(assetId);
      owned.disconnect();
    }, IDLE_CLOSE_MS);
  };
}

export function useLiveBook(assetId: string): LiveState {
  // Stable per asset: an inline function would make React resubscribe on every render.
  const sub = useCallback((listener: () => void) => subscribe(assetId, listener), [assetId]);
  const get = useCallback(() => stores.get(assetId)?.state ?? INITIAL_LIVE_STATE, [assetId]);
  return useSyncExternalStore(sub, get, () => INITIAL_LIVE_STATE);
}
