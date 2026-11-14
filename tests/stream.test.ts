import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscribeMock = vi.fn();
vi.mock("@/server/polymarket", () => ({ getPublicClient: () => ({ subscribe: subscribeMock }) }));

const { openMarketStream, encodeSse, BOOK_THROTTLE_MS, PING_MS } = await import("@/server/stream");
const { GET } = await import("@/app/api/stream/route");

type Ev = { topic: string; type: string; payload: Record<string, unknown> };

/** Fake SDK subscription: push() events, fail() or end() the iteration. */
function fakeSub() {
  const queue: Ev[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let failure: unknown = null;
  const close = vi.fn(() => {
    done = true;
    wake?.();
  });
  const poke = () => {
    wake?.();
    wake = null;
  };
  return {
    close,
    push: (e: Ev) => (queue.push(e), poke()),
    fail: (err: unknown) => ((failure = err), poke()),
    [Symbol.asyncIterator]: async function* () {
      for (;;) {
        if (failure) throw failure;
        const e = queue.shift();
        if (e) yield e;
        else if (done) return;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

const book = (bids: [string, string][], asks: [string, string][]): Ev => ({
  topic: "market",
  type: "book",
  payload: {
    assetId: "1",
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    tickSize: "0.01",
  },
});
const change = (price: string, size: string, side = "BUY"): Ev => ({
  topic: "market",
  type: "price_change",
  payload: { priceChanges: [{ assetId: "1", price, size, side }] },
});

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  return {
    next: async () => {
      const r = await reader.read();
      return r.done ? null : dec.decode(r.value);
    },
    reader,
  };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  subscribeMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("stream", () => {
  it("encodes SSE messages", () => {
    expect(encodeSse("ping", {})).toBe("event: ping\ndata: {}\n\n");
  });

  it("sends the snapshot, throttles updates to the latest state, and forwards trades", async () => {
    const sub = fakeSub();
    const ac = new AbortController();
    const r = await readAll(openMarketStream("1", ac.signal, async () => sub as never));
    sub.push(book([["0.4", "1"]], [["0.6", "1"]]));
    const first = await r.next();
    expect(first).toContain("event: book");
    expect(first).toContain('"midpoint":"0.5"');

    // Three updates inside the throttle window collapse into one message with the final state.
    sub.push(change("0.41", "2"));
    sub.push(change("0.42", "3"));
    sub.push(change("0.43", "4"));
    await tick();
    sub.push({ topic: "market", type: "last_trade_price", payload: { assetId: "1", price: "0.5", side: "SELL", size: "2", timestamp: 5 } });
    const trade = await r.next();
    expect(trade).toBe('event: trade\ndata: {"price":"0.5","size":"2","side":"SELL","t":5}\n\n');
    await vi.advanceTimersByTimeAsync(BOOK_THROTTLE_MS);
    const second = await r.next();
    expect(second).toContain('"price":"0.43","size":"4"');
    ac.abort();
  });

  it("pings every 15s", async () => {
    const sub = fakeSub();
    const ac = new AbortController();
    const r = await readAll(openMarketStream("1", ac.signal, async () => sub as never));
    await vi.advanceTimersByTimeAsync(PING_MS);
    expect(await r.next()).toBe("event: ping\ndata: {}\n\n");
    ac.abort();
  });

  it("abort closes the subscription, clears timers and ends the stream", async () => {
    const sub = fakeSub();
    const ac = new AbortController();
    const r = await readAll(openMarketStream("1", ac.signal, async () => sub as never));
    sub.push(book([["0.4", "1"]], [["0.6", "1"]]));
    await r.next();
    sub.push(change("0.41", "2")); // arms the throttle timer
    await tick();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    ac.abort();
    await tick();
    expect(sub.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(await r.next()).toBeNull();
  });

  it("consumer cancel also closes the subscription and timers", async () => {
    const sub = fakeSub();
    const r = await readAll(openMarketStream("1", new AbortController().signal, async () => sub as never));
    await tick();
    await r.reader.cancel();
    await tick();
    expect(sub.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an SDK error sends event: error then closes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sub = fakeSub();
    const r = await readAll(openMarketStream("1", new AbortController().signal, async () => sub as never));
    await tick();
    sub.fail(new Error("socket down"));
    const msg = await r.next();
    expect(msg).toContain("event: error");
    expect(msg).toContain('"code":"UPSTREAM_ERROR"');
    expect(await r.next()).toBeNull();
    expect(sub.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a subscribe failure sends event: error then closes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await readAll(
      openMarketStream("1", new AbortController().signal, async () => {
        throw new Error("nope");
      }),
    );
    expect(await r.next()).toContain("event: error");
    expect(await r.next()).toBeNull();
  });

  it("route rejects a bad assetId with 400 and never subscribes", async () => {
    for (const q of ["", "?assetId=abc", "?assetId=1;2"]) {
      const res = await GET(new Request(`http://127.0.0.1:3737/api/stream${q}`));
      expect(res.status).toBe(400);
    }
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("route streams with SSE headers", async () => {
    const sub = fakeSub();
    subscribeMock.mockResolvedValue(sub);
    const ac = new AbortController();
    const res = await GET(new Request("http://127.0.0.1:3737/api/stream?assetId=1", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(subscribeMock).toHaveBeenCalledWith([{ topic: "market", assetIds: ["1"] }]);
    ac.abort();
    await tick();
    expect(sub.close).toHaveBeenCalled();
  });
});
