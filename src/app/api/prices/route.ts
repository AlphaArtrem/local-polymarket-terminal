import { jsonError } from "@/lib/http";
import type { PricesDTO } from "@/lib/phase7-types";
import { classifyError } from "@/server/markets";
import { fetchPrices } from "@/server/prices";

export const dynamic = "force-dynamic";

const MAX_IDS = 50;
const ASSET_ID_RE = /^\d{1,100}$/;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("assetIds") ?? "";
  // Repeated ids are collapsed (contract: deduplicated), so two alerts on one asset never 400.
  const ids = [...new Set(raw.split(","))];
  if (!raw || ids.length > MAX_IDS) {
    return jsonError(400, "BAD_QUERY", `assetIds must list 1 to ${MAX_IDS} ids`);
  }
  if (!ids.every((id) => ASSET_ID_RE.test(id))) {
    return jsonError(400, "BAD_QUERY", "assetIds must be numeric ids of 1 to 100 digits");
  }
  try {
    const dto: PricesDTO = { prices: await fetchPrices(ids) };
    return Response.json(dto);
  } catch (err) {
    const { status, code, message } = classifyError(err);
    return jsonError(status, code, message);
  }
}
