import { enableTrading, getApprovalStatus } from "@/server/approvals";
import { tradingError } from "@/server/orders/errors";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Whether the account wallet has the approvals it needs to trade. Read-only. */
export async function GET() {
  try {
    return Response.json(await getApprovalStatus(), noStore);
  } catch (err) {
    return tradingError(err, "approvals check");
  }
}

/**
 * Submits the one-time trading approvals. Takes no body. Same-Origin is enforced by middleware, and
 * the dashboard asks for confirmation before calling this.
 */
export async function POST() {
  try {
    return Response.json(await enableTrading(), noStore);
  } catch (err) {
    return tradingError(err, "approvals setup");
  }
}
