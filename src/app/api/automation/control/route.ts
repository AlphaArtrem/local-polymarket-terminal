import { z } from "zod";
import { jsonError } from "@/lib/http";
import { automationErrorResponse, requireEngine } from "@/server/automation/runtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["pause", "resume"]) }).strict();

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Pause or resume the engine. Same-Origin is enforced by middleware. */
export async function POST(request: Request) {
  const engine = await requireEngine();
  if (engine instanceof Response) return noStore(engine);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStore(jsonError(400, "INVALID_BODY", 'Body must be { action: "pause" | "resume" }'));
  try {
    return noStore(Response.json(await engine.control(parsed.data.action)));
  } catch (err) {
    return noStore(automationErrorResponse(err));
  }
}
