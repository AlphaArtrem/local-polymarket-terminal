import { notFound } from "next/navigation";
import { MarketView } from "@/components/market/MarketView";
import { loadEventBySlug } from "@/server/markets";
import { isConfigured } from "@/server/polymarket";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ asset?: string | string[]; side?: string | string[] }>;
};

export default async function MarketPage({ params, searchParams }: Props) {
  const [{ slug }, { asset, side }] = await Promise.all([params, searchParams]);
  const result = await loadEventBySlug(decodeURIComponent(slug));
  if (!result) notFound();
  const assetId = typeof asset === "string" && /^\d+$/.test(asset) ? asset : undefined;
  const initialSide = side === "SELL" ? "SELL" : side === "BUY" ? "BUY" : undefined;
  return (
    <MarketView
      event={result.event}
      markets={result.markets}
      initialAssetId={assetId}
      initialSide={initialSide}
      configured={isConfigured()}
    />
  );
}
