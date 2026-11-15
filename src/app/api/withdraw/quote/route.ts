import { jsonError } from "@/lib/http";
import { withdrawRequestSchema } from "@/lib/withdraw";
import { withAccount } from "@/server/account/with-account";
import { quoteWithdraw, withdrawError } from "@/server/withdraw";

export const dynamic = "force-dynamic";

/** Read-only estimate; nothing is sent. */
export const POST = withAccount(async (request: Request) => {
  const parsed = withdrawRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_BODY", "Body must be { amount, chainId, tokenAddress, recipient }");
  try {
    return Response.json(await quoteWithdraw(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return withdrawError(err);
  }
});
