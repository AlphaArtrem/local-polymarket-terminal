import { jsonError } from "@/lib/http";
import { enableTrading, getApprovalStatus, RelayerKeyMissingError } from "@/server/approvals";
import { tradingError } from "@/server/orders/errors";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Whether the account wallet has the approvals it needs to trade. Read-only. */
export const GET = withAccount(async () => {
  try {
    return Response.json(await getApprovalStatus(), noStore);
  } catch (err) {
    return tradingError(err, "approvals check");
  }
});

/**
 * Submits the one-time trading approvals. Takes no body. Same-Origin is enforced by middleware, and
 * the dashboard asks for confirmation before calling this.
 */
export const POST = withAccount(async () => {
  try {
    return Response.json(await enableTrading(), noStore);
  } catch (err) {
    if (err instanceof RelayerKeyMissingError) return jsonError(400, "RELAYER_KEY_REQUIRED", err.message);
    return tradingError(err, "approvals setup");
  }
}, { interactive: "approvals" });
