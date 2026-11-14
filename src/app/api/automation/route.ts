import { automationErrorResponse, requireEngine } from "@/server/automation/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = await requireEngine();
  if (engine instanceof Response) return noStore(engine);
  try {
    return noStore(Response.json(engine.getState()));
  } catch (err) {
    return noStore(automationErrorResponse(err));
  }
}

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}
