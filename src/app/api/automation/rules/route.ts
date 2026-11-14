import { newRuleSchema, sliceAmounts } from "@/lib/automation";
import { parseDecimal } from "@/lib/decimal";
import { jsonError } from "@/lib/http";
import { getEnv } from "@/server/env";
import { automationErrorResponse, fetchMidpoints, heldSize, requireEngine } from "@/server/automation/runtime";
import type { NewRule } from "@/lib/phase8-types";

export const dynamic = "force-dynamic";

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Checks that need the market or the account. Returns an error response, or null when fine. */
async function preflight(spec: NewRule): Promise<Response | null> {
  if (spec.kind === "TPSL") {
    const mid = (await fetchMidpoints([spec.assetId]))[spec.assetId] ?? null;
    const m = mid === null ? null : parseDecimal(mid);
    if (m === null) return jsonError(422, "PRICE_UNAVAILABLE", "No current midpoint for this outcome");
    const tp = spec.takeProfit === null ? null : parseDecimal(spec.takeProfit);
    const sl = spec.stopLoss === null ? null : parseDecimal(spec.stopLoss);
    if ((tp !== null && tp <= m) || (sl !== null && sl >= m)) {
      return jsonError(422, "TRIGGER_ALREADY_MET", `The current price (${mid}) already meets a trigger; it would sell at once`);
    }
    const held = parseDecimal(await heldSize(spec.assetId, spec.conditionId)) ?? 0n;
    if ((parseDecimal(spec.size) ?? 0n) > held) {
      return jsonError(422, "INSUFFICIENT_SHARES", "You hold fewer shares than the rule's size");
    }
    return null;
  }

  const amounts = sliceAmounts(spec.total, spec.slices);
  if (!amounts) {
    return jsonError(422, "INVALID_SLICES", "total must be a multiple of 0.01 and every slice at least 0.01");
  }
  if (spec.side === "BUY") {
    const cap = getEnv().maxOrderUsdc;
    // The last slice is the largest (it takes the remainder).
    if (Number(amounts[amounts.length - 1]) > cap) {
      return jsonError(422, "SLICE_OVER_CAP", `A slice exceeds MAX_ORDER_USDC (${cap}); use more slices or a smaller total`);
    }
  } else {
    const held = parseDecimal(await heldSize(spec.assetId, spec.conditionId)) ?? 0n;
    if ((parseDecimal(spec.total) ?? 0n) > held) {
      return jsonError(422, "INSUFFICIENT_SHARES", "You hold fewer shares than the total to sell");
    }
  }
  return null;
}

export async function POST(request: Request) {
  const engine = await requireEngine();
  if (engine instanceof Response) return noStore(engine);
  const parsed = newRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "body";
    return noStore(jsonError(400, "INVALID_BODY", `Invalid rule: ${where}: ${issue?.message ?? "invalid"}`));
  }
  try {
    const refusal = await preflight(parsed.data);
    if (refusal) return noStore(refusal);
    return noStore(Response.json(await engine.addRule(parsed.data), { status: 201 }));
  } catch (err) {
    return noStore(automationErrorResponse(err));
  }
}
