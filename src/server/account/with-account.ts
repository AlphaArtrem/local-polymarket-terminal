import "server-only";
import { jsonError } from "@/lib/http";
import { LONG_POLL_MS, type OpKind } from "@/lib/wallet-protocol";
import { envelopeResponse } from "../wallet/operation";
import { currentSession, startOperation } from "../wallet/session";
import { getAccountMode, runWithAccount } from "./context";

type Options = { interactive?: Exclude<OpKind, "connect">; optional?: boolean };

/** Reads a handler's Response into the envelope's `{status, body}`. */
async function toResult(res: Response): Promise<{ status: number; body: unknown }> {
  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  try {
    return { status: res.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, body: text };
  }
}

/** Interactive handlers keep running after the first response, so buffer the body now. */
async function bufferRequest(req: Request): Promise<Request> {
  if (req.method === "GET" || req.method === "HEAD") return req;
  const body = await req.text();
  return new Request(req.url, { method: req.method, headers: req.headers, body });
}

/**
 * Binds a route handler to the right account. Key mode: the handler runs as before (no cookies, no
 * context). Wallet mode: the session's client is put in AsyncLocalStorage; without a session the
 * answer is 401, or the bare handler when `optional`. `interactive` runs the handler as a
 * user-started operation and answers with an envelope the browser completes via the wallet.
 */
export function withAccount<C>(
  handler: (req: Request, ctx: C) => Promise<Response>,
  opts: Options = {},
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    if (getAccountMode() === "key") return handler(req, ctx);

    const session = await currentSession();
    const account = session?.account ?? null;
    if (!session || !account) {
      if (opts.optional) return handler(req, ctx);
      return jsonError(401, "WALLET_NOT_CONNECTED", "Connect a browser wallet first");
    }
    const actx = { client: account.client, info: { source: account.source, gasless: account.gasless, relayerMismatch: account.relayerMismatch } };

    if (!opts.interactive) return runWithAccount(actx, () => handler(req, ctx));

    if (session.op) return jsonError(409, "OP_IN_PROGRESS", "Another wallet operation is in progress");
    const buffered = await bufferRequest(req);
    const op = startOperation(session, opts.interactive, () =>
      runWithAccount(actx, async () => toResult(await handler(buffered, ctx))),
    );
    return envelopeResponse(await op.next(LONG_POLL_MS));
  };
}
