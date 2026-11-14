import { jsonError } from "@/lib/http";
import { LONG_POLL_MS, walletReplySchema } from "@/lib/wallet-protocol";
import { envelopeResponse } from "@/server/wallet/operation";
import { currentSession } from "@/server/wallet/session";

export const dynamic = "force-dynamic";

/** The browser's answer to a pending wallet request. Cookie session required; same-Origin by middleware. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return jsonError(401, "WALLET_NOT_CONNECTED", "Connect a browser wallet first");

  const json: unknown = await request.json().catch(() => null);
  const body = walletReplySchema.safeParse(json);
  if (!body.success) {
    return jsonError(400, "INVALID_BODY", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const op = session.op;
  if (!op || op.id !== body.data.opId) return jsonError(400, "WRONG_OP", "No such operation is waiting for the wallet");
  try {
    op.reply(body.data);
  } catch (err) {
    return jsonError(400, "BAD_REPLY", err instanceof Error ? err.message : "Invalid reply");
  }
  return envelopeResponse(await op.next(LONG_POLL_MS));
}
