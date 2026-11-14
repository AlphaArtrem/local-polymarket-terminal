/** EIP-6963 wallet discovery. Pure DOM-event code: no viem, no server imports. */

export type Eip1193Provider = {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

export type ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

export const FALLBACK_DELAY_MS = 300;
const MAX_ICON_LENGTH = 200_000;
const ICON_RE = /^data:image\/(?:png|svg\+xml|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Adds `d`, replacing any entry with the same uuid (a wallet may re-announce). */
export function mergeProvider(list: ProviderDetail[], d: ProviderDetail): ProviderDetail[] {
  return [...list.filter((p) => p.info.uuid !== d.info.uuid), d];
}

/** Wallet-supplied icons are untrusted: only inline base64 raster/svg data URIs may reach an <img src>. */
export function safeIcon(icon: string): string | null {
  return typeof icon === "string" && icon.length <= MAX_ICON_LENGTH && ICON_RE.test(icon) ? icon : null;
}

function asDetail(value: unknown): ProviderDetail | null {
  if (typeof value !== "object" || value === null) return null;
  const { info, provider } = value as { info?: Record<string, unknown>; provider?: { request?: unknown } };
  if (!info || typeof provider?.request !== "function") return null;
  const { uuid, name, icon, rdns } = info;
  if (typeof uuid !== "string" || typeof name !== "string" || typeof rdns !== "string") return null;
  return { info: { uuid, name: name.slice(0, 60), icon: typeof icon === "string" ? icon : "", rdns }, provider: provider as Eip1193Provider };
}

function windowEthereum(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return eth && typeof eth.request === "function" ? eth : undefined;
}

/**
 * Listens for announcements and asks wallets to announce. If nothing announced within 300 ms, falls back
 * to `window.ethereum` (rdns "injected"). Returns the unsubscribe function.
 */
export function discoverProviders(
  target: EventTarget,
  onChange: (list: ProviderDetail[]) => void,
  getInjected: () => Eip1193Provider | undefined = windowEthereum,
): () => void {
  let list: ProviderDetail[] = [];
  const onAnnounce = (e: Event) => {
    const detail = asDetail((e as CustomEvent).detail);
    if (!detail) return;
    list = mergeProvider(list, detail);
    onChange(list);
  };
  target.addEventListener("eip6963:announceProvider", onAnnounce);
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  const timer = setTimeout(() => {
    if (list.length > 0) return;
    const injected = getInjected();
    if (!injected) return;
    list = [{ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: injected }];
    onChange(list);
  }, FALLBACK_DELAY_MS);
  return () => {
    clearTimeout(timer);
    target.removeEventListener("eip6963:announceProvider", onAnnounce);
  };
}
