# Plan

A local Polymarket trading terminal: a website-like UI on `127.0.0.1` that talks to Polymarket's
public APIs with the user's own wallet. Phases 0–3 are built; [state.md](state.md) says what
exists. **Phases 0–5 are done; next is Phase 6 (charts and live data).**

Each phase ends in a **demonstration**, not just green tests. Slices are sized for one
implementer agent each, with explicit file ownership so parallel slices never touch the same file.

## Architecture (planned)

```
Browser (React, client components)
   │  fetch /api/*      ← no secrets ever reach this side
   ▼
Next.js route handlers (server, 127.0.0.1 only, Host/Origin checked in middleware.ts)
   │
   ├─ src/server/env.ts         zod-validated env, `server-only`
   ├─ src/server/polymarket.ts  PublicClient (no key) + lazy SecureClient (key)
   ├─ src/server/access.ts      geoblock + close-only status
   └─ src/server/orders/        validate.ts (pure) + place.ts (SDK call)
   │
   ▼
@polymarket/client 0.18.0  →  Gamma, CLOB, Data API v2 (external-facts.md)
```

### Directory layout

```
.nvmrc                      24
.env.example                committed, no values
.env.local                  user's secrets, gitignored
middleware.ts               Host/Origin guard
scripts/doctor.ts           prints account + access status, read-only
scripts/check-bundle.mjs    fails if signer address or key fragments appear in .next/static
src/server/                 server-only modules (env, clients, access, orders)
src/lib/                    pure, shared logic (search parsing, market mapping, formatting)
src/app/                    pages and /api route handlers
src/components/             client UI components
tests/                      vitest; tests/fixtures/nvidia-event.json from live Gamma
```

### Environment

| Variable | Required for | Notes |
| - | - | - |
| `POLYMARKET_PRIVATE_KEY` | wallet features | Signer key, `0x` + 64 hex. |
| `POLYMARKET_WALLET_ADDRESS` | wallet features | Account wallet from polymarket.com profile menu. May differ from the signer address. |
| `POLYMARKET_RELAYER_API_KEY` + `_ADDRESS` | Enable trading | Relayer API key and its Signer Address (external-facts F14f). Set both or neither. |
| `POLYGON_RPC_URL` | wallet operations | Default publicnode; must accept JSON-RPC batches over 10 (F14g). |
| `MAX_ORDER_USDC` | trading | Server-side cap per order, default `25`. |
| `PORT` | — | Default `3737`. |

Missing key → app still runs; wallet panels show "not configured".

## API routes (planned)

| Route | Method | Returns | Needs key |
| - | - | - | - |
| `/api/access` | GET | `{ geoblock: {blocked,country,region}, closedOnly: boolean \| null, configured: boolean }` | no (closedOnly needs key) |
| `/api/account` | GET | wallet + signer address, wallet type, pUSD balance, portfolio value | yes |
| `/api/positions?status=OPEN\|CLOSED` | GET | positions page | yes |
| `/api/trades?cursor=` | GET | account trades page | yes |
| `/api/activity?cursor=` | GET | activity page | yes |
| `/api/orders` | GET | open orders | yes |
| `/api/orders` | POST | place order (validated) | yes |
| `/api/orders/[id]` | DELETE | cancel order | yes |
| `/api/approvals` | GET, POST | trading-approval state; POST submits the one-time approvals (user-confirmed) | yes |
| `/api/lookup?q=` | GET | event + markets resolved from any accepted input | no |
| `/api/book?assetId=` | GET | order book, midpoint, tick size | no |

All handlers validate query/body with zod and return `{ error: { code, message } }` on failure
with a correct status. SDK errors map through the action error guards (external-facts F18).

---

## Phase 0 — Foundation (slice A)

**Goal:** an app that boots on Node 24, loads env safely, and proves it can see the account.

Slice A — owner of: `package.json`, `.nvmrc`, `.gitignore`, `.env.example`, `tsconfig.json`,
`next.config.ts`, `vitest.config.ts`, `eslint` config, `middleware.ts`, `src/server/env.ts`,
`src/server/polymarket.ts`, `src/server/access.ts`, `src/app/layout.tsx`, `src/app/page.tsx`
(placeholder), `src/app/globals.css`, `src/app/api/access/route.ts`, `scripts/doctor.ts`,
`scripts/check-bundle.mjs`, tests for env and middleware.

- Install Node 24 with nvm; pin `@polymarket/client@0.18.0` and `viem` exactly.
- Scripts: `dev` and `start` bind `-H 127.0.0.1 -p ${PORT:-3737}`; `test` (vitest), `lint`,
  `typecheck`, `build`, `check` (= typecheck + lint + test + build + check-bundle), `doctor`.
- `env.ts`: zod schema, key optional, helpful error when malformed; never logs values.
- `polymarket.ts`: `getPublicClient()` and `getSecureClient()` (lazy, memoised, throws
  `NotConfiguredError` without key).
- `access.ts`: geoblock fetch (5 s timeout) + `fetchClosedOnlyMode` when configured.
- `middleware.ts`: Host allow-list and same-Origin for non-GET (invariant 2).
- Base layout: header with app name, search box placeholder, access badge
  (OK / CLOSE-ONLY / BLOCKED / NOT CONFIGURED).
- Dark, dense "terminal" visual style with CSS variables; no UI framework.

**Accept:** `npm run check` passes; `npm run doctor` without a key prints geoblock status and
"wallet not configured"; with a key it prints wallet type, addresses, pUSD balance and
close-only mode. `curl -H "Host: evil.com" 127.0.0.1:3737/api/access` → 403.

## Phase 1 — Wallet dashboard (slice B, parallel with C)

**Goal:** see balance, portfolio, open orders and history without leaving the terminal.

Slice B — owner of: `src/app/api/{account,positions,trades,activity}/route.ts`,
`src/app/api/orders/route.ts` (GET only; slice D adds POST), `src/app/page.tsx`,
`src/components/dashboard/*`, `src/lib/format.ts`, their tests.

- Dashboard on `/`: balance card (pUSD), portfolio value, unrealized/realized PnL; tabs for
  Open positions, Closed positions, Open orders, Trade history, Activity.
- Each table paginates with the cursor ("Load more"); rows link to `/market/<event-slug>` when
  the slug is known.
- Manual refresh button plus 30 s polling while the tab is visible.
- Not-configured state explains which env vars to set.

**Accept:** with the user's `.env.local`, the dashboard shows the same balance, positions and
recent trades as the user's polymarket.com profile (user verifies). Route tests cover
validation, not-configured (→ 503 with code `NOT_CONFIGURED`), and SDK error mapping.

## Phase 2 — Market lookup (slice C, parallel with B)

**Goal:** paste anything that identifies a market and see it like the website does.

Slice C — owner of: `src/lib/search.ts`, `src/lib/market.ts`, `src/app/api/lookup/route.ts`,
`src/app/api/book/route.ts`, `src/app/market/[slug]/page.tsx`, `src/components/market/*`
(except `TradeTicket`), `src/components/SearchBar.tsx`, `tests/fixtures/nvidia-event.json`,
their tests.

- `parseQuery(input)` accepts: full URL `https://polymarket.com/event/<slug>[/<market-slug>]`
  (with or without query string), bare event slug, market slug, numeric Gamma event or market
  id, `0x` condition id. Returns a tagged union; unit tests cover each form.
- Lookup resolves event-first, falls back to market; a market resolves to its parent event.
- `toOutcomes(market)` (invariant 4): decodes JSON-string fields, returns
  `[{ label, assetId, price }]`, handling V2 `positionId`.
- Event page `/market/[slug]`: title, image, end date, volume, list of outcome markets sorted
  by price (107 for NVIDIA; client-side filter box), each row with Yes/No prices. Selecting a
  row opens the order book (bids/asks, midpoint, spread) for its Yes token, toggle to No.
  A right-hand column reserves space for the trade ticket (slice D).
- Search bar in the header navigates to the event page.

**Accept:** pasting `https://polymarket.com/event/next-ceo-of-nvidia` shows "Next CEO of
NVIDIA?" with all its candidate markets and a live order book for any of them, with no key set.

## Phase 3 — Trading (slice D, after B and C)

**Goal:** place and cancel orders on a looked-up market, safely.

Slice D — owner of: `src/server/orders/{validate,place}.ts`, POST in
`src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`,
`src/components/market/TradeTicket.tsx`, `src/components/ConfirmDialog.tsx`, cancel button in
the dashboard open-orders table, their tests.

- Ticket: Buy/Sell, outcome (Yes/No), order type Limit or Market. Limit: price (snapped to
  tick) and shares. Market: pUSD amount for BUY, shares for SELL. Shows estimated cost, payout
  if right, and the held size for SELL.
- `validate.ts` (pure, fully unit-tested): zod body; tick snap and min size (H5); cost ≤
  `MAX_ORDER_USDC` (H8); market `acceptingOrders`; close-only → only SELL ≤ held size, geoblock
  blocked-completely → refuse all (H3).
- `place.ts`: re-fetches tick size, access status and held size server-side (never trusts the
  client), calls `placeLimitOrder` / `placeMarketOrder`, returns order id; for fills, waits for
  settlement in the background and the UI shows "settling" (H6).
- Confirm dialog shows question, outcome, side, shares, price, total, and the access mode.
- Cancel from the dashboard and from the market page's "Your orders" strip.
- Tests mock the SDK. **No real order is ever placed by tests or agents.**

**Accept (user performs):** on an eligible account, place a 5-share limit BUY far below the
market on one NVIDIA candidate, see it in Open orders, cancel it, see it gone. In close-only
mode the ticket disables BUY and explains why.

## Phase 4 — v1 hardening (main session) — done 2026-11-14

Approvals flow, relayer key, RPC override, README setup guide, MIT license, public repo; live test
passed (order placed and cancelled, which exposed and fixed H11); "Your orders" strip on the event
page (the missing Phase 3 item); Enable trading re-checks the lagging approval state; clean clone
from GitHub → `npm ci` → `npm run check` green (172 tests); security pass (env read only in
`env.ts`, no `NEXT_PUBLIC_`, `server-only` on every SDK/env module, 127.0.0.1 bind, Host +
same-Origin guard on all three mutating routes, no secret logging).

---

## Phase 5 — Browse (slices E and F, parallel) — done 2026-11-14

**Goal:** open the terminal and find markets the way the website's home page allows: trending,
new, ending soon, by category, and by keyword, then click through to the existing event page
and trade. No key is needed for anything in this phase.

Probed live on 2026-11-14 with `createPublicClient()` (record as external facts in slice E):

- `listEvents({ order, ascending: false, closed: false, pageSize }).firstPage()` works with
  `order: "volume24hr"` and `"createdAt"`. Events carry `metrics`, `state`, `schedule`,
  `display`, `tags` and `markets`; volume lives under `metrics`, not top-level.
- `createdAt` order is dominated by auto-generated 5-minute crypto "up/down" events
  (`xrp-updown-5m-…`); **New** must exclude recurring series (`recurrence`, `series`) or it is
  useless (new hazard H10).
- `listTags({ isCarousel: true })` returns one tag (`ai`), so it cannot drive the category bar.
  Use a curated list of tag slugs, each verified with `fetchTag({ slug })` in a test fixture.
- `search({ q })` is paginated (`firstPage()`), returning events, profiles and tags.
- negRisk events still contain inactive placeholder markets (F14d); reuse the `listed` rule.

### Shared contract (written first by the main session, owned by neither slice)

`src/lib/browse-types.ts`:

```ts
export type BrowseSort = "trending" | "new" | "ending";
export type EventCard = {
  id: string; slug: string; title: string; image: string | null;
  volume24h: string | null; liquidity: string | null; endDate: string | null;
  marketCount: number;               // listed markets only
  top: { label: string; price: string | null }[]; // up to 2 best listed outcomes, or Yes/No for binary
};
export type Category = { slug: string; label: string };
export type BrowsePage = { items: EventCard[]; nextCursor: string | null };
```

Routes: `GET /api/events?sort=&tag=&cursor=` → `BrowsePage`; `GET /api/categories` →
`Category[]`; `GET /api/search?q=&cursor=` → `BrowsePage`. All zod-validated (`sort` enum, `tag`
from the curated list only, `q` 1–100 chars), errors in the standard envelope.

### Slice E — server (implementer)

Owner of: `src/server/browse.ts`, `src/lib/categories.ts`, `src/lib/event-card.ts`,
`src/app/api/{events,categories,search}/route.ts`, `tests/browse*.test.ts`,
`tests/fixtures/browse-*.json`, `docs/external-facts.md` (new F21+ rows).

- `toEventCard(event)` (pure): picks volume and liquidity from `metrics`, applies the `listed`
  rule, chooses top outcomes by price, formats prices as decimal strings. Fixture-tested with a
  binary event, a negRisk event with placeholders, and an event with no image.
- Sorts: trending = `volume24hr` desc, active, not closed; new = `createdAt` desc minus recurring
  series; ending = `endDate` ascending with `endDateMin` = now, not closed.
- Curated categories (Politics, Sports, Crypto, Tech, AI, Economy, World, Culture or as verified),
  fetched slugs checked in a test against a recorded `fetchTag` fixture.
- Short in-memory cache (30–60 s) per `(sort, tag, cursor)` to stay well under rate limits; map
  `RateLimitError` to 429.

### Slice F — UI (implementer)

Owner of: `src/app/page.tsx`, `src/app/portfolio/page.tsx` (new), `src/components/browse/*`,
`src/components/Header.tsx`, `src/components/SearchBar.tsx`, their tests.

- Home `/` becomes Browse; the wallet dashboard moves to `/portfolio`, linked from the header
  next to the access badge.
- Category chips + sort tabs (Trending / New / Ending soon), a dense list of event rows (image,
  title, top outcomes with prices, 24h volume, end date, market count), **Load more** paging.
- Search bar: inputs that `parseQuery` recognises still jump straight to the event page; free text
  shows search results in the Browse list (`?q=`), debounced, with an empty state.
- Images: plain `<img>` with `referrerPolicy="no-referrer"`, lazy loading, fixed size.
- State in the URL (`?sort=&tag=&q=`) so views are shareable and survive refresh.

**Accept:** with no key set, open `/` → trending events appear; click **Crypto** → only crypto
events; switch to **New** → no 5-minute up/down spam; type "nvidia" → "Next CEO of NVIDIA?" is
listed; click it → the existing event page with a live order book. `npm run check` green.

---

## Later phases (not v1)

| Phase | Scope |
| - | - |
| 6 | Price charts (`listPriceHistory`), live books and fills over WebSocket (humanplane/terminal does this well; see state.md). |
| 7 | Redeem resolved positions (relayer key now in place), cancel-all, price alerts. |
| 8 | Order types beyond v1: GTD expiry, TWAP, take-profit/stop-loss (`placePositionTpSl`). |
