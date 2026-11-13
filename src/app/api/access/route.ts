import { jsonError } from "@/lib/http";
import { getAccessStatus } from "@/server/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getAccessStatus());
  } catch (err) {
    // Reached only for invalid env (EnvError); its message never contains values.
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonError(500, "CONFIG_ERROR", message);
  }
}
