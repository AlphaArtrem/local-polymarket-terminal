import { jsonError } from "@/lib/http";
import { getAccessStatus } from "@/server/access";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

export const GET = withAccount(async () => {
  try {
    return Response.json(await getAccessStatus());
  } catch (err) {
    // Reached only for invalid env (EnvError); its message never contains values.
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonError(500, "CONFIG_ERROR", message);
  }
}, { optional: true });
