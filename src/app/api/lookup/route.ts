import { z } from "zod";
import { jsonError } from "@/lib/http";
import { parseQuery } from "@/lib/search";
import { classifyError, resolveQuery } from "@/server/markets";

export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().min(1, "Missing q").max(500, "q is too long") });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!input.success) return jsonError(400, "BAD_QUERY", input.error.issues[0]?.message ?? "Invalid q");
  const parsed = parseQuery(input.data.q);
  if (!parsed.ok) return jsonError(400, "BAD_QUERY", parsed.reason);
  try {
    return Response.json(await resolveQuery(parsed.query));
  } catch (err) {
    const { status, code, message } = classifyError(err);
    return jsonError(status, code, message);
  }
}
