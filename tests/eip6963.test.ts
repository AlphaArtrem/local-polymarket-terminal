import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverProviders, mergeProvider, safeIcon, type Eip1193Provider, type ProviderDetail } from "@/lib/eip6963";

const provider: Eip1193Provider = { request: async () => null };
const detail = (uuid: string, name = uuid): ProviderDetail => ({ info: { uuid, name, icon: "", rdns: `io.${uuid}` }, provider });

function announce(target: EventTarget, d: ProviderDetail) {
  target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: d }));
}

describe("mergeProvider", () => {
  it("dedupes by uuid and keeps the latest announcement", () => {
    const list = mergeProvider(mergeProvider([], detail("a", "first")), detail("a", "second"));
    expect(list).toHaveLength(1);
    expect(list[0].info.name).toBe("second");
    expect(mergeProvider(list, detail("b"))).toHaveLength(2);
  });
});

describe("safeIcon", () => {
  it("accepts base64 image data URIs only", () => {
    expect(safeIcon("data:image/png;base64,iVBORw0KGgo=")).not.toBeNull();
    expect(safeIcon("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).not.toBeNull();
    expect(safeIcon("javascript:alert(1)")).toBeNull();
    expect(safeIcon("http://evil.example/x.png")).toBeNull();
    expect(safeIcon("data:image/svg+xml;utf8,<svg onload=alert(1)>")).toBeNull();
    expect(safeIcon("data:text/html;base64,PGI+")).toBeNull();
  });
});

describe("discoverProviders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks wallets to announce and lists them without duplicates", () => {
    const target = new EventTarget();
    const requested = vi.fn();
    target.addEventListener("eip6963:requestProvider", requested);
    const onChange = vi.fn();
    const stop = discoverProviders(target, onChange, () => provider);
    expect(requested).toHaveBeenCalledOnce();
    announce(target, detail("a"));
    announce(target, detail("a"));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ info: expect.objectContaining({ uuid: "a" }) })]);
    vi.advanceTimersByTime(500);
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(1); // no fallback after an announcement
    stop();
  });

  it("ignores malformed announcements", () => {
    const target = new EventTarget();
    const onChange = vi.fn();
    discoverProviders(target, onChange, () => undefined);
    target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: 1 }, provider: {} } }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the injected provider only when nothing announced", () => {
    const target = new EventTarget();
    const onChange = vi.fn();
    discoverProviders(target, onChange, () => provider);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0][0].info.rdns).toBe("injected");
  });
});
