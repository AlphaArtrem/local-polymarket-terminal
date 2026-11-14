import { z } from "zod";
import { jsonError } from "@/lib/http";
import { openMarketStream } from "@/server/stream";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  assetId: z.string().regex(/^\d{1,100}$/, "assetId must be a numeric string"),
});

export async function GET(request: Request) {
  const input = querySchema.safeParse({
    assetId: new URL(request.url).searchParams.get("assetId") ?? "",
  });
  if (!input.success) return jsonError(400, "BAD_QUERY", input.error.issues[0]?.message ?? "Invalid assetId");
  return new Response(openMarketStream(input.data.assetId, request.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
