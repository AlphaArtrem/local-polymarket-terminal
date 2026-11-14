"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { discoverProviders, type ProviderDetail } from "@/lib/eip6963";
import { makeController, walletFetch, type WalletController } from "@/lib/wallet-client";
import type { AccountInfo, AccountMode, PendingSign } from "@/lib/wallet-protocol";
import { WalletPrompt } from "./WalletPrompt";
import { WalletContext, type WalletState } from "./useWallet";
import styles from "./wallet.module.css";

const STORAGE_KEY = "pmterm.wallet.v1";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const POLYGON_HEX = "0x89";

/** Only the wallet's rdns is remembered (never an address or session data). */
function readRdns(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const rdns = (parsed as { rdns?: unknown } | null)?.rdns;
    return typeof rdns === "string" ? rdns : null;
  } catch (err) {
    console.warn("wallet preference unreadable", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

function writeRdns(rdns: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ rdns }));
  } catch (err) {
    console.warn("wallet preference not saved", err instanceof Error ? err.name : "unknown");
  }
}

function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === 4001) return "Request rejected in the wallet.";
  return err instanceof Error ? err.message.slice(0, 200) : "Wallet request failed";
}

function firstAddress(accounts: unknown): `0x${string}` | null {
  const a = Array.isArray(accounts) ? accounts[0] : null;
  return typeof a === "string" && ADDRESS_RE.test(a) ? (a as `0x${string}`) : null;
}

export function WalletProvider({ mode, children }: { mode: AccountMode; children: ReactNode }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [chainWarning, setChainWarning] = useState(false);
  /** Address shared during connect, shown in the signing dialog's step list. */
  const [connectAccount, setConnectAccount] = useState<string | null>(null);
  const [pending, setPending] = useState<{ sign: PendingSign; cancel: () => void } | null>(null);
  // Counts wallet requests within one signing fetch so multi-transaction flows can show progress.
  const [requestCount, setRequestCount] = useState(0);

  const controllerRef = useRef<WalletController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<() => Promise<void>>(async () => undefined);

  const refreshInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/session", { cache: "no-store" });
      setInfo(res.ok ? ((await res.json()) as AccountInfo) : null);
    } catch (err) {
      console.error("wallet session check failed", err instanceof Error ? err.name : "unknown");
      setInfo(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wallet/session", { cache: "no-store", signal: controller.signal })
      .then(async (res) => setInfo(res.ok ? ((await res.json()) as AccountInfo) : null))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("wallet session check failed", err instanceof Error ? err.name : "unknown");
        setInfo(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== "wallet") return;
    return discoverProviders(window, setProviders);
  }, [mode]);

  const detach = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    controllerRef.current = null;
    setWalletName(null);
    setChainWarning(false);
  }, []);

  /** Binds this tab to an extension account and watches it: an account switch ends the session. */
  const attach = useCallback(
    (detail: ProviderDetail, address: `0x${string}`) => {
      detach();
      const controller = makeController(detail.provider, address);
      controllerRef.current = controller;
      setWalletName(detail.info.name);
      const onAccounts = (accounts: unknown) => {
        const next = firstAddress(accounts);
        if (next?.toLowerCase() !== address.toLowerCase()) void disconnectRef.current();
      };
      const onChain = (chainId: unknown) => setChainWarning(typeof chainId === "string" && chainId.toLowerCase() !== POLYGON_HEX);
      detail.provider.on?.("accountsChanged", onAccounts);
      detail.provider.on?.("chainChanged", onChain);
      unsubscribeRef.current = () => {
        detail.provider.removeListener?.("accountsChanged", onAccounts);
        detail.provider.removeListener?.("chainChanged", onChain);
      };
    },
    [detach],
  );

  // After a reload the server session may still be live: re-bind the remembered extension without prompting.
  const signer = info?.connected ? info.signer : null;
  useEffect(() => {
    if (mode !== "wallet" || !signer || controllerRef.current || providers.length === 0) return;
    const rdns = readRdns();
    const detail = providers.find((p) => p.info.rdns === rdns) ?? (providers.length === 1 ? providers[0] : undefined);
    if (!detail) return;
    let cancelled = false;
    detail.provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const list = Array.isArray(accounts) ? accounts : [];
        const match = list.find((a) => typeof a === "string" && a.toLowerCase() === signer.toLowerCase());
        if (!cancelled && typeof match === "string" && !controllerRef.current) attach(detail, match as `0x${string}`);
      })
      .catch((err: unknown) => console.warn("wallet account check failed", err instanceof Error ? err.name : "unknown"));
    return () => {
      cancelled = true;
    };
  }, [mode, signer, providers, attach]);

  const markDisconnected = useCallback(() => {
    detach();
    setInfo(null);
    setVersion((n) => n + 1);
  }, [detach]);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/wallet/session", { method: "DELETE" });
    } catch (err) {
      console.error("wallet disconnect failed", err instanceof Error ? err.name : "unknown");
    }
    markDisconnected();
  }, [markDisconnected]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const signingFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      setRequestCount(0);
      const res = await walletFetch(url, init, {
        controller: controllerRef.current,
        onPending: (p, cancel) => {
          if (p) setRequestCount((n) => n + 1);
          setPending(p ? { sign: p, cancel } : null);
        },
      });
      if (mode === "wallet" && res.status === 401) {
        const body: unknown = await res.clone().json().catch(() => null);
        if ((body as { error?: { code?: string } } | null)?.error?.code === "WALLET_NOT_CONNECTED") markDisconnected();
      }
      return res;
    },
    [mode, markDisconnected],
  );

  const connect = useCallback(
    async (detail: ProviderDetail, accountWallet?: string) => {
      if (mode !== "wallet") return;
      setBusy(true);
      setError(null);
      try {
        const address = firstAddress(await detail.provider.request({ method: "eth_requestAccounts" }));
        if (!address) throw new Error("The wallet returned no account.");
        attach(detail, address);
        setConnectAccount(address);
        const wallet = accountWallet?.trim();
        const res = await signingFetch("/api/wallet/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(wallet ? { address, wallet } : { address }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        writeRdns(detail.info.rdns);
        await refreshInfo();
        setVersion((n) => n + 1);
        setConnectOpen(false);
      } catch (err) {
        detach();
        setError(describeError(err));
      } finally {
        setBusy(false);
        setConnectAccount(null);
      }
    },
    [mode, attach, detach, signingFetch, refreshInfo],
  );

  const openConnect = useCallback(() => setConnectOpen(true), []);
  const closeConnect = useCallback(() => {
    setConnectOpen(false);
    setError(null);
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      mode,
      info,
      ready,
      connected: mode === "key" ? true : info?.connected === true,
      providers,
      walletName,
      busy,
      error,
      version,
      connectOpen,
      openConnect,
      closeConnect,
      connect,
      disconnect,
      pendingSummary: pending?.sign.summary ?? null,
      requestCount,
      fetch: signingFetch,
    }),
    [mode, info, ready, providers, walletName, busy, error, version, connectOpen, openConnect, closeConnect, connect, disconnect, signingFetch, pending, requestCount],
  );

  return (
    <WalletContext.Provider value={value}>
      {chainWarning ? (
        <div className={styles.banner} role="alert">
          <span>Your wallet is not on Polygon. Signing will ask to switch networks.</span>
          <button type="button" className="btn btn-amber" onClick={() => void controllerRef.current?.ensurePolygon().catch(() => setChainWarning(true))}>
            Switch to Polygon
          </button>
        </div>
      ) : null}
      {children}
      {pending ? (
        <WalletPrompt
          walletName={walletName ?? "your wallet"}
          icon={providers.find((p) => p.info.name === walletName)?.info.icon}
          pending={pending.sign}
          onCancel={pending.cancel}
          connecting={busy}
          account={connectAccount}
        />
      ) : null}
    </WalletContext.Provider>
  );
}
