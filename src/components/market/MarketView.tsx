"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { EventDTO, MarketDTO, SelectedOutcome } from "@/lib/market";
import { ActivityPanel } from "./ActivityPanel";
import { MarketStrip } from "./MarketStrip";
import { OrderBook } from "./OrderBook";
import { OutcomesRail } from "./OutcomesRail";
import { PriceChart } from "./PriceChart";
import { TradeTape } from "./TradeTape";
import { TradeTicket } from "./TradeTicket";
import type { AccountMode } from "@/lib/wallet-protocol";
import { useWallet } from "../wallet/useWallet";
import styles from "./market.module.css";

type Props = {
  event: EventDTO;
  markets: MarketDTO[];
  initialAssetId?: string;
  initialSide?: "BUY" | "SELL";
  /** Key mode: server-known. Ignored in wallet mode, where a connected session decides. */
  configured: boolean;
  mode?: AccountMode;
  /** Server cap per order (MAX_ORDER_USDC), shown in the ticket footer. */
  maxOrderUsdc?: number | null;
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

export function MarketView({ event, markets, initialAssetId, initialSide, configured: serverConfigured, mode = "key", maxOrderUsdc = null }: Props) {
  const wallet = useWallet();
  const configured = mode === "wallet" ? wallet.connected : serverConfigured;
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
  const [sellToken, setSellToken] = useState(0);
  // After a Close click a remounted ticket (market change) must open on Sell too.
  const [closing, setClosing] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const needle = filter.trim().toLowerCase();
  // The selected market stays visible even if unlisted (e.g. opened via ?asset=).
  const listed = showInactive ? sorted : sorted.filter((m) => m.listed || m.id === marketId);
  const visible = needle
    ? listed.filter((m) => m.title.toLowerCase().includes(needle) || m.question.toLowerCase().includes(needle))
    : listed;

  const market = markets.find((m) => m.id === marketId) ?? null;
  const outcome = market ? (market.outcomes[side] ?? market.outcomes[0] ?? null) : null;
  const selected: SelectedOutcome | null = market && outcome ? { market, outcome } : null;

  const isNo = side === 1;

  // "Close" in the positions list: select that outcome and put the ticket on Sell.
  const closePosition = useCallback(
    (assetId: string) => {
      const hit = locate(markets, assetId);
      if (!hit) return;
      setMarketId(hit.marketId);
      setSide(hit.side);
      setSellToken((n) => n + 1);
      setClosing(true);
    },
    [markets],
  );

  return (
    <div className={styles.page}>
      <MarketStrip event={event} market={market} outcome={outcome} isNo={isNo} onPickOutcome={() => filterRef.current?.focus()} />

      <div className={styles.workspace}>
        <OutcomesRail
          markets={visible}
          selectedId={marketId}
          filter={filter}
          onFilter={setFilter}
          hiddenCount={hiddenCount}
          showInactive={showInactive}
          onToggleInactive={() => setShowInactive((v) => !v)}
          onPick={(id) => {
            setMarketId(id);
            setSide(0);
            setClosing(false);
          }}
          filterRef={filterRef}
        />

        <section className={styles.centre} aria-label="Market data">
          {market && outcome ? (
            <>
              <PriceChart
                assetId={outcome.assetId}
                label={outcome.label}
                outcomes={market.outcomes}
                outcomeIndex={side}
                onOutcomeChange={setSide}
              />
              <div className={styles.books}>
                <OrderBook key={outcome.assetId} assetId={outcome.assetId} label={outcome.label} />
                <TradeTape key={`tape-${outcome.assetId}`} assetId={outcome.assetId} />
              </div>
            </>
          ) : (
            <div className={`card ${styles.empty}`}>Select an outcome to see its chart and order book.</div>
          )}
        </section>

        <aside className={`${styles.ticketPane}`} data-slot="trade-ticket" data-asset-id={selected?.outcome.assetId}>
          <TradeTicket
            key={market?.id ?? "none"}
            selected={selected}
            configured={configured}
            initialSide={closing ? "SELL" : initialSide}
            outcomeIndex={side}
            onOutcomeChange={setSide}
            eventTitle={event.title}
            eventSlug={event.slug}
            maxOrderUsdc={maxOrderUsdc}
            accountMode={mode}
            sellToken={sellToken}
          />
        </aside>
      </div>

      <ActivityPanel markets={markets} configured={configured} mode={mode} onClose={closePosition} />
    </div>
  );
}
