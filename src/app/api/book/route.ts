import { z } from "zod";
import { jsonError } from "@/lib/http";
import { classifyError, loadBook } from "@/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  assetId: z.string().regex(/^\d{1,100}$/, "assetId must be a numeric string"),
});

export async function GET(request: Request) {
  const input = querySchema.safeParse({
    assetId: new URL(request.url).searchParams.get("assetId") ?? "",
  });
  if (!input.success) return jsonError(400, "BAD_QUERY", input.error.issues[0]?.message ?? "Invalid assetId");
  try {
    return Response.json(await loadBook(input.data.assetId));
  } catch (err) {
    const { status, code, message } = classifyError(err);
    return jsonError(status, code, message);
  }
}
