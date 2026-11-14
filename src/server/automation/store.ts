import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { storeFileSchema, type StoreFile } from "@/lib/automation";

/** JSON file store for automation rules. Writes are atomic; a corrupt file is never overwritten. */

export const INTERRUPTED_MESSAGE =
  "Interrupted while placing an order — check Open orders and Trades before creating it again";

/** The file exists but is not valid. Carries the path only, never the contents. */
export class StoreCorruptError extends Error {
  constructor(public readonly path: string) {
    super(`Automation file is corrupt or unreadable: ${path}`);
    this.name = "StoreCorruptError";
  }
}

export function resolveStorePath(file: string): string {
  return resolve(process.cwd(), file);
}

const empty = (): StoreFile => ({ version: 1, paused: false, rules: [] });

/**
 * Loads the store. A missing file is an empty store. Rules left "firing" by a crash become "error"
 * (`recovered` counts them) and are never fired again.
 */
export async function loadStore(file: string, now: number): Promise<{ data: StoreFile; recovered: number }> {
  const path = resolveStorePath(file);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { data: empty(), recovered: 0 };
    throw new StoreCorruptError(path);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StoreCorruptError(path);
  }
  const parsed = storeFileSchema.safeParse(json);
  if (!parsed.success) throw new StoreCorruptError(path);

  const data = parsed.data as StoreFile;
  let recovered = 0;
  for (const rule of data.rules) {
    if (rule.status !== "firing") continue;
    rule.status = "error";
    rule.error = INTERRUPTED_MESSAGE;
    rule.nextAt = null;
    rule.updatedAt = now;
    recovered++;
  }
  return { data, recovered };
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export async function saveStore(file: string, data: StoreFile): Promise<void> {
  const path = resolveStorePath(file);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
