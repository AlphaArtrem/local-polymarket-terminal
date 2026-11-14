import { randomUUID } from "node:crypto";
import {
  encodeJson,
  LONG_POLL_MS,
  OP_HEADER,
  OP_TIMEOUT_MS,
  SIGN_TIMEOUT_MS,
  type OpEnvelope,
  type OpKind,
  type PendingSign,
  type SignRequestKind,
  type WalletReply,
} from "@/lib/wallet-protocol";

type Result = WalletReply["result"];
type Done = { status: number; body: unknown };

/**
 * One interactive operation the user started (connect, order, approvals, redeem). It holds at most
 * one pending wallet request; the browser long-polls `next()` and answers through `reply()`.
 */
export class Operation {
  readonly id = randomUUID();
  private pending: {
    sign: PendingSign;
    resolve(r: Result): void;
    reject(e: unknown): void;
    timer: NodeJS.Timeout;
  } | null = null;
  private done: Done | null = null;
  private readonly waiters = new Set<() => void>();
  private readonly opTimer: NodeJS.Timeout;

  constructor(readonly kind: OpKind) {
    // A stuck operation (tab closed, wallet never answers) must not hold the session slot forever.
    this.opTimer = setTimeout(() => {
      this.settle({ status: 504, body: errorBody("OP_TIMEOUT", "The operation timed out") });
    }, OP_TIMEOUT_MS);
    this.opTimer.unref();
  }

  get finished(): boolean {
    return this.done !== null;
  }

  /** Parks one request for the browser. Rejects after SIGN_TIMEOUT_MS, or when the operation ends. */
  request(kind: SignRequestKind, payload: unknown, summary: string): Promise<Result> {
    if (this.done) return Promise.reject(new Error("Operation already finished"));
    if (this.pending) return Promise.reject(new Error("A wallet request is already pending"));
    const sign: PendingSign = { opId: this.id, requestId: randomUUID(), kind, summary, payload: encodeJson(payload) };
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("Timed out waiting for the wallet"));
        this.wake();
      }, SIGN_TIMEOUT_MS);
      timer.unref();
      this.pending = { sign, resolve, reject, timer };
      this.wake();
    });
  }

  /** Delivers the wallet's answer. Throws on a wrong opId or a requestId that is not pending. */
  reply(r: WalletReply): void {
    if (r.opId !== this.id) throw new Error("Unknown operation");
    const p = this.pending;
    if (!p || p.sign.requestId !== r.requestId) throw new Error("Unknown or already answered request");
    clearTimeout(p.timer);
    this.pending = null;
    p.resolve(r.result);
  }

  /** Ends the operation with the handler's response. Idempotent. */
  settle(result: Done): void {
    if (this.done) return;
    this.done = result;
    clearTimeout(this.opTimer);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error("Operation ended"));
      this.pending = null;
    }
    this.wake();
  }

  fail(err: unknown): void {
    const message = err instanceof Error ? err.message : "Operation failed";
    this.settle({ status: 500, body: errorBody("OP_FAILED", message) });
  }

  /** First of: a pending request, the final result, or `waitMs` elapsing ("working"). */
  next(waitMs: number = LONG_POLL_MS): Promise<OpEnvelope> {
    const now = this.snapshot();
    if (now) return Promise.resolve(now);
    return new Promise<OpEnvelope>((resolve) => {
      const check = () => {
        const s = this.snapshot();
        if (!s) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(s);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        resolve({ state: "working", opId: this.id });
      }, waitMs);
      this.waiters.add(check);
    });
  }

  private snapshot(): OpEnvelope | null {
    if (this.done) return { state: "done", opId: this.id, status: this.done.status, body: this.done.body };
    if (this.pending) return { state: "needs-wallet", pending: this.pending.sign };
    return null;
  }

  private wake(): void {
    for (const w of [...this.waiters]) w();
  }
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Envelope as an HTTP response: 202 while the operation runs, 200 once done. */
export function envelopeResponse(env: OpEnvelope): Response {
  return Response.json(env, {
    status: env.state === "done" ? 200 : 202,
    headers: { [OP_HEADER]: "1", "Cache-Control": "no-store" },
  });
}
