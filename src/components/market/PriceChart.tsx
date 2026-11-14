"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatCents, formatFull, nearestPoint, rangeChange, scaleChart, type Padding } from "@/lib/chart";
import { HISTORY_RANGES, type HistoryDTO, type HistoryRange, type PricePoint } from "@/lib/live-types";
import { cents } from "./fmt";
import styles from "./chart.module.css";

const HEIGHT = 240;
const PADDING: Padding = { top: 8, right: 8, bottom: 18, left: 36 };
const LABELS: Record<HistoryRange, string> = { "1h": "1H", "6h": "6H", "1d": "1D", "1w": "1W", "1m": "1M", max: "All" };

/** `key` names the request a result belongs to; a result for another key counts as loading. */
type Result = { key: string; error: string } | { key: string; error?: undefined; points: PricePoint[] };

type Props = {
  assetId: string;
  label: string;
  /** Yes/No control: the chart follows the selected outcome. */
  outcomes: { label: string; price: string | null }[];
  outcomeIndex: number;
  onOutcomeChange: (index: number) => void;
};

export function PriceChart({ assetId, label, outcomes, outcomeIndex, onOutcomeChange }: Props) {
  const [range, setRange] = useState<HistoryRange>("1d");
  const [result, setResult] = useState<Result | null>(null);
  const [width, setWidth] = useState(320);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(120, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${assetId}:${range}`;
    fetch(`/api/history?assetId=${encodeURIComponent(assetId)}&range=${range}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as HistoryDTO | { error?: { message?: string } };
        if (!res.ok || !("points" in body)) {
          throw new Error(("error" in body && body.error?.message) || `History request failed (${res.status})`);
        }
        setResult({ key, points: body.points });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key, error: err instanceof Error ? err.message : "History request failed" });
      });
    return () => controller.abort();
  }, [assetId, range]);

  const current = result?.key === `${assetId}:${range}` ? result : null;
  const status = !current ? "loading" : current.error !== undefined ? "error" : "ready";
  const points = useMemo(() => (current && current.error === undefined ? current.points : []), [current]);
  const scale = useMemo(() => scaleChart(points, width, HEIGHT, PADDING, range), [points, width, range]);
  const change = rangeChange(points);
  const hover = hoverT === null || status !== "ready" ? null : nearestPoint(points, hoverT);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const first = points[0]!.t;
    const last = points[points.length - 1]!.t;
    const frac = (event.clientX - rect.left - PADDING.left) / Math.max(1, width - PADDING.left - PADDING.right);
    setHoverT(first + Math.min(1, Math.max(0, frac)) * (last - first));
  };

  const changeText = change
    ? `${change.change >= 0 ? "+" : "-"}${Math.abs(Math.round(change.change * 1000) / 10)}¢`
    : "";
  const summary = change
    ? `${label} price, ${LABELS[range]}: ${formatCents(change.first)} to ${formatCents(change.last)} (${changeText})`
    : `${label} price chart, ${LABELS[range]}: no data`;

  return (
    <section className={`card ${styles.chart}`} aria-label={`${label} price history`}>
      <div className={styles.header}>
        <div className={styles.seg} role="group" aria-label="Outcome">
          {outcomes.map((o, i) => (
            <button key={o.label} type="button" aria-pressed={i === outcomeIndex} onClick={() => onOutcomeChange(i)}>
              {o.label} <span className={styles.mono}>{cents(o.price)}</span>
            </button>
          ))}
        </div>
        <div className={styles.ranges} role="group" aria-label="Range">
          {HISTORY_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === range} onClick={() => { setRange(r); setHoverT(null); }}>
              {LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div ref={box} className={styles.plot} style={{ height: HEIGHT }}>
        {status === "loading" && <div className={styles.note}>Loading…</div>}
        {status === "error" && <div className={`${styles.note} ${styles.down}`} role="alert">{current?.error}</div>}
        {status === "ready" && points.length === 0 && <div className={styles.note}>No trades in this range</div>}
        {status === "ready" && points.length > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={summary}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHoverT(null)}
          >
            {scale.yTicks.map((tick) => (
              <g key={tick.p}>
                <line className={styles.grid} x1={PADDING.left} x2={width - PADDING.right} y1={scale.y(tick.p)} y2={scale.y(tick.p)} />
                <text className={styles.axis} x={PADDING.left - 4} y={scale.y(tick.p)} textAnchor="end" dominantBaseline="middle">
                  {tick.label}
                </text>
              </g>
            ))}
            {scale.xTicks.map((tick, i) => (
              <text
                key={tick.t}
                className={styles.axis}
                x={scale.x(tick.t)}
                y={HEIGHT - 4}
                textAnchor={i === 0 ? "start" : i === scale.xTicks.length - 1 ? "end" : "middle"}
              >
                {tick.label}
              </text>
            ))}
            <defs>
              <linearGradient id={`fill-${assetId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#4FD1A5" stopOpacity=".22" />
                <stop offset="1" stopColor="#4FD1A5" stopOpacity="0" />
              </linearGradient>
            </defs>
            {points.length > 1 && (
              <path
                d={`${scale.path}L${scale.x(points[points.length - 1]!.t)} ${HEIGHT - PADDING.bottom}L${scale.x(points[0]!.t)} ${HEIGHT - PADDING.bottom}Z`}
                fill={`url(#fill-${assetId})`}
              />
            )}
            <path className={styles.line} d={scale.path} />
            {points.length === 1 && <circle className={styles.dot} cx={scale.x(points[0]!.t)} cy={scale.y(Number(points[0]!.p))} r={3} />}
            {hover && (
              <g>
                <line className={styles.cross} x1={scale.x(hover.t)} x2={scale.x(hover.t)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
                <circle className={styles.dot} cx={scale.x(hover.t)} cy={scale.y(Number(hover.p))} r={3} />
              </g>
            )}
          </svg>
        )}
        {hover && (
          <div
            className={styles.tooltip}
            style={{ left: Math.min(Math.max(scale.x(hover.t), 50), width - 50) }}
            aria-hidden="true"
          >
            <strong>{formatCents(Number(hover.p))}</strong> {formatFull(hover.t)}
          </div>
        )}
      </div>
    </section>
  );
}
