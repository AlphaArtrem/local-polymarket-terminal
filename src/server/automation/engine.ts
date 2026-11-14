import { priceAllows, sliceAmounts, tpslHit, MAX_ARMED_RULES, type StoreFile } from "@/lib/automation";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import type { AutomationStateDTO, Execution, NewRule, RuleDTO } from "@/lib/phase8-types";
import { loadStore, saveStore } from "./store";

/**
 * App-run take-profit/stop-loss and TWAP. Places market orders only while the server runs and is not
 * paused. REAL MONEY: every order goes through the injected `placeOrder` (the real `placeOrder`
 * re-validates mode, tick, size, cap and slippage). A rule is persisted as "firing" BEFORE the order
 * call so a crash can never lead to a second order.
 */

export const TICK_MS = 5_000;
/** A TP/SL fires only when its trigger is met on this many consecutive ticks (spike guard). */
export const CONFIRM_TICKS = 2;
/** Thrown errors (network, rate limit) on one rule before it stops. */
export const MAX_THROWS_PER_RULE = 3;
/** Failed firings in a row, across rules, before the whole engine pauses. */
export const MAX_FAILURES_IN_A_ROW = 3;

export type OrderRequestLike = {
  assetId: string;
  conditionId: string;
  side: "BUY" | "SELL";
  type: "MARKET";
  size?: string;
  amount?: string;
};
export type PlaceResultLike = { ok: true; orderId: string } | { ok: false; code: string; message: string };

export type EngineDeps = {
  file: string;
  now: () => number;
  /** Fresh midpoints (not the 10 s cache, which would make two ticks one sample). */
  fetchMidpoints: (assetIds: string[]) => Promise<Record<string, string | null>>;
  placeOrder: (request: OrderRequestLike) => Promise<PlaceResultLike>;
  /** Shares of the asset the account holds, decimal string. */
  heldSize: (assetId: string, conditionId: string) => Promise<string>;
  tickMs?: number;
};

/** Typed failure the routes map to a status code. */
export class AutomationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

type Runtime = { hitKind: "TP" | "SL" | null; hits: number; throws: number };

const log = (level: "info" | "error", msg: string) => console[level](`[automation] ${msg}`);

export class AutomationEngine {
  private data: StoreFile | null = null;
  private loading: Promise<void> | null = null;
  private paused = false;
  private pausedReason: AutomationStateDTO["pausedReason"] = null;
  private ticking = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failuresInARow = 0;
  private saveChain: Promise<void> = Promise.resolve();
  private runtime = new Map<string, Runtime>();

  constructor(private readonly deps: EngineDeps) {}

  /** Loads the store once. Throws StoreCorruptError (not cached, so a repaired file is picked up). */
  ready(): Promise<void> {
    if (this.data) return Promise.resolve();
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const { data, recovered } = await loadStore(this.deps.file, this.deps.now());
    const hasArmed = data.rules.some((r) => r.status === "armed");
    // Every start is paused while anything is armed: unattended orders need an explicit resume.
    this.paused = hasArmed;
    this.pausedReason = hasArmed ? "startup" : null;
    data.paused = this.paused;
    this.data = data;
    if (recovered > 0) {
      log("error", `${recovered} rule(s) were interrupted while firing; marked error`);
      await this.persist();
    }
    this.start();
  }

  /** Idempotent: one timer per engine. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private store(): StoreFile {
    if (!this.data) throw new Error("automation engine not ready");
    return this.data;
  }

  private persist(): Promise<void> {
    const data = this.store();
    // Serialised, and the snapshot is taken when the write starts so the newest state always wins.
    const next = this.saveChain.then(() => {
      data.paused = this.paused;
      return saveStore(this.deps.file, data);
    });
    this.saveChain = next.catch(() => undefined);
    return next;
  }

  getState(): AutomationStateDTO {
    const data = this.store();
    return {
      paused: this.paused,
      pausedReason: this.pausedReason,
      rules: structuredClone([...data.rules].sort((a, b) => b.createdAt - a.createdAt)),
    };
  }

  async control(action: "pause" | "resume"): Promise<AutomationStateDTO> {
    this.store();
    if (action === "pause") {
      this.paused = true;
      this.pausedReason = "user";
    } else {
      this.paused = false;
      this.pausedReason = null;
      this.failuresInARow = 0;
    }
    await this.persist();
    log("info", `engine ${action}`);
    return this.getState();
  }

  async addRule(spec: NewRule): Promise<RuleDTO> {
    const data = this.store();
    const active = data.rules.filter((r) => r.status === "armed" || r.status === "firing").length;
    if (active >= MAX_ARMED_RULES) {
      throw new AutomationError(422, "TOO_MANY_RULES", `At most ${MAX_ARMED_RULES} rules can be active at once`);
    }
    const now = this.deps.now();
    const rule: RuleDTO = {
      id: crypto.randomUUID(),
      spec,
      status: "armed",
      error: null,
      createdAt: now,
      updatedAt: now,
      slicesDone: 0,
      // The first TWAP slice goes on the first tick after creation.
      nextAt: spec.kind === "TWAP" ? now : null,
      lastPrice: null,
      executions: [],
    };
    data.rules.push(rule);
    try {
      await this.persist();
    } catch (err) {
      data.rules.splice(data.rules.indexOf(rule), 1);
      throw err;
    }
    log("info", `rule ${rule.id} ${spec.kind} created`);
    return structuredClone(rule);
  }

  /** Armed -> cancelled; finished rules are removed; a rule mid-order cannot be touched. */
  async deleteRule(id: string): Promise<RuleDTO> {
    const data = this.store();
    const rule = data.rules.find((r) => r.id === id);
    if (!rule) throw new AutomationError(404, "NOT_FOUND", "Rule not found");
    if (rule.status === "firing") {
      throw new AutomationError(409, "RULE_FIRING", "An order for this rule is being placed right now");
    }
    if (rule.status === "armed") {
      rule.status = "cancelled";
      rule.nextAt = null;
      rule.updatedAt = this.deps.now();
      log("info", `rule ${id} ${rule.spec.kind} cancelled`);
    } else {
      data.rules.splice(data.rules.indexOf(rule), 1);
      log("info", `rule ${id} ${rule.spec.kind} removed`);
    }
    await this.persist();
    return structuredClone(rule);
  }

  private rt(id: string): Runtime {
    let r = this.runtime.get(id);
    if (!r) this.runtime.set(id, (r = { hitKind: null, hits: 0, throws: 0 }));
    return r;
  }

  /** One evaluation pass. Re-entrant calls are ignored. Never throws. */
  async tick(): Promise<void> {
    if (this.ticking || this.paused || !this.data) return;
    this.ticking = true;
    try {
      const armed = this.data.rules.filter((r) => r.status === "armed");
      if (armed.length === 0) return;
      let prices: Record<string, string | null>;
      try {
        prices = await this.deps.fetchMidpoints([...new Set(armed.map((r) => r.spec.assetId))]);
      } catch (err) {
        log("error", `price fetch failed: ${err instanceof Error ? err.name : "unknown"}`);
        return;
      }
      for (const rule of armed) {
        // Re-check: the user may have cancelled or paused while we awaited.
        if (this.paused) break;
        if (rule.status !== "armed") continue;
        await this.evaluate(rule, prices[rule.spec.assetId] ?? null);
      }
    } catch (err) {
      log("error", `tick failed: ${err instanceof Error ? err.name : "unknown"}`);
    } finally {
      this.ticking = false;
    }
  }

  private async evaluate(rule: RuleDTO, mid: string | null): Promise<void> {
    const spec = rule.spec;
    rule.lastPrice = mid;
    const now = this.deps.now();
    const state = this.rt(rule.id);

    if (spec.kind === "TPSL") {
      const hit = tpslHit(spec, mid);
      if (hit === null) {
        state.hitKind = null;
        state.hits = 0;
        return;
      }
      state.hits = state.hitKind === hit ? state.hits + 1 : 1;
      state.hitKind = hit;
      if (state.hits < CONFIRM_TICKS) return;
      await this.fireTpSl(rule, hit, now);
      return;
    }

    if (rule.nextAt === null || now < rule.nextAt) return;
    if (!priceAllows(spec, mid)) {
      this.record(rule, { at: now, what: this.sliceLabel(rule), ok: false, orderId: null, code: "SKIPPED_PRICE_LIMIT", message: mid === null ? "No midpoint available" : "Midpoint outside the price limit" });
      this.advanceTwap(rule, now);
      rule.updatedAt = now;
      await this.safePersist();
      return;
    }
    await this.fireTwapSlice(rule, now);
  }

  private sliceLabel(rule: RuleDTO): string {
    const spec = rule.spec;
    return spec.kind === "TWAP" ? `slice ${rule.slicesDone + 1}/${spec.slices}` : "";
  }

  private record(rule: RuleDTO, execution: Execution): void {
    rule.executions.push(execution);
  }

  /** After a slice was attempted (placed or skipped): count it and schedule the next or finish. */
  private advanceTwap(rule: RuleDTO, now: number): void {
    if (rule.spec.kind !== "TWAP") return;
    rule.slicesDone += 1;
    if (rule.slicesDone >= rule.spec.slices) {
      rule.status = "done";
      rule.nextAt = null;
      return;
    }
    const step = rule.spec.intervalSec * 1000;
    const next = (rule.nextAt ?? now) + step;
    // After a pause the schedule may be far behind: do not burst-fire the missed slices.
    rule.nextAt = next <= now ? now + step : next;
  }

  private async fireTpSl(rule: RuleDTO, hit: "TP" | "SL", now: number): Promise<void> {
    const spec = rule.spec;
    if (spec.kind !== "TPSL") return;
    const what = hit;
    let request: OrderRequestLike;
    try {
      const held = parseDecimal(await this.deps.heldSize(spec.assetId, spec.conditionId)) ?? 0n;
      if (held === 0n) {
        this.finishWithError(rule, { at: now, what, ok: false, orderId: null, code: "NO_SHARES", message: "No shares left to sell" }, "No shares left to sell");
        await this.safePersist();
        return;
      }
      const want = parseDecimal(spec.size) ?? 0n;
      request = {
        assetId: spec.assetId,
        conditionId: spec.conditionId,
        side: "SELL",
        type: "MARKET",
        size: formatDecimal(want < held ? want : held),
      };
    } catch (err) {
      await this.onThrown(rule, what, err);
      return;
    }
    await this.submit(rule, request, what);
  }

  private async fireTwapSlice(rule: RuleDTO, now: number): Promise<void> {
    const spec = rule.spec;
    if (spec.kind !== "TWAP") return;
    const amount = sliceAmounts(spec.total, spec.slices)?.[rule.slicesDone];
    const what = this.sliceLabel(rule);
    if (amount === undefined) {
      this.finishWithError(rule, { at: now, what, ok: false, orderId: null, code: "BAD_SLICES", message: "Cannot compute slice amounts" }, "Cannot compute slice amounts");
      await this.safePersist();
      return;
    }
    const base = { assetId: spec.assetId, conditionId: spec.conditionId, side: spec.side, type: "MARKET" as const };
    await this.submit(rule, spec.side === "BUY" ? { ...base, amount } : { ...base, size: amount }, what);
  }

  /** Persists "firing", places the order, records the outcome. */
  private async submit(rule: RuleDTO, request: OrderRequestLike, what: string): Promise<void> {
    const state = this.rt(rule.id);
    rule.status = "firing";
    rule.updatedAt = this.deps.now();
    let result: PlaceResultLike;
    try {
      await this.persist(); // must succeed BEFORE the order call
    } catch (err) {
      // Nothing was sent, so retrying next tick is safe.
      rule.status = "armed";
      await this.onThrown(rule, what, err);
      return;
    }
    try {
      log("info", `rule ${rule.id} ${rule.spec.kind} firing ${what}`);
      result = await this.deps.placeOrder(request);
    } catch (err) {
      // The venue may have accepted the order before the call failed (timeout, dropped
      // connection). Retrying could place it twice, so the rule stops instead (H13).
      const name = err instanceof Error ? err.name : "unknown";
      const at = this.deps.now();
      log("error", `rule ${rule.id} ${rule.spec.kind} ${what} threw ${name} during placement; stopping rule`);
      this.finishWithError(
        rule,
        { at, what, ok: false, orderId: null, code: "OUTCOME_UNKNOWN", message: name },
        `Order call failed (${name}); it may or may not have been placed — check Open orders and Trades before creating it again`,
      );
      this.countFailure();
      await this.safePersist();
      return;
    }

    const at = this.deps.now();
    state.throws = 0;
    if (result.ok) {
      this.failuresInARow = 0;
      this.record(rule, { at, what, ok: true, orderId: result.orderId, code: null, message: null });
      rule.status = "armed";
      if (rule.spec.kind === "TPSL") {
        rule.slicesDone = 1;
        rule.status = "done";
        rule.nextAt = null;
      } else {
        this.advanceTwap(rule, at);
      }
      log("info", `rule ${rule.id} ${rule.spec.kind} ${what} placed order ${result.orderId}`);
    } else {
      log("error", `rule ${rule.id} ${rule.spec.kind} ${what} refused: ${result.code}`);
      this.finishWithError(rule, { at, what, ok: false, orderId: null, code: result.code, message: result.message }, `${result.code}: ${result.message}`);
      this.countFailure();
    }
    rule.updatedAt = at;
    await this.safePersist();
  }

  private finishWithError(rule: RuleDTO, execution: Execution, message: string): void {
    this.record(rule, execution);
    rule.status = "error";
    rule.error = message;
    rule.nextAt = null;
    rule.updatedAt = execution.at;
  }

  /** A thrown error (network, rate limit): retry next tick, give up after repeated failures. */
  private async onThrown(rule: RuleDTO, what: string, err: unknown): Promise<void> {
    const state = this.rt(rule.id);
    const name = err instanceof Error ? err.name : "unknown";
    const at = this.deps.now();
    state.throws += 1;
    log("error", `rule ${rule.id} ${rule.spec.kind} ${what} threw ${name} (${state.throws}/${MAX_THROWS_PER_RULE})`);
    const execution: Execution = { at, what, ok: false, orderId: null, code: "THROWN", message: name };
    if (state.throws >= MAX_THROWS_PER_RULE) {
      this.finishWithError(rule, execution, `Failed ${MAX_THROWS_PER_RULE} times in a row (${name}) — check Open orders and Trades before creating it again`);
    } else {
      this.record(rule, execution);
      rule.status = "armed";
      rule.updatedAt = at;
    }
    this.countFailure();
    await this.safePersist();
  }

  private countFailure(): void {
    this.failuresInARow += 1;
    if (this.failuresInARow >= MAX_FAILURES_IN_A_ROW && !this.paused) {
      this.paused = true;
      this.pausedReason = "errors";
      log("error", `engine paused after ${this.failuresInARow} failed firings in a row`);
    }
  }

  private async safePersist(): Promise<void> {
    try {
      await this.persist();
    } catch (err) {
      log("error", `could not save rules: ${err instanceof Error ? err.name : "unknown"}`);
    }
  }
}
