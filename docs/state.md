# State

Edit in place. This file says what exists today, not what is planned (that is [plan.md](plan.md)).

## What exists

v1 is live-tested with a real wallet (order placed and cancelled, 2026-11-14). `npm run check` passes (18 test files,
171 tests, build, client-bundle secret scan) on Node 24, 2026-11-14.

- **Phase 0 — foundation.** Next.js 16 on Node 24; env parsing (`src/lib/parse-env.ts`,
  `src/server/env.ts`); SDK clients (`src/server/polymarket.ts`); trading mode from the API
  jurisdiction table (`src/lib/jurisdiction.ts`) plus `fetchClosedOnlyMode`; `/api/access`;
  Host/Origin guard (`src/middleware.ts`); header access badge; `npm run doctor`.
- **Phase 1 — wallet dashboard** (`/`): pUSD balance, portfolio value, PnL; tabs for open and
  closed positions, open orders, trade history, activity; cursor paging; 30 s refresh while
  visible. Routes `/api/{account,positions,trades,activity,orders}`, logic in
  `src/server/portfolio.ts`.
- **Phase 2 — market lookup.** Search bar accepts event or market URL, slug, numeric id or
  condition id (`src/lib/search.ts`); `/api/lookup`, `/api/book`; event page
  `/market/[slug]` with outcome list (inactive negRisk placeholders hidden behind a toggle),
  live order book, `?asset=` preselect.
- **Trading approvals.** Dashboard notice with an **Enable trading** button while the wallet
  lacks its approvals (F14f); `GET/POST /api/approvals`, logic in `src/server/approvals.ts`,
  one setup in flight at a time. Needs `POLYMARKET_RELAYER_API_KEY` + `_ADDRESS` (F14f) and an RPC
  that accepts large batches (`POLYGON_RPC_URL`, F14g). Wallet funded with 5 pUSD; approvals set
  through the dashboard on 2026-11-14 (`isFullyApproved: true`; the state lagged a few seconds).
- **Phase 3 — trading.** Ticket (Buy/Sell, Yes/No, limit or market) with confirm dialog;
  `POST /api/orders`, `DELETE /api/orders/[id]`; server re-fetches market, book, access and held
  size, then `src/server/orders/validate.ts`; market orders carry `maxSpend` and a ±5¢ price
  bound (`src/server/orders/bounds.ts`); exact decimal math (`src/lib/decimal.ts`); cancel from
  the dashboard and from the event page's "Your orders" strip; market names on orders and trades.

- **Phase 5 — browse** (`/`): trending / new / ending-soon, curated categories (tag slugs → ids,
  `src/lib/categories.ts`), keyword search; `src/server/browse.ts` (45 s cache, `excludeTagIds`
  for recurring events), pure `toEventCard` (`src/lib/event-card.ts`), routes
  `/api/{events,categories,search}`, UI in `src/components/browse/`; dashboard at `/portfolio`.

- **Phase 6 — charts and live data** (event page): `PriceChart` (hand-written SVG, pure math in
  `src/lib/chart.ts`, `/api/history` with 30 s cache and ≤ 500 points); live book via
  `/api/stream` (SSE from one SDK market subscription per viewer, pure book reducer in
  `src/lib/book-state.ts`, `book` ≤ 4/s, `trade`, 15 s `ping`); `useLiveBook` shares one
  EventSource per asset and falls back to polling `/api/book`; `TradeTape`; contract
  `src/lib/live-types.ts`.

- **Phase 7 — redeem, cancel-all, alerts.** `POST /api/redeem` (`src/server/redeem.ts`: relayer
  key required, only when a redeemable position exists → else 409 `NOTHING_TO_REDEEM`, one in flight
  per market, 60 s confirmation wait); `RedeemButton` on redeemable rows + `RedeemBanner`.
  `DELETE /api/orders[?conditionIds=]` (`src/server/orders/cancel-all.ts`: Deposit Wallet →
  `cancelAllWalletOrders`, else `cancelAll`; per market `cancelMarketOrders`); `CancelAllButton` on
  the dashboard and the event's "Your orders". Price alerts in `localStorage`
  (`pmterm.alerts.v1`, `src/lib/alerts.ts`), `AlertsRunner` in the layout polls `/api/prices`
  every 15 s, Notification or in-page toast, `/alerts` page, header count. Contract
  `src/lib/phase7-types.ts`.

- **Phase 8 — GTD, post-only, app-run TP/SL and TWAP.** `expiresAt` (Unix s, 5 min–365 d) and
  `postOnly` on LIMIT orders (`validate.ts`: rejects crossing post-only); ticket Expires select and
  Post only; `OrderDto.expiresAt` from the SDK's ISO `expiresAt`. Automation: pure
  `src/lib/automation.ts`, `src/server/automation/{store,engine,runtime}.ts` (globalThis singleton,
  5 s tick on fresh midpoints, 2-tick TP/SL confirmation, write-ahead `firing`, startup pause,
  rule stops on refusal or a throw from the order call, 3 failures in a row pause the engine),
  `/api/automation{,/rules,/rules/[id],/control}` behind `AUTOMATION_ENABLED`; UI
  `src/components/automation/*`, `/automation`, header link. Contract `src/lib/phase8-types.ts`.

Verified live without a key (2026-11-13): NVIDIA lookup by URL, market URL, condition id and id;
24 listed candidates; live order books; search routing; not-configured states; Host and Origin
rejections (403); order POST without key → 503.

**Not verified:** anything that needs the wallet — balances, positions, order placement,
cancel, close-only detection via `fetchClosedOnlyMode`, and the ticket's enabled state. No
order has ever been sent.

**Not built:** nothing planned beyond Phase 8.

## Settled decisions

| Decision | Why |
| - | - |
| Local web app: Next.js (App Router) + TypeScript, one process, run on `127.0.0.1`. | Gives the website-like UI the user wants, and server route handlers keep the key off the browser without a second service. |
| Use the official `@polymarket/client` SDK, pinned to `0.18.0`, with `viem` signer. | It handles L1/L2 auth, order signing, wallet types and V2 market ids (external-facts F10–F17); hand-rolling EIP-712 order signing is the riskiest code we could write. |
| Node 24 (via nvm, `.nvmrc`). | SDK requires it (F9). |
| Public market data works without a key; wallet features need `.env.local`. | Market lookup can be built and tested before the user supplies credentials. |
| Trading is guarded server-side: geoblock and close-only check, tick and min-size validation, `MAX_ORDER_USDC` cap, confirm dialog. | Hazards H3, H5, H8. |
| No VPN, proxy, or remote-host workaround for jurisdiction limits. | Breaches Polymarket's terms; see H3. |
| v1 opens and closes positions. Trading mode comes from the API jurisdiction table (`src/lib/jurisdiction.ts`) plus `fetchClosedOnlyMode`, never from geoblock's `blocked` flag. | User confirmed the earlier `AR` reading was their VPN (2026-11-13). Geoblock's `blocked` describes the website: IE reported `blocked: true` though IE is API-open (F1, F3). |
| No real orders are placed by agents or tests. Order placement is mocked in tests; live order tests are done by the user. | Real money. |
| TP/SL and TWAP run in this app (opt-in `AUTOMATION_ENABLED`), not natively, and only while the server runs. | Polymarket offers them only for perps (F28); user chose app-run on 2026-11-14. Risks in H13. |

## Invariants

Each names what breaks silently if violated.

1. **The private key never leaves the server process.** Violated → key in browser bundle or logs, account drained (H1). Enforced by: `server-only` import in `src/server/env.ts`; bundle grep in `npm run check`.
2. **Server binds to loopback and checks Host and Origin.** Violated → anything on the network can trade (H2). Enforced by: `dev`/`start` scripts and `middleware.ts`.
3. **Every order passes server-side validation before the SDK call.** Violated → off-tick rejections, oversized orders, opening orders while close-only (H3, H5, H8). Enforced by: `src/server/orders/validate.ts` with unit tests.
4. **Outcome → assetId mapping lives in one tested function.** Violated → orders on the wrong outcome (H4). Enforced by: `src/lib/market.ts` tests against the NVIDIA fixture.
5. **SDK version is exact-pinned.** Violated → silent breakage on install (H7). Enforced by: `package.json` review.
6. **Automation never re-fires an order whose outcome is unknown.** Violated → duplicate unattended orders (H13). Enforced by: `firing` persisted before the SDK call, interrupted and thrown placements end the rule; `tests/automation-engine.test.ts`.

## Open questions

| # | Question | Blocks |
| - | - | - |
| Q3 | Do you need gasless operations (redeem, approvals) in v1? They need a Relayer API key (F13). Planned: no. | Nothing in v1. |

## Next action

Phase 8 accepted in the browser on 2026-11-14 on a separate server with automation enabled and
the engine paused: ticket shows Expires and Post only; a TP/SL rule (99¢ / 1¢) was armed through
the confirm dialog with the held size prefilled; API rejected a trigger already met, a size over
the holding and a TWAP slice over the cap; a TWAP rule (1¢ limit) was created; both survived a
restart as paused (`startup`); `/automation` showed them, cancelled and removed them; the
default server shows the "switched off" explanation. The engine was never resumed, so no rule
fired — live firing is untested until the user enables it. No further phases planned.
