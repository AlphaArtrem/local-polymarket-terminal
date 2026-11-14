import { z } from "zod";
import { jsonError } from "@/lib/http";
import { HISTORY_RANGES } from "@/lib/live-types";
import { loadHistory } from "@/server/history";
import { classifyError } from "@/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  assetId: z.string().regex(/^\d{1,100}$/, "assetId must be a numeric string"),
  range: z.enum(HISTORY_RANGES, { message: `range must be one of ${HISTORY_RANGES.join(", ")}` }),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = querySchema.safeParse({
    assetId: params.get("assetId") ?? "",
    range: params.get("range") ?? "1d",
  });
  if (!input.success) return jsonError(400, "BAD_QUERY", input.error.issues[0]?.message ?? "Invalid query");
  try {
    const dto = await loadHistory(input.data.assetId, input.data.range);
    return Response.json(dto, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, code, message } = classifyError(err);
    return jsonError(status, code, message);
  }
}
