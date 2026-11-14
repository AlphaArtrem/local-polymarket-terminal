import { jsonError } from "@/lib/http";
import { automationErrorResponse, requireEngine } from "@/server/automation/runtime";

export const dynamic = "force-dynamic";

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Armed rule -> cancelled. Finished rules (done, cancelled, error) are removed from the list. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const engine = await requireEngine();
  if (engine instanceof Response) return noStore(engine);
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{1,64}$/.test(id)) return noStore(jsonError(404, "NOT_FOUND", "Rule not found"));
  try {
    return noStore(Response.json(await engine.deleteRule(id)));
  } catch (err) {
    return noStore(automationErrorResponse(err));
  }
}
