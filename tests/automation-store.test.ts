import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuleDTO } from "@/lib/phase8-types";
import { INTERRUPTED_MESSAGE, loadStore, saveStore, StoreCorruptError } from "@/server/automation/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "automation-store-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const rule = (status: RuleDTO["status"]): RuleDTO => ({
  id: "r1",
  spec: { kind: "TPSL", assetId: "1", conditionId: "0x" + "ab".repeat(32), label: "L", eventSlug: "s", size: "5", takeProfit: "0.8", stopLoss: null },
  status,
  error: null,
  createdAt: 1,
  updatedAt: 1,
  slicesDone: 0,
  nextAt: null,
  lastPrice: null,
  executions: [],
});

describe("automation store", () => {
  it("treats a missing file as empty", async () => {
    const { data } = await loadStore(join(dir, "none.json"), 1);
    expect(data).toEqual({ version: 1, paused: false, rules: [] });
  });

  it("creates the directory, round-trips, and leaves no temp file", async () => {
    const file = join(dir, "nested", "a.json");
    await saveStore(file, { version: 1, paused: true, rules: [rule("armed")] });
    const { data } = await loadStore(file, 1);
    expect(data.paused).toBe(true);
    expect(data.rules[0]?.id).toBe("r1");
    expect(await readdir(join(dir, "nested"))).toEqual(["a.json"]);
  });

  it("refuses a corrupt file, names the path only, and does not overwrite it", async () => {
    const file = join(dir, "bad.json");
    await writeFile(file, "{ secret-ish garbage");
    const err = await loadStore(file, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreCorruptError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).not.toContain("garbage");
    expect(await readFile(file, "utf8")).toBe("{ secret-ish garbage");
  });

  it("refuses a file that parses but has the wrong shape", async () => {
    const file = join(dir, "shape.json");
    await writeFile(file, JSON.stringify({ version: 1, rules: "x" }));
    await expect(loadStore(file, 1)).rejects.toBeInstanceOf(StoreCorruptError);
  });

  it("turns firing rules into error on load, never armed", async () => {
    const file = join(dir, "f.json");
    await saveStore(file, { version: 1, paused: false, rules: [rule("firing")] });
    const { data, recovered } = await loadStore(file, 99);
    expect(recovered).toBe(1);
    expect(data.rules[0]).toMatchObject({ status: "error", error: INTERRUPTED_MESSAGE, updatedAt: 99 });
  });
});
