import { cancelOrder } from "@polymarket/client/actions";
import { jsonError } from "@/lib/http";
import { cancelParams } from "@/server/orders/body";
import { tradingError } from "@/server/orders/errors";
import { getSecureClient } from "@/server/polymarket";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Cancels one open order. Same-Origin is enforced by middleware. */
export async function DELETE(_request: Request, { params }: Context) {
  const parsed = cancelParams.safeParse(await params);
  if (!parsed.success) return jsonError(400, "INVALID_ID", "Invalid order id");
  const { id } = parsed.data;
  try {
    const client = await getSecureClient();
    const result = await cancelOrder(client, { orderId: id });
    const reason = result.notCanceled[id as keyof typeof result.notCanceled];
    if (reason !== undefined) return jsonError(404, "NOT_CANCELED", reason || "Order could not be canceled");
    console.info(`[orders] canceled ${id}`);
    return Response.json({ canceled: id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return tradingError(err, "cancel");
  }
}
