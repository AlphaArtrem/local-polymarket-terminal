import "server-only";
import {
  applyPriceChanges,
  applyTickSize,
  fromSnapshot,
  toBookDTO,
  type BookState,
} from "@/lib/book-state";
import type { TradePrint } from "@/lib/live-types";
import { classifyError } from "./markets";
import { getPublicClient } from "./polymarket";

export const BOOK_THROTTLE_MS = 250; // <= 4 book messages per second
export const PING_MS = 15_000;

/** The slice of an SDK market event this stream reads. */
export type MarketEvent = { topic?: string; type: string; payload: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type MarketSubscription = AsyncIterable<MarketEvent> & { close(): unknown };
export type Subscribe = (assetId: string) => Promise<MarketSubscription>;

const defaultSubscribe: Subscribe = async (assetId) =>
  (await getPublicClient().subscribe([{ topic: "market", assetIds: [assetId] }])) as unknown as MarketSubscription;

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * SSE byte stream of one asset's live book and trades. Closes the SDK subscription and clears
 * every timer when `signal` aborts, the consumer cancels, or the SDK fails.
 */
export function openMarketStream(
  assetId: string,
  signal: AbortSignal,
  subscribe: Subscribe = defaultSubscribe,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let teardown: (closeController: boolean) => void = () => undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let sub: MarketSubscription | null = null;
      let state: BookState | null = null;
      let dirty = false;
      let lastBookAt = 0;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(encodeSse(event, data)));
      };
      const closeSub = () => {
        if (!sub) return;
        const s = sub;
        sub = null;
        Promise.resolve()
          .then(() => s.close())
          .catch((err: unknown) => console.error("[stream] close failed:", err instanceof Error ? err.name : "unknown"));
      };
      const pingTimer = setInterval(() => send("ping", {}), PING_MS);

      const finish = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        signal.removeEventListener("abort", onAbort);
        closeSub();
        if (closeController) controller.close();
      };
      const onAbort = () => finish(true);
      teardown = finish;

      const flushBook = () => {
        flushTimer = null;
        if (closed || !dirty || !state) return;
        dirty = false;
        lastBookAt = Date.now();
        send("book", toBookDTO(state));
      };
      // Always sends the latest state; at most one message per BOOK_THROTTLE_MS.
      const scheduleBook = () => {
        dirty = true;
        if (flushTimer) return;
        const wait = lastBookAt + BOOK_THROTTLE_MS - Date.now();
        if (wait <= 0) flushBook();
        else flushTimer = setTimeout(flushBook, wait);
      };

      const handle = (event: MarketEvent) => {
        const p = event.payload;
        switch (event.type) {
          case "book":
            if (String(p.assetId) !== assetId) return;
            state = fromSnapshot(p as Parameters<typeof fromSnapshot>[0]);
            scheduleBook();
            return;
          case "price_change":
            if (!state) return;
            state = applyPriceChanges(state, p.priceChanges ?? [], assetId);
            scheduleBook();
            return;
          case "tick_size_change":
            if (!state || String(p.assetId) !== assetId) return;
            state = applyTickSize(state, String(p.newTickSize));
            scheduleBook();
            return;
          case "last_trade_price": {
            if (String(p.assetId) !== assetId) return;
            const side = String(p.side).toUpperCase();
            if (side !== "BUY" && side !== "SELL") return;
            const trade: TradePrint = {
              price: String(p.price),
              size: p.size == null ? null : String(p.size),
              side,
              t: typeof p.timestamp === "number" ? p.timestamp : Date.now(),
            };
            send("trade", trade);
            return;
          }
        }
      };

      const run = async () => {
        try {
          const opened = await subscribe(assetId);
          if (closed) {
            sub = opened;
            closeSub();
            return;
          }
          sub = opened;
          for await (const event of opened) {
            if (closed) break;
            handle(event);
          }
          finish(true);
        } catch (err) {
          if (closed) return;
          const { code, message } = classifyError(err);
          send("error", { code, message });
          finish(true);
        }
      };

      if (signal.aborted) finish(true);
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        void run();
      }
    },
    cancel() {
      teardown(false);
    },
  });
}
