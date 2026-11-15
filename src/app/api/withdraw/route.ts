import { jsonError } from "@/lib/http";
import { withdrawRequestSchema } from "@/lib/withdraw";
import { withAccount } from "@/server/account/with-account";
import { getWithdrawOptions, withdraw, withdrawError } from "@/server/withdraw";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Options for the withdraw dialog: balance, path and the destinations the bridge supports. */
export const GET = withAccount(async () => {
  try {
    return Response.json(await getWithdrawOptions(), noStore);
  } catch (err) {
    return withdrawError(err);
  }
});

/** Sends pUSD to a fresh bridge address. Same-Origin is enforced by middleware; the dialog confirms first. */
export const POST = withAccount(async (request: Request) => {
  const parsed = withdrawRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_BODY", "Body must be { amount, chainId, tokenAddress, recipient }");
  try {
    return Response.json(await withdraw(parsed.data), noStore);
  } catch (err) {
    return withdrawError(err);
  }
}, { interactive: "withdraw" });
