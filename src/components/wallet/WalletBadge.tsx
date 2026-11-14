import { safeIcon } from "@/lib/eip6963";
import styles from "./wallet.module.css";

const TILES: Record<string, { initials: string; bg: string; fg: string }> = {
  metamask: { initials: "MM", bg: "#3A2614", fg: "#F6A35A" },
  phantom: { initials: "PH", bg: "#231A3D", fg: "#B9A4FF" },
  rabby: { initials: "RB", bg: "#16223D", fg: "#8FB1FF" },
  "coinbase wallet": { initials: "CB", bg: "#13213A", fg: "#7AA7FF" },
  "trust wallet": { initials: "TW", bg: "#122634", fg: "#6FD3E8" },
};

/**
 * Wallet badge tile. Uses the EIP-6963 icon only if safeIcon accepts it (inline base64 image data URI);
 * otherwise a lettered tile as drawn. `size` is the tile edge in px.
 */
export function WalletBadge({ name, icon, size = 28 }: { name: string; icon?: string; size?: number }) {
  const safe = icon ? safeIcon(icon) : null;
  const radius = Math.round(size * 0.3);
  if (safe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data: URI icon from the wallet, validated by safeIcon
      <img src={safe} alt="" aria-hidden="true" width={size} height={size} className={styles.badgeImg} style={{ borderRadius: radius }} />
    );
  }
  const tile = TILES[name.trim().toLowerCase()];
  const initials = tile?.initials ?? (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?");
  return (
    <span
      aria-hidden="true"
      className={styles.badge}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.max(9, Math.round(size * 0.4)),
        background: tile?.bg ?? "#1E252D",
        color: tile?.fg ?? "#C7D0D9",
      }}
    >
      {initials}
    </span>
  );
}
