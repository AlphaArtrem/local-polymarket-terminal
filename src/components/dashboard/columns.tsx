import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatTime, formatUsd, pnlTone, shortHash } from "@/lib/format";
import type { Column } from "./DataPanel";
import { CancelOrderButton } from "./CancelOrderButton";
import { RedeemButton } from "./RedeemButton";
import styles from "./dashboard.module.css";
import type { ActivityDto, OrderDto, PositionDto, TradeDto } from "./types";

const marketHref = (slug: string, extra = "") => `/market/${encodeURIComponent(slug)}${extra}`;

function MarketTitle({ title, slug }: { title: string | null; slug: string | null }) {
  const text = title ?? "—";
  return slug ? <Link href={marketHref(slug)}>{text}</Link> : <>{text}</>;
}

const pnlClass = (value: string) => {
  const tone = pnlTone(value);
  return tone === "pos" ? styles.pnlPos : tone === "neg" ? styles.pnlNeg : styles.flat;
};

function Pnl({ value, suffix }: { value: string; suffix?: string }) {
  return (
    <span className={value === "" ? undefined : pnlClass(value)}>
      {formatSignedUsd(value)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

const sideTone = (side: string) => (side.toUpperCase() === "BUY" ? styles.sidePos : styles.sideNeg);

/** Time and tx hashes: muted monospace as drawn. */
const MonoMuted = ({ children }: { children: ReactNode }) => <span className={`${styles.mono} muted`}>{children}</span>;

/** YES / NO render as the drawn tag; any other outcome name stays plain text. */
function Outcome({ name }: { name: string | null }) {
  if (!name) return <>—</>;
  const lower = name.toLowerCase();
  if (lower === "yes") return <span className={`${styles.tag} ${styles.tagYes}`}>{name}</span>;
  if (lower === "no") return <span className={`${styles.tag} ${styles.tagNo}`}>{name}</span>;
  return <>{name}</>;
}

export const positionColumns: Column<PositionDto>[] = [
  { header: "Market", wrap: true, render: (p) => <MarketTitle title={p.title} slug={p.eventSlug} /> },
  { header: "Outcome", render: (p) => <Outcome name={p.outcome} /> },
  { header: "Size", numeric: true, render: (p) => formatShares(p.size) },
  { header: "Avg", numeric: true, render: (p) => formatCents(p.avgPrice) },
  { header: "Price", numeric: true, render: (p) => formatCents(p.currentPrice) },
  { header: "Value", numeric: true, render: (p) => formatUsd(p.currentValue) },
  {
    header: "PnL",
    numeric: true,
    render: (p) => <Pnl value={p.pnl} suffix={`(${formatPercent(p.percentPnl)})`} />,
  },
  {
    header: "",
    render: (p) =>
      p.redeemable ? (
        <RedeemButton position={p} />
      ) : p.eventSlug ? (
        <Link className={`chip ${styles.action}`} href={marketHref(p.eventSlug, `?asset=${encodeURIComponent(p.assetId)}&side=SELL`)}>
          Close
        </Link>
      ) : null,
  },
];

/** Closed positions are not tradable, so no Close link. */
export const closedPositionColumns: Column<PositionDto>[] = positionColumns.slice(0, -1);

export const orderColumns: Column<OrderDto>[] = [
  { header: "Created", render: (o) => <MonoMuted>{formatTime(o.createdAt)}</MonoMuted> },
  { header: "Market", wrap: true, render: (o) => <MarketTitle title={o.question} slug={o.eventSlug} /> },
  { header: "Outcome", render: (o) => o.outcome },
  { header: "Side", render: (o) => <span className={sideTone(o.side)}>{o.side}</span> },
  { header: "Price", numeric: true, render: (o) => formatCents(o.price) },
  { header: "Size", numeric: true, render: (o) => formatShares(o.originalSize) },
  { header: "Filled", numeric: true, render: (o) => formatShares(o.sizeMatched) },
  { header: "Expires", render: (o) => (o.expiresAt === null ? "GTC" : formatTime(o.expiresAt * 1000)) },
  { header: "Status", render: (o) => o.status },
  { header: "", slot: "order-actions", render: (o) => <CancelOrderButton orderId={o.id} /> },
];

export const tradeColumns: Column<TradeDto>[] = [
  { header: "Time", render: (t) => <MonoMuted>{formatTime(t.time)}</MonoMuted> },
  { header: "Market", wrap: true, render: (t) => <MarketTitle title={t.question} slug={t.eventSlug} /> },
  { header: "Side", render: (t) => <span className={sideTone(t.side)}>{t.side}</span> },
  { header: "Outcome", render: (t) => t.outcome },
  { header: "Price", numeric: true, render: (t) => formatCents(t.price) },
  { header: "Size", numeric: true, render: (t) => formatShares(t.size) },
  { header: "Tx", render: (t) => <MonoMuted>{shortHash(t.txHash)}</MonoMuted> },
];

export const activityColumns: Column<ActivityDto>[] = [
  { header: "Time", render: (a) => <MonoMuted>{formatTime(a.time)}</MonoMuted> },
  { header: "Type", render: (a) => a.type },
  { header: "Market", wrap: true, render: (a) => <MarketTitle title={a.title} slug={a.eventSlug} /> },
  { header: "Outcome", render: (a) => a.outcome ?? "—" },
  { header: "Price", numeric: true, render: (a) => (a.price ? formatCents(a.price) : "—") },
  { header: "Shares", numeric: true, render: (a) => (a.shares ? formatShares(a.shares) : "—") },
  { header: "Amount", numeric: true, render: (a) => (a.amount ? formatUsd(a.amount) : "—") },
  { header: "Tx", render: (a) => <MonoMuted>{shortHash(a.txHash)}</MonoMuted> },
];
