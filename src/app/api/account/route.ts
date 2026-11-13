import { getAccount, respond } from "@/server/portfolio";

export const dynamic = "force-dynamic";

export function GET() {
  return respond(getAccount);
}
