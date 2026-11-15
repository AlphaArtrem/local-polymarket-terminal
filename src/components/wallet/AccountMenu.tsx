"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountInfo } from "@/lib/wallet-protocol";
import { DepositDialog } from "../deposit/DepositDialog";
import { WithdrawDialog } from "../withdraw/WithdrawDialog";
import { shortAddr } from "./addr";
import { useWallet } from "./useWallet";
import { WalletBadge } from "./WalletBadge";
import styles from "../header.module.css";

const TYPE_LABEL: Record<string, string> = {
  EOA: "EOA · trades from this address",
  POLY_PROXY: "Proxy wallet",
  GNOSIS_SAFE: "Safe wallet",
  DEPOSIT_WALLET: "Deposit wallet",
};
const SOURCE_LABEL: Record<string, string> = {
  env: "Configured account wallet",
  profile: "Polymarket profile",
  "eoa-default": "No Polymarket profile (default)",
  user: "Wallet you entered",
};

/**
 * Header account button and its menu: Deposit and Withdraw, then signer, account wallet, type, source;
 * POL balance and Disconnect in wallet mode. The dialogs live outside the menu so closing the menu does
 * not unmount them.
 */
export function AccountMenu({ fallbackAddress }: { fallbackAddress?: string | null }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [dialog, setDialog] = useState<"deposit" | "withdraw" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const info: AccountInfo | null = w.info;
  const wallet = info?.wallet ?? fallbackAddress ?? null;
  if (!wallet) return null;
  const walletMode = w.mode === "wallet";
  const provider = w.providers.find((p) => p.info.name === w.walletName);
  const name = w.walletName ?? "Browser wallet";

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet as string);
      setCopied("ok");
    } catch (err) {
      console.error("copy failed", err instanceof Error ? err.name : "unknown");
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className={styles.accountWrap} ref={rootRef} data-slot="account">
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${styles.accountBtn}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
        title={wallet}
        onClick={() => setOpen((v) => !v)}
      >
        {walletMode ? <WalletBadge name={name} icon={provider?.info.icon} size={20} /> : <span className={styles.dot} aria-hidden="true" />}
        <span className="num">{shortAddr(wallet)}</span>
        {walletMode && info?.walletType === "EOA" ? <span className={styles.typeChip}>EOA</span> : null}
        <svg className={styles.chev} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <section className={styles.menu} aria-label="Account">
          <div className={styles.menuHead}>
            {walletMode ? <WalletBadge name={name} icon={provider?.info.icon} size={32} /> : <span className={styles.dot} aria-hidden="true" />}
            <div>
              <div className={styles.menuTitle}>{walletMode ? name : "Server key"}</div>
              <div className={styles.menuSub}>{walletMode ? "Connected · Polygon" : "Signs on this machine"}</div>
            </div>
          </div>
          <dl className={styles.facts}>
            <dt>Signer</dt>
            <dd className="num" title={info?.signer ?? undefined}>{shortAddr(info?.signer)}</dd>
            <dt>Account wallet</dt>
            <dd className="num" title={wallet}>{shortAddr(wallet)}</dd>
            {info?.walletType ? (<><dt>Account type</dt><dd>{TYPE_LABEL[info.walletType] ?? info.walletType}</dd></>) : null}
            {info?.source ? (<><dt>Found via</dt><dd>{SOURCE_LABEL[info.source] ?? info.source}</dd></>) : null}
            {walletMode && info?.polBalance ? (<><dt>Gas balance</dt><dd className="num">{info.polBalance} POL</dd></>) : null}
          </dl>
          {walletMode && info?.source === "eoa-default" ? (
            <p className={styles.menuNote}>
              This address has never used Polymarket, so it is a new account of its own. To use your polymarket.com account, disconnect and enter its wallet under Account wallet (advanced).
            </p>
          ) : null}
          <div className={styles.menuActions}>
            <button type="button" className="btn btn-primary" onClick={() => { setOpen(false); setDialog("deposit"); }}>Deposit</button>
            <button type="button" className="btn" onClick={() => { setOpen(false); setDialog("withdraw"); }}>Withdraw</button>
          </div>
          <div className={styles.menuActions}>
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy address"}
            </button>
            {walletMode ? (
              <button type="button" className="btn btn-danger" onClick={() => { setOpen(false); void w.disconnect(); }}>Disconnect</button>
            ) : null}
          </div>
        </section>
      ) : null}
      {dialog === "deposit" ? <DepositDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "withdraw" ? <WithdrawDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
