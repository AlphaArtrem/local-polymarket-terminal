import { notFound } from "next/navigation";
import { MarketView } from "@/components/market/MarketView";
import { loadEventBySlug } from "@/server/markets";
import { getAccountMode } from "@/server/account/context";
import { getEnv } from "@/server/env";
import { isConfigured } from "@/server/polymarket";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ asset?: string | string[]; side?: string | string[] }>;
};

/** The per-order cap for the ticket footer; null when the env cannot be read (the server still enforces it). */
function orderCap(): number | null {
  try {
    return getEnv().maxOrderUsdc;
  } catch (err) {
    console.error("could not read the order cap", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

export default async function MarketPage({ params, searchParams }: Props) {
  const [{ slug }, { asset, side }] = await Promise.all([params, searchParams]);
  const result = await loadEventBySlug(decodeURIComponent(slug));
  if (!result) notFound();
  const assetId = typeof asset === "string" && /^\d+$/.test(asset) ? asset : undefined;
  const initialSide = side === "SELL" ? "SELL" : side === "BUY" ? "BUY" : undefined;
  const mode = getAccountMode();
  return (
    <MarketView
      event={result.event}
      markets={result.markets}
      initialAssetId={assetId}
      initialSide={initialSide}
      configured={mode === "key" && isConfigured()}
      mode={mode}
      maxOrderUsdc={orderCap()}
    />
  );
}
