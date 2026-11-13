/**
 * Host/Origin guard decision (invariant 2). Pure so it can be unit-tested and used from middleware.
 */
export type GuardInput = {
  method: string;
  host: string | null;
  origin: string | null;
  port: number;
};

export type GuardDecision = { allow: true } | { allow: false; reason: string };

export function decideRequest({ method, host, origin, port }: GuardInput): GuardDecision {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const h = host?.toLowerCase() ?? "";
  if (!allowedHosts.includes(h)) return { allow: false, reason: "host not allowed" };

  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return { allow: true };

  if (!origin) return { allow: false, reason: "origin required" };
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return { allow: false, reason: "origin malformed" };
  }
  if (originUrl.protocol !== "http:" || originUrl.host.toLowerCase() !== h) {
    return { allow: false, reason: "cross-origin request" };
  }
  return { allow: true };
}
