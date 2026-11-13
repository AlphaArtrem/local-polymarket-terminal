import "server-only";
import { parseEnv, type Env } from "@/lib/parse-env";

let cached: Env | undefined;

/** Validated env, parsed once on first use. The only place app code reads the private key. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
