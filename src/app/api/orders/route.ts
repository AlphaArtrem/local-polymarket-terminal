import { jsonError } from "@/lib/http";
import { placeOrderBody } from "@/server/orders/body";
import { tradingError } from "@/server/orders/errors";
import { cancelAllOrders, cancelOrdersInMarkets } from "@/server/orders/cancel-all";
import { placeOrder } from "@/server/orders/place";
import { cursorQuery, getOpenOrders, parseQuery, respond } from "@/server/portfolio";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

export const GET = withAccount(async (request: Request) => {
  const query = parseQuery(request, cursorQuery);
  if (!query.ok) return query.response;
  return respond(() => getOpenOrders(query.data.cursor));
});

/** Places one order. Same-Origin is enforced by middleware; the body is re-validated server-side. */
export const POST = withAccount(async (request: Request) => {
  const json: unknown = await request.json().catch(() => null);
  const body = placeOrderBody.safeParse(json);
  if (!body.success) {
    return jsonError(400, "INVALID_BODY", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  try {
    const result = await placeOrder(body.data);
    if (!result.ok) return jsonError(422, result.code, result.message);
    return Response.json(
      { orderId: result.orderId, status: result.status, settling: result.settling },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return tradingError(err, "place");
  }
}, { interactive: "order" });

const CONDITION_ID = /^0x[0-9a-fA-F]{64}$/;
const MAX_MARKETS = 50;

/** Cancels all open orders, or only those in `?conditionIds=` markets. Same-Origin is enforced by middleware. */
export const DELETE = withAccount(async (request: Request) => {
  const raw = new URL(request.url).searchParams.get("conditionIds");
  let ids: string[] | null = null;
  if (raw !== null) {
    ids = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()))];
    if (ids.length < 1 || ids.length > MAX_MARKETS || !ids.every((id) => CONDITION_ID.test(id))) {
      return jsonError(400, "INVALID_QUERY", `conditionIds must be 1-${MAX_MARKETS} comma-separated 0x condition ids`);
    }
  }
  try {
    const result = ids ? await cancelOrdersInMarkets(ids) : await cancelAllOrders();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return tradingError(err, "cancel all");
  }
});
