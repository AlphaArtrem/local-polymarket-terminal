"use client";

import { useMemo, useState } from "react";
import type { EventDTO, MarketDTO, SelectedOutcome } from "@/lib/market";
import { cents, pct, shortDate, usd } from "./fmt";
import { AlertButton } from "../alerts/AlertButton";
import { AutomateSection } from "../automation/AutomateSection";
import { OrderBook } from "./OrderBook";
import { PriceChart } from "./PriceChart";
import { TradeTape } from "./TradeTape";
import { TradeTicket } from "./TradeTicket";
import { StarButton } from "../watchlist/StarButton";
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
  // The page opens on the highest-priced listed market (the only one for binary events), so the chart,
  // book and ticket are populated without a click. Selecting never places anything.
  const topListed = useMemo(() => sorted.find((m) => m.listed)?.id ?? null, [sorted]);
  const [marketId, setMarketId] = useState<string | null>(initial?.marketId ?? topListed);
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

  const yes = outcome?.label ?? "";
  const isNo = side === 1;

  return (
    <div className={styles.page}>
      <header className={`card ${styles.strip}`}>
        <div className={styles.identity}>
          {event.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Polymarket CDN image, no next/image config
            <img src={event.image} alt="" className={styles.eventImage} width={44} height={44} />
          ) : null}
          <div>
            <h1 className={styles.title}>{event.title}</h1>
            <div className={styles.selectedName}>{market ? market.title : "Select an outcome"}</div>
          </div>
        </div>
        {market && outcome ? (
          <div className={styles.priceBlock} aria-label="Selected outcome price">
            <span className={`num ${styles.bigPrice}`}>{cents(outcome.price)}</span>
            <span className={`${styles.sideTag} ${isNo ? "neg" : "pos"}`}>{yes}</span>
          </div>
        ) : null}
        <dl className={styles.stats} style={{ margin: 0 }}>
          <div className={styles.stat}><dt className="lbl">Volume</dt><dd className="num" style={{ margin: 0 }}>{usd(market?.volume ?? event.volume)}</dd></div>
          <div className={styles.stat}><dt className="lbl">Ends</dt><dd className="num" style={{ margin: 0 }}>{shortDate(market?.endDate ?? event.endDate)}</dd></div>
          <div className={styles.stat}><dt className="lbl">Markets</dt><dd className="num" style={{ margin: 0 }}>{markets.length - hiddenCount}</dd></div>
        </dl>
        {market && outcome ? (
          <AlertButton
            key={`alert-${outcome.assetId}`}
            assetId={outcome.assetId}
            label={`${market.title} · ${outcome.label}`}
            eventSlug={event.slug}
            currentPrice={outcome.price}
          />
        ) : null}
        {market && outcome ? (
          <StarButton
            key={`star-${outcome.assetId}`}
            label={`${market.title} · ${outcome.label}`}
            item={{
              kind: "outcome",
              assetId: outcome.assetId,
              label: `${market.title} · ${outcome.label}`,
              eventSlug: event.slug,
              eventTitle: event.title,
              priceAtAdd: outcome.price,
            }}
          />
        ) : (
          <StarButton label={event.title} item={{ kind: "event", eventSlug: event.slug, eventTitle: event.title }} />
        )}
      </header>

      <div className={styles.workspace}>
        <section className={`card ${styles.rail}`} aria-label="Outcomes">
          <div className={styles.railHead}>
            <span className="lbl">Outcomes ({visible.length})</span>
            <input
              className={`input ${styles.filter}`}
              placeholder="Filter markets"
              aria-label="Filter markets"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {hiddenCount > 0 ? (
              <label className={styles.toggleRow}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show{" "}
                {hiddenCount} inactive placeholder markets
              </label>
            ) : null}
          </div>
          <ul className={styles.list}>
            {visible.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={styles.outcome}
                  aria-pressed={m.id === marketId}
                  onClick={() => {
                    setMarketId(m.id);
                    setSide(0);
                  }}
                >
                  <span className={styles.outcomeTop}>
                    <span className={styles.outcomeName}>{m.title}</span>
                    <span className={`num ${styles.outcomeYes}`}>{cents(m.outcomes[0]?.price)}</span>
                  </span>
                  <span className={styles.bar} aria-hidden="true">
                    <span className={styles.barFill} style={{ display: "block", width: `${pct(m.outcomes[0]?.price)}%` }} />
                  </span>
                  <span className={styles.outcomeBottom}>
                    <span className="num">{usd(m.volume)} vol</span>
                    <span className={`num ${styles.outcomeNo}`}>No {cents(m.outcomes[1]?.price)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <div className={styles.empty}>No markets match.</div> : null}
        </section>

        <section className={styles.centre} aria-label="Market data">
          {market && outcome ? (
            <>
              <PriceChart key={`chart-${outcome.assetId}`} assetId={outcome.assetId} label={outcome.label} />
              <div className={styles.books}>
                <OrderBook key={outcome.assetId} assetId={outcome.assetId} label={outcome.label} />
                <TradeTape key={`tape-${outcome.assetId}`} assetId={outcome.assetId} />
              </div>
            </>
          ) : (
            <div className={`card ${styles.empty}`}>Select an outcome to see its chart and order book.</div>
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
          {configured && market?.conditionId && outcome ? (
            <div className={`card ${styles.panel}`} aria-label="Pro tools">
              <div className={styles.panelHead}>
                <span className="lbl">Pro: automation</span>
              </div>
              <AutomateSection
                key={`auto-${outcome.assetId}`}
                assetId={outcome.assetId}
                conditionId={market.conditionId}
                label={`${market.title} · ${outcome.label}`}
                eventSlug={event.slug}
                currentPrice={outcome.price ?? null}
              />
            </div>
          ) : null}
        </aside>
      </div>
      {configured ? (
        <YourOrders conditionIds={markets.map((m) => m.conditionId).filter((c): c is string => Boolean(c))} />
      ) : null}
    </div>
  );
}
