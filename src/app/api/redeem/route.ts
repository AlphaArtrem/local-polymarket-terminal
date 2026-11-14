import { z } from "zod";
import { jsonError } from "@/lib/http";
import { tradingError } from "@/server/orders/errors";
import { NothingToRedeemError, redeemMarket, RelayerKeyMissingError } from "@/server/redeem";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

const bodySchema = z.object({ conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();

/**
 * Redeems the account's resolved positions in one market. Same-Origin is enforced by middleware and
 * the dashboard asks for confirmation first.
 */
export const POST = withAccount(async (request: Request) => {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "INVALID_BODY", "Body must be { conditionId: 0x… (32-byte hex) }");
  try {
    return Response.json(await redeemMarket(parsed.data.conditionId), noStore);
  } catch (err) {
    if (err instanceof RelayerKeyMissingError) return jsonError(400, "RELAYER_KEY_REQUIRED", err.message);
    if (err instanceof NothingToRedeemError) return jsonError(409, "NOTHING_TO_REDEEM", err.message);
    return tradingError(err, "redeem");
  }
}, { interactive: "redeem" });
