import { jsonError } from "@/lib/http";
import { LONG_POLL_MS } from "@/lib/wallet-protocol";
import { envelopeResponse } from "@/server/wallet/operation";
import { currentSession } from "@/server/wallet/session";

export const dynamic = "force-dynamic";

/** Live operation (long-poll) or its finished envelope, kept 10 minutes. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return jsonError(401, "WALLET_NOT_CONNECTED", "Connect a browser wallet first");
  const { id } = await ctx.params;
  if (session.op?.id === id) return envelopeResponse(await session.op.next(LONG_POLL_MS));
  const recent = session.recent.get(id);
  if (recent) return envelopeResponse(recent);
  return jsonError(404, "UNKNOWN_OP", "Unknown or expired operation");
}
