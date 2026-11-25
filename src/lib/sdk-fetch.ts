/**
 * The fetch handed to every @polymarket/client instance.
 *
 * Node's built-in fetch sends `User-Agent: node`. Polymarket's data API answers that exact value with
 * an empty 429 on /v2/positions (any other value, even an empty one, gets 200), and the SDK turns the
 * 429 into RateLimitError, so Portfolio showed "Rate limited" on every load (H26, F46). This adds a
 * User-Agent naming the SDK when the request has none. It names no user, wallet or project.
 *
 * Nothing else changes: same URL, method, body and headers. CLOB/relayer HMAC signatures cover
 * timestamp, method, path and body, not headers, so adding one header leaves them valid.
 */

export const SDK_USER_AGENT = "@polymarket/client/0.18.0";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Wraps `base` (default: global fetch, read at call time so tests can stub it). */
export function withUserAgent(base?: Fetch): Fetch {
  return (input, init) => {
    const call = base ?? globalThis.fetch;
    // Headers from a Request object count too; init.headers wins when both are given, as in fetch().
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("user-agent")) headers.set("user-agent", SDK_USER_AGENT);
    return call(input, { ...init, headers });
  };
}

export const sdkFetch: Fetch = withUserAgent();
