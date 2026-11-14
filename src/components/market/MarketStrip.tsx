"use client";

import Link from "next/link";
import type { EventDTO, MarketDTO, OutcomeDTO } from "@/lib/market";
import { AlertButton } from "../alerts/AlertButton";
import { StarButton } from "../watchlist/StarButton";
import { changeText, cents, initials, shortDate, usd } from "./fmt";
import styles from "./market.module.css";
import { useDayChange } from "./useDayChange";
import { useLiveBook } from "./useLiveBook";

type Props = {
  event: EventDTO;
  market: MarketDTO | null;
  outcome: OutcomeDTO | null;
  isNo: boolean;
  /** Moves focus to the outcomes filter so another outcome can be picked. */
  onPickOutcome: () => void;
};

/** Price and 24h move for the selected outcome. */
function Live({ outcome, isNo }: { outcome: OutcomeDTO; isNo: boolean }) {
  const day = useDayChange(outcome.assetId);
  const move = day ? changeText(day.first, day.last) : null;
  return (
    <>
      <div className={styles.priceBlock} aria-label="Selected outcome price">
        <span className={`num ${styles.bigPrice}`}>{cents(outcome.price)}</span>
        {isNo ? <span className={`${styles.sideTag} ${styles.neg}`}>{outcome.label}</span> : null}
        {move ? <span className={`num ${styles.change} ${styles[move.tone]}`} title="Change over the last 24 hours">{move.text}</span> : null}
      </div>
    </>
  );
}

function SpreadStat({ assetId }: { assetId: string }) {
  const { book } = useLiveBook(assetId);
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>Spread</dt>
      <dd className={`num ${styles.statValue}`}>{cents(book?.spread)}</dd>
    </div>
  );
}

export function MarketStrip({ event, market, outcome, isNo, onPickOutcome }: Props) {
  const label = market && outcome ? `${market.title} · ${outcome.label}` : event.title;
  return (
    <header className={styles.strip} aria-label="Market">
      <div className={styles.identity}>
        {event.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Polymarket CDN image, no next/image config
          <img src={event.image} alt="" className={styles.tile} width={40} height={40} />
        ) : (
          <div className={styles.tile} aria-hidden="true">{initials(event.title)}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className={styles.crumbs}>
            <Link href="/">Markets</Link> / <span>{event.title}</span>
          </h1>
          <button type="button" className={styles.selectedName} onClick={onPickOutcome} aria-label="Choose outcome">
            {market ? market.title : "Select an outcome"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93A0AD" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>
      </div>
      {market && outcome ? <Live key={outcome.assetId} outcome={outcome} isNo={isNo} /> : null}
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Total Vol</dt>
          <dd className={`num ${styles.statValue}`}>{usd(market?.volume ?? event.volume)}</dd>
        </div>
        {outcome ? <SpreadStat assetId={outcome.assetId} /> : null}
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Ends</dt>
          <dd className={`num ${styles.statValue}`}>{shortDate(market?.endDate ?? event.endDate)}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        {market && outcome ? (
          <StarButton
            key={`star-${outcome.assetId}`}
            label={label}
            item={{ kind: "outcome", assetId: outcome.assetId, label, eventSlug: event.slug, eventTitle: event.title, priceAtAdd: outcome.price }}
          />
        ) : (
          <StarButton label={event.title} item={{ kind: "event", eventSlug: event.slug, eventTitle: event.title }} />
        )}
        {market && outcome ? (
          <AlertButton key={`alert-${outcome.assetId}`} assetId={outcome.assetId} label={label} eventSlug={event.slug} currentPrice={outcome.price} />
        ) : null}
        <a className={styles.linkBtn} href={`https://polymarket.com/event/${encodeURIComponent(event.slug)}`} target="_blank" rel="noopener noreferrer">
          Rules ↗
        </a>
      </div>
    </header>
  );
}
