import Link from "next/link";
import type { EventCard } from "@/lib/browse-types";
import { StarButton } from "../watchlist/StarButton";
import { gridRows, initials, rowView, tileColors } from "./helpers";
import styles from "./browse.module.css";

/** Image from the CDN, or an initials tile in the design palette. */
export function Tile({ title, image, size }: { title: string; image: string | null; size: number }) {
  const box = { width: size, height: size };
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote Polymarket CDN images, no loader configured
    <img className={styles.tile} style={box} src={image} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className={styles.tile} style={{ ...box, ...tileColors(title) }} aria-hidden="true">
      {initials(title)}
    </span>
  );
}

export function EventGridCard({ card, category }: { card: EventCard; category: string | null }) {
  const v = rowView(card);
  const rows = gridRows(card);
  return (
    <li className={`card ${styles.ev} ${styles.gridCard}`} data-slot="browse-card">
      <div className={styles.cardHead}>
        <Tile title={v.title} image={v.image} size={36} />
        <div className={styles.cardTitle}>
          {category ? <div className={`lbl ${styles.cat}`}>{category}</div> : null}
          <h3><Link href={v.href}>{v.title}</Link></h3>
        </div>
        <StarButton label={v.title} item={{ kind: "event", eventSlug: card.slug, eventTitle: card.title }} />
      </div>
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className={styles.outRow}>
          <span className={styles.ellipsis}>{r.label}</span>
          <span className="num">{r.pct}</span>
          <Link className={`${styles.q} ${styles.qy}`} href={r.href} aria-label={`Buy ${r.label}`}>Buy</Link>
        </div>
      ))}
      <div className={`num muted ${styles.foot}`}>
        <span>Vol {v.volume}</span>
        <span>Ends {v.ends}</span>
      </div>
    </li>
  );
}
