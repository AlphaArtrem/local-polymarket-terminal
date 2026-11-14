"use client";

import { useMemo, useState } from "react";
import type { EventDTO, MarketDTO, SelectedOutcome } from "@/lib/market";
import { cents, shortDate, usd } from "./fmt";
import { OrderBook } from "./OrderBook";
import { PriceChart } from "./PriceChart";
import { TradeTape } from "./TradeTape";
import { TradeTicket } from "./TradeTicket";
import { YourOrders } from "./YourOrders";
import styles from "./market.module.css";

type Props = {
  event: EventDTO;
  markets: MarketDTO[];
  initialAssetId?: string;
  initialSide?: "BUY" | "SELL";
  configured: boolean;
};

const yesPrice = (m: MarketDTO) => Number(m.outcomes[0]?.price ?? -1);

/** Finds the market and outcome index that own `assetId`. */
function locate(markets: MarketDTO[], assetId: string | undefined) {
  if (!assetId) return null;
  for (const market of markets) {
    const side = market.outcomes.findIndex((o) => o.assetId === assetId);
    if (side >= 0) return { marketId: market.id, side };
  }
  return null;
}

export function MarketView({ event, markets, initialAssetId, initialSide, configured }: Props) {
  const sorted = useMemo(() => [...markets].sort((a, b) => yesPrice(b) - yesPrice(a)), [markets]);
  const initial = useMemo(() => locate(markets, initialAssetId), [markets, initialAssetId]);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const hiddenCount = useMemo(() => markets.filter((m) => !m.listed).length, [markets]);
  // A single-market event (binary questions, 5-minute crypto markets) opens with that market selected.
  const onlyListed = useMemo(() => {
    const l = markets.filter((m) => m.listed);
    return l.length === 1 ? l[0]!.id : null;
  }, [markets]);
  const [marketId, setMarketId] = useState<string | null>(initial?.marketId ?? onlyListed);
  const [side, setSide] = useState(initial?.side ?? 0);

  const needle = filter.trim().toLowerCase();
  // The selected market stays visible even if unlisted (e.g. opened via ?asset=).
  const listed = showInactive ? sorted : sorted.filter((m) => m.listed || m.id === marketId);
  const visible = needle
    ? listed.filter((m) => m.title.toLowerCase().includes(needle) || m.question.toLowerCase().includes(needle))
    : listed;

  const market = markets.find((m) => m.id === marketId) ?? null;
  const outcome = market ? (market.outcomes[side] ?? market.outcomes[0] ?? null) : null;
  const selected: SelectedOutcome | null = market && outcome ? { market, outcome } : null;

  return (
    <div className={styles.page}>
      <header className={styles.eventHeader}>
        {event.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Polymarket CDN image, no next/image config
          <img src={event.image} alt="" className={styles.eventImage} width={56} height={56} />
        ) : null}
        <div>
          <h1 className={styles.title}>{event.title}</h1>
          <div className={styles.muted}>
            Ends {shortDate(event.endDate)} · Volume {usd(event.volume)} · {markets.length - hiddenCount} markets
          </div>
        </div>
      </header>

      <div className={styles.columns}>
        <section className={styles.listPane}>
          <input
            className={styles.filter}
            placeholder="Filter markets"
            aria-label="Filter markets"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {hiddenCount > 0 ? (
            <label className={styles.muted}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show{" "}
              {hiddenCount} inactive placeholder markets
            </label>
          ) : null}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Outcome</th>
                <th className={styles.num}>Yes</th>
                <th className={styles.num}>No</th>
                <th className={styles.num}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr
                  key={m.id}
                  className={m.id === marketId ? styles.selectedRow : styles.row}
                  onClick={() => {
                    setMarketId(m.id);
                    setSide(0);
                  }}
                >
                  <td>{m.title}</td>
                  <td className={styles.num}>{cents(m.outcomes[0]?.price)}</td>
                  <td className={styles.num}>{cents(m.outcomes[1]?.price)}</td>
                  <td className={styles.num}>{usd(m.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? <div className={styles.muted}>No markets match.</div> : null}
        </section>

        <section className={styles.bookPane}>
          {market && outcome ? (
            <>
              <div className={styles.bookHeader}>
                <strong>{market.title}</strong>
                <div className={styles.toggle} role="group" aria-label="Outcome">
                  {market.outcomes.map((o, i) => (
                    <button
                      key={o.assetId}
                      type="button"
                      aria-pressed={i === side}
                      className={i === side ? styles.toggleOn : styles.toggleOff}
                      onClick={() => setSide(i)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <PriceChart key={`chart-${outcome.assetId}`} assetId={outcome.assetId} label={outcome.label} />
              <OrderBook key={outcome.assetId} assetId={outcome.assetId} label={outcome.label} />
              <TradeTape key={`tape-${outcome.assetId}`} assetId={outcome.assetId} />
            </>
          ) : (
            <div className={styles.muted}>Select a market to see its order book.</div>
          )}
        </section>

        <aside className={styles.ticketPane} data-slot="trade-ticket" data-asset-id={selected?.outcome.assetId}>
          <TradeTicket
            key={market?.id ?? "none"}
            selected={selected}
            configured={configured}
            initialSide={initialSide}
            outcomeIndex={side}
            onOutcomeChange={setSide}
          />
        </aside>
      </div>
      {configured ? (
        <YourOrders conditionIds={markets.map((m) => m.conditionId).filter((c): c is string => Boolean(c))} />
      ) : null}
    </div>
  );
}
