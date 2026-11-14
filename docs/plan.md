# Plan

A local Polymarket trading terminal: a website-like UI on `127.0.0.1` that talks to Polymarket's
public APIs with the user's own wallet. All phases are built; [state.md](state.md) says what
exists. **Phases 0–10 are done; no further phase is planned.**

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

## Phase 6 — Charts and live data (slices G and H, parallel) — done 2026-11-14

**Goal:** the event page shows a price chart for the selected outcome with range buttons, and the
order book updates live (with recent trades), instead of a static snapshot.

Probed live on 2026-11-14 (record as external facts in slice G/H):

- `listPriceHistory({ assetId, interval }).firstPage()` works for every `PriceHistoryInterval`
  (`1h, 6h, 1d, 1w, 1m, max`); items are `{ timestamp (ms), price (decimal string),
  resolutionSeconds }`, oldest first, single page. Ian Buck: 1h 58 pts, 6h 358, 1d 1438, 1w 603,
  1m 100, max 5.
- `client.subscribe([{ topic: "market", assetIds: [id] }])` returns an async iterable with
  `close()`. It sends a full `book` snapshot within ~1.3 s, then `price_change` (per-level updates:
  `{ assetId, price, size, side }`, size 0 removes the level), `last_trade_price`, `tick_size_change`,
  and with `customFeatureEnabled` also `best_bid_ask`, `market_resolved`, `new_market`. A quiet
  market can send nothing else for 20 s+.

Contract: `src/lib/live-types.ts` (main session).

### Slice G — price history + chart (implementer)

Owner of: `src/server/history.ts`, `src/app/api/history/route.ts`, `src/lib/chart.ts`,
`src/components/market/PriceChart.tsx`, `src/components/market/chart.module.css`,
`tests/history*.test.ts`, `tests/chart*.test.ts`, `tests/fixtures/history-*.json`.

- Server: validate `assetId` (numeric) and `range`; map to the SDK interval; downsample to ≤ 500
  points; 30 s cache per (asset, range).
- `src/lib/chart.ts` (pure): scale points to an SVG viewBox, build the path, y-axis ticks in cents,
  x-axis labels per range, nearest-point lookup for hover.
- `PriceChart`: hand-written SVG (no new dependency), range buttons, hover crosshair + tooltip
  (price in cents, time), current price and change over the range, loading/empty/error states,
  responsive width.

### Slice H — live book + trade tape (implementer)

Owner of: `src/lib/book-state.ts`, `src/server/stream.ts`, `src/app/api/stream/route.ts`,
`src/components/market/useLiveBook.ts`, `src/components/market/OrderBook.tsx`,
`src/components/market/TradeTape.tsx`, `tests/stream*.test.ts`, `tests/book-state*.test.ts`.

- `book-state.ts` (pure): apply `book` snapshots and `price_change` updates to a book, derive
  midpoint and spread, output `BookDTO` (levels worst-first like `/api/book`).
- `/api/stream`: Next route handler returning a `ReadableStream` (SSE). One SDK subscription per
  request, closed on `request.signal` abort or error; throttled `book` events, `trade` events,
  15 s `ping`. Read `node_modules/next/dist/docs` for streaming responses in Next 16.
- `useLiveBook(assetId)`: `EventSource`; on error falls back to polling `/api/book` every 5 s and
  retries the stream with backoff. `OrderBook` uses it (briefly highlights changed levels) and
  shows a "live" / "polling" indicator. `TradeTape` lists the last ~30 prints.

### Main session

Integrate into `MarketView` (chart above the book, tape below it), full check, browser acceptance.

**Accept:** open the NVIDIA event → chart for the selected candidate with all six ranges and
hover; book shows "live" and changes without reloading; recent trades appear on an active market;
killing the network falls back to polling. `npm run check` green.

---

## Phase 7 — Redeem, cancel-all, price alerts (slices I, J, K, parallel) — done 2026-11-14

**Goal:** claim winnings on resolved markets, cancel all open orders (or all on one event) in one
click, and get a desktop notification when a price crosses a level you set.

SDK facts checked 2026-11-14 (type definitions + live call):

- `redeemPositions(client, { conditionId })` (from `@polymarket/client/actions`) redeems held
  positions in a resolved market and returns a `TransactionHandle` (`wait()` confirms). It is a
  gasless relayer transaction: needs the Relayer API key, like Enable trading (F14f).
- `cancelAllWalletOrders(client)` cancels every open order on a Deposit Wallet (any signer);
  `cancelAll(client)` cancels orders placed with this client's credentials (use it for EOA/Safe);
  `cancelMarketOrders(client, { market: conditionId })` cancels one market. All return
  `{ canceled: OrderId[], notCanceled: Record<OrderId, reason> }`.
- `fetchMidpoints([{ assetId }, …])` returns `{ [assetId]: "0.0945", … }` (an object argument is
  rejected with `UserInputError`).
- Positions already carry `redeemable` (`PositionDto.redeemable`).

Contract: `src/lib/phase7-types.ts` (main session).

### Slice I — redeem (implementer)

Owner of: `src/server/redeem.ts`, `src/app/api/redeem/route.ts`,
`src/components/dashboard/RedeemBanner.tsx`, `src/components/dashboard/RedeemButton.tsx`,
`src/components/dashboard/columns.tsx` (positions columns only), `tests/redeem*.test.ts`.

- Server: zod body; requires key + relayer key (reuse `RelayerKeyMissingError` /
  `RELAYER_KEY_REQUIRED`); refuses unless the account holds a redeemable position in that market;
  one redemption in flight per condition; waits for confirmation up to ~60 s, else `submitted`.
- UI: Redeem button on redeemable rows (Open positions); `RedeemBanner` above the dashboard tabs
  ("N resolved positions worth $X can be claimed" + Claim, one market at a time, with a confirm
  dialog naming each market and amount).

### Slice J — cancel-all (implementer)

Owner of: `src/server/orders/cancel-all.ts`, `DELETE` in `src/app/api/orders/route.ts`,
`src/components/CancelAllButton.tsx`, `src/components/market/YourOrders.tsx`,
`tests/cancel-all*.test.ts`.

- Server: Deposit Wallet → `cancelAllWalletOrders`, otherwise `cancelAll`; with
  `conditionIds` → `cancelMarketOrders` per id (validated `0x` + 64 hex, ≤ 50). Logs counts only.
- UI: `CancelAllButton` (props: optional `conditionIds`, `count`, `onDone`) with a confirm dialog
  stating how many orders; used in the event page's "Your orders" strip (this event only) and,
  wired by the main session, in the dashboard's Open orders tab (everything).

### Slice K — price alerts (implementer)

Owner of: `src/lib/alerts.ts`, `src/server/prices.ts`, `src/app/api/prices/route.ts`,
`src/components/alerts/*`, `src/app/alerts/page.tsx`, `src/components/Header.tsx`,
`src/app/layout.tsx`, `tests/alerts*.test.ts`, `tests/prices*.test.ts`.

- Pure `alerts.ts`: zod-validated localStorage schema (versioned, corrupt data → empty list),
  crossing detection (fires once when the midpoint moves past the threshold), add/remove/re-arm.
- `/api/prices` (batched `fetchMidpoints`, 10 s cache).
- `AlertsRunner` (mounted in the layout): polls `/api/prices` every 15 s while the tab is
  visible, fires the browser Notification (asks permission on first alert creation; falls back to
  an in-page toast) and marks the alert fired. `AlertButton` (props `assetId`, `label`,
  `eventSlug`, `currentPrice`) opens a small form (above/below, price in ¢). `/alerts` page lists,
  deletes and re-arms alerts. Header gets an "Alerts" link with a count of armed alerts.

### Main session

Wire `RedeemBanner` and `CancelAllButton` into the dashboard and `AlertButton` into the event page;
full check; browser acceptance; docs.

**Accept:** the dashboard shows Redeem only for redeemable rows (none today: the account has no
positions, so the flow is verified with mocked tests and the disabled state); "Cancel all" on the
dashboard and on an event shows a confirm with the right count and, with no orders, is disabled;
creating an alert on the NVIDIA page at a level just past the current price produces a
notification within ~15 s; `/alerts` lists, re-arms and deletes it. No order is placed or
cancelled by agents or by the main session — the user runs any live cancel/redeem.

---

## Phase 8 — GTD expiry, post-only, app-run TP/SL and TWAP (slices L, M, N, parallel) — done 2026-11-14

**Goal:** limit orders that expire at a set time or refuse to cross the book, and take-profit /
stop-loss and TWAP orders that this app executes for you while it runs.

SDK facts checked 2026-11-14 (external-facts F28): `placeLimitOrder` takes `expiration` (Unix
seconds, ≥ 3 min ahead → GTD) and `postOnly`. TP/SL and TWAP exist only for perps, so the local
server runs them itself — user decision 2026-11-14 ("app-run, while open"), hazard H13.

Contract: `src/lib/phase8-types.ts` (main session).

### Slice L — GTD + post-only (implementer)

Owner of: `src/server/orders/{body,validate,place}.ts`, `TradeTicket.tsx`, `mapOrder`,
`OrderDto`, `orderColumns`, matching tests. Expiry 5 min–365 days ahead, LIMIT only; post-only
rejected server-side when it would cross; ticket gets an Expires select and Post only checkbox;
Open orders gets an Expires column.

### Slice M — automation engine (implementer)

Owner of: `src/lib/automation.ts`, `src/server/automation/*`, `src/app/api/automation/**`, the
`AUTOMATION_ENABLED` / `AUTOMATION_FILE` env vars, `tests/automation*.test.ts`.

- Off unless `AUTOMATION_ENABLED=true`. Rules persist in `.data/automation.json` (gitignored,
  atomic writes; a corrupt file stops the engine instead of being overwritten).
- 5 s tick on midpoints. TP/SL needs the trigger on two consecutive checks, then sells
  min(size, held) at market. TWAP places one market slice per interval, skipping slices outside
  the optional price limit.
- Every order goes through `placeOrder`. A rule is saved as `firing` before the SDK call; an
  interrupted rule becomes `error` and is never re-fired. Refusals stop the rule; three thrown
  errors stop it; three failed firings in a row pause the engine. Every server start begins
  paused while rules are armed.

### Slice N — automation UI (implementer)

Owner of: `src/components/automation/**`, `src/app/automation/page.tsx`, `tests/automation-ui*`.
`AutomatePanel` on the event page (TP/SL for held outcomes, TWAP), `/automation` page (rules,
executions, pause/resume, cancel), `AutomationNavLink`. Confirm dialogs state exactly what will be
sold or bought without asking again.

### Main session

Wire the panel into `MarketView` and the nav link into the header; full check; browser
acceptance; docs.

**Accept:** a GTD/post-only limit order shows its expiry in the ticket confirm (the user places
any live one); with automation disabled the UI explains how to enable it; with it enabled, a
TP/SL rule and a TWAP rule can be created, show on `/automation`, survive a restart as paused,
and can be cancelled — no rule is allowed to fire by agents or the main session (triggers set far
from the price, engine paused).

---

## Phase 9 — Redesign, watchlist, shortcuts, CSV export, deposit (done 2026-11-14)

**Goal:** a modern trading-terminal look (dark graphite surfaces, mint Yes, coral No, Inter for
text and JetBrains Mono for numbers, both from local font stacks with no network fonts) and four
features from the design mockup.

**Redesign slices (R1 first, then R2–R4 in parallel):** R1 tokens, shared classes and header
(`globals.css`, `Header.tsx`, `NavLink`, `HeaderAccount`); R2 trade page (three-column workspace,
depth-bar book, segmented ticket); R3 browse (featured card, card grid); R4 portfolio, alerts and
automation pages (KPI tiles, tabbed tables).

**Feature slices (parallel, exclusive file ownership):**

- **W — Watchlist.** Stars on browse cards and the market strip; a Watchlist card in the browse
  rail with live midpoints and the change since starred. Browser-only (`pmterm.watchlist.v1`,
  cap 50, one `/api/prices` call every 15 s while visible).
- **K — Shortcuts.** ⌘K/Ctrl+K and `/` focus search, `g` then `b`/`p`/`a` navigate, `b`/`s`/`y`/`n`
  set the ticket and focus its first field, `?` opens help with a switch for single-key shortcuts
  (`pmterm.shortcuts.v1`). No shortcut submits, reviews or confirms anything, and single keys do
  nothing while any dialog is open.
- **E — Export.** "Export CSV" on each Portfolio tab walks every page of the existing GET routes
  (cap 2,000 rows) and downloads a CSV with formula-injection escaping.
- **D — Deposit.** `POST /api/deposit` asks Polymarket's bridge (F29, F30) for the account
  wallet's deposit addresses and shows the EVM one with Polygon USDC/USDC.e instructions and the
  live minimum. Never shows the signer or the account wallet as a target; no address on failure.
  The app sends no funds. No QR code (it would need a new dependency).

**Accept:** stars persist across reloads and prices update; shortcuts work and `s`/`n` change
nothing under an open confirm dialog; each export opens in a spreadsheet without formulas;
Deposit shows a checksummed bridge address that differs from both the wallet and the signer.

---

## Phase 10 — Browser wallet, optional keys, deposit QR, VPS docs (done 2026-11-15)

**Goal:** trade without a private key on disk, with the account found automatically, and run the
app on a VPS safely.

**Slices (S0 first, then S1–S5, S6 last):**

- **S0 — shared contract.** Wallet protocol types and error codes (`src/lib/wallet-protocol.ts`).
- **S1 — env, account resolution, key mode.** Optional key, wallet address and relayer key;
  account wallet from the profile (404 only falls back to EOA); explicit `wallet` on every
  `createSecureClient`; account context.
- **S2 — BridgeSigner, operations, session.** Server session with in-memory L2 credentials, an
  allowlisted signing relay to the browser, `/api/wallet/{session,ops}`.
- **S3 — routes by account type.** Approvals, redeem and deposit by account type (POL path for
  EOA); automation in key mode only.
- **S4 — browser wallet UI.** EIP-6963 discovery, Connect dialog, signing loop, gating.
- **S5 — deposit QR.** `uqr` in the Deposit dialog.
- **S6 — docs.** README (two ways to sign, account types, VPS), changelog, state, hazards H17–H23,
  facts F31–F41.

**Accept:** wallet mode without a key returns 401 `WALLET_NOT_CONNECTED` and the UI asks to connect;
key mode with the existing `.env.local` resolves the same account; `npm run check` passes and no SDK
code is in `.next/static`. The user does the live checks listed in state.md.

---

## Later phases

None planned. Candidates: trailing stops, order book depth chart, multi-account, WalletConnect.
