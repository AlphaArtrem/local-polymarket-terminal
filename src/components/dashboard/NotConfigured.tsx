import styles from "./dashboard.module.css";

/** Server-rendered only (imported by the page, never by client components). */
export function NotConfigured() {
  return (
    <div className={styles.notice} data-testid="not-configured">
      <strong>Wallet not configured</strong>
      <p>
        Create <code>.env.local</code> in the project root and set <code>POLYMARKET_PRIVATE_KEY</code> (the
        signer key) and <code>POLYMARKET_WALLET_ADDRESS</code> (the wallet address shown in your polymarket.com
        profile menu), then restart the dev server.
      </p>
      <p className="muted">The key is read only by the local server and never sent to the browser.</p>
    </div>
  );
}
