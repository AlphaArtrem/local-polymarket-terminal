import { jsonError } from "@/lib/http";
import { placeOrderBody } from "@/server/orders/body";
import { tradingError } from "@/server/orders/errors";
import { placeOrder } from "@/server/orders/place";
import { cursorQuery, getOpenOrders, parseQuery, respond } from "@/server/portfolio";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseQuery(request, cursorQuery);
  if (!query.ok) return query.response;
  return respond(() => getOpenOrders(query.data.cursor));
}

/** Places one order. Same-Origin is enforced by middleware; the body is re-validated server-side. */
export async function POST(request: Request) {
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
}
