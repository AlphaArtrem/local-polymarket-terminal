"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventCard } from "@/lib/browse-types";
import type { HistoryDTO } from "@/lib/live-types";
import type { LookupResult } from "@/lib/market";
import { shortDate, usd } from "../market/fmt";
import { Tile } from "./EventGridCard";
import { buyHref, featuredRows, linePaths, pctText, rowView, type FeaturedRow, type Series } from "./helpers";
import styles from "./browse.module.css";

const LINE_COLORS = ["#4FD1A5", "#7AA7FF", "#E8C27A"];
const CHART_W = 400;
const CHART_H = 180;

type Detail = { slug: string; rows: FeaturedRow[]; outcomes: number; volume: string | null; endDate: string | null };
type Chart = { slug: string; lines: { name: string; path: string }[] };

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    // Aborted or offline: the card falls back to the list data it already has.
    return null;
  }
}

/** Full outcome rows (with asset ids) from /api/lookup, then 1W Yes-price history of the top 3 from /api/history. */
function useFeaturedData(slug: string): { detail: Detail | null; chart: Chart | null } {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chart, setChart] = useState<Chart | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      const res = await fetchJson<LookupResult>(`/api/lookup?q=${encodeURIComponent(slug)}`, ctl.signal);
      if (!res || ctl.signal.aborted) return;
      const rows = featuredRows(res.markets);
      setDetail({
        slug,
        rows,
        outcomes: res.markets.filter((m) => m.listed).length,
        volume: res.event.volume,
        endDate: res.event.endDate,
      });
      const top = rows.slice(0, 3).filter((r) => r.yesAssetId);
      const histories = await Promise.all(
        top.map((r) => fetchJson<HistoryDTO>(`/api/history?assetId=${r.yesAssetId}&range=1w`, ctl.signal)),
      );
      if (ctl.signal.aborted) return;
      const named = top.flatMap((r, i) => {
        const points = histories[i]?.points ?? [];
        return points.length > 1 ? [{ name: r.name, series: points.map((p) => ({ t: p.t, p: Number(p.p) })) as Series }] : [];
      });
      if (named.length === 0) return;
      const paths = linePaths(named.map((n) => n.series), CHART_W, CHART_H);
      setChart({ slug, lines: named.map((n, i) => ({ name: n.name, path: paths[i]! })) });
    })();
    return () => ctl.abort();
  }, [slug]);

  return { detail: detail?.slug === slug ? detail : null, chart: chart?.slug === slug ? chart : null };
}

export function FeaturedCard({ card, category }: { card: EventCard; category: string | null }) {
  const v = rowView(card);
  const { detail, chart } = useFeaturedData(card.slug);
  // Until the lookup answers, show the list's two outcomes without trade buttons.
  const rows = detail?.rows ?? null;
  const volume = detail?.volume != null ? `Vol ${usd(detail.volume)}` : `Vol ${v.volume}`;
  const outcomes = detail?.outcomes ?? card.marketCount;
  const ends = shortDate(detail?.endDate ?? card.endDate);

  return (
    <article className={`card ${styles.ev} ${styles.featured}`} data-slot="browse-featured">
      <div className={styles.featMain}>
        <div className={styles.featHead}>
          <Tile title={v.title} image={v.image} size={48} />
          <div className={styles.cardTitle}>
            <div className="lbl" style={{ color: "#E8C27A" }}>{category ? `Featured · ${category}` : "Featured"}</div>
            <h2><Link href={v.href}>{v.title}</Link></h2>
          </div>
        </div>
        <div className={`num muted ${styles.featMeta}`}>
          <span>{volume}</span>
          <span>{outcomes} {outcomes === 1 ? "outcome" : "outcomes"}</span>
          <span>Ends {ends}</span>
        </div>
        {rows
          ? rows.map((r, i) => (
              <div key={`${r.name}-${i}`} className={styles.featRow}>
                <div className={styles.featName}>
                  <div className={styles.ellipsis}>{r.name}</div>
                  <div className={styles.bar} aria-hidden="true"><div style={{ width: `${r.pct}%` }} /></div>
                </div>
                <span className={`num ${styles.featPct}`}>{r.pctLabel}</span>
                <Link className={`${styles.q} ${styles.qy}`} href={buyHref(card.slug, r.yesAssetId)}>Yes {r.yesPrice}</Link>
                <Link className={`${styles.q} ${styles.qn}`} href={buyHref(card.slug, r.noAssetId)}>No {r.noPrice}</Link>
              </div>
            ))
          : card.top.map((t, i) => (
              <div key={`${t.label}-${i}`} className={styles.featRow}>
                <div className={styles.featName}>
                  <div className={styles.ellipsis}>{t.label}</div>
                  <div className={styles.bar} aria-hidden="true"><div style={{ width: `${Math.round(Number(t.price ?? 0) * 100)}%` }} /></div>
                </div>
                <span className={`num ${styles.featPct}`}>{pctText(t.price)}</span>
              </div>
            ))}
      </div>
      {chart ? (
        <div className={styles.featChart}>
          <div className={styles.chartHead}>
            <span className="lbl">Top {chart.lines.length} · 1W</span>
            <span className="num muted">{chart.lines[0]?.name} leads</span>
          </div>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label="One-week price lines for the top outcomes" className={styles.chart}>
            <g stroke="#1A2027"><path d="M0 45H400M0 90H400M0 135H400" /></g>
            {chart.lines.map((l, i) => (
              <path key={l.name} d={l.path} fill="none" stroke={LINE_COLORS[i]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className={styles.legend}>
            {chart.lines.map((l, i) => (
              <span key={l.name}><i style={{ background: LINE_COLORS[i] }} />{l.name}</span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
