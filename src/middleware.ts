import { NextResponse, type NextRequest } from "next/server";
import { decideRequest } from "@/lib/guard";
import { jsonError } from "@/lib/http";

const port = Number(process.env.PORT) || 3737;

export function middleware(req: NextRequest) {
  const decision = decideRequest({
    method: req.method,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    port,
  });
  if (!decision.allow) return jsonError(403, "FORBIDDEN", decision.reason);
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
