/** Parses whatever a user pastes into the search box into a typed lookup request. */

export type ParsedQuery =
  | { kind: "eventSlug"; slug: string }
  | { kind: "marketSlug"; slug: string; eventSlug?: string }
  | { kind: "id"; id: string }
  | { kind: "conditionId"; conditionId: string };

export type ParseResult = { ok: true; query: ParsedQuery } | { ok: false; reason: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
const NUMERIC_ID = /^\d+$/;
const CONDITION_ID = /^0x[0-9a-f]{64}$/i;
const HEX_PREFIXED = /^0x/i;
const URL_LIKE = /^(https?:\/\/)?(www\.)?polymarket\.com(\/|$|\?|#)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const fail = (reason: string): ParseResult => ({ ok: false, reason });
const ok = (query: ParsedQuery): ParseResult => ({ ok: true, query });

function parseUrl(input: string): ParseResult {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return fail("Could not read that as a URL");
  }
  // Query string and hash are ignored; only the path identifies the market.
  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  const [kind, first, second] = segments;
  if (segments.some((s) => s === null)) return fail("URL path contains invalid characters");
  if (kind !== "event" && kind !== "market") {
    return fail("Expected a polymarket.com/event/<slug> or /market/<slug> URL");
  }
  if (!first || !SLUG.test(first)) return fail("URL is missing a valid slug");
  if (kind === "market") return ok({ kind: "marketSlug", slug: first });
  if (!second) return ok({ kind: "eventSlug", slug: first });
  if (!SLUG.test(second)) return fail("URL has an invalid market slug");
  return ok({ kind: "marketSlug", slug: second, eventSlug: first });
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseQuery(input: string): ParseResult {
  const text = input.trim();
  if (!text) return fail("Enter a Polymarket URL, slug, id or condition id");
  if (URL_LIKE.test(text)) return parseUrl(text);
  if (ANY_SCHEME.test(text)) return fail("Only polymarket.com URLs are supported");
  if (CONDITION_ID.test(text)) return ok({ kind: "conditionId", conditionId: text.toLowerCase() });
  if (HEX_PREFIXED.test(text)) return fail("A condition id is 0x followed by 64 hex characters");
  if (NUMERIC_ID.test(text)) return ok({ kind: "id", id: text });
  if (SLUG.test(text)) return ok({ kind: "eventSlug", slug: text });
  return fail("Not a recognised URL, slug, id or condition id");
}
