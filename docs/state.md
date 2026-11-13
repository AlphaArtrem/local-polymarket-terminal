# State

Edit in place. This file says what exists today, not what is planned (that is [plan.md](plan.md)).

## What exists

v1 is code-complete and waiting for the user's live test. `npm run check` passes (17 test files,
161 tests, build, client-bundle secret scan) on Node 24, 2026-11-13.

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
- **Phase 3 — trading.** Ticket (Buy/Sell, Yes/No, limit or market) with confirm dialog;
  `POST /api/orders`, `DELETE /api/orders/[id]`; server re-fetches market, book, access and held
  size, then `src/server/orders/validate.ts`; market orders carry `maxSpend` and a ±5¢ price
  bound (`src/server/orders/bounds.ts`); exact decimal math (`src/lib/decimal.ts`); cancel from
  the dashboard; market names on orders and trades.

Verified live without a key (2026-11-13): NVIDIA lookup by URL, market URL, condition id and id;
24 listed candidates; live order books; search routing; not-configured states; Host and Origin
rejections (403); order POST without key → 503.

**Not verified:** anything that needs the wallet — balances, positions, order placement,
cancel, close-only detection via `fetchClosedOnlyMode`, and the ticket's enabled state. No
order has ever been sent.

**Not built:** "Your orders" strip on the market page; Phase 4 hardening review.

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

## Invariants

Each names what breaks silently if violated.

1. **The private key never leaves the server process.** Violated → key in browser bundle or logs, account drained (H1). Enforced by: `server-only` import in `src/server/env.ts`; bundle grep in `npm run check`.
2. **Server binds to loopback and checks Host and Origin.** Violated → anything on the network can trade (H2). Enforced by: `dev`/`start` scripts and `middleware.ts`.
3. **Every order passes server-side validation before the SDK call.** Violated → off-tick rejections, oversized orders, opening orders while close-only (H3, H5, H8). Enforced by: `src/server/orders/validate.ts` with unit tests.
4. **Outcome → assetId mapping lives in one tested function.** Violated → orders on the wrong outcome (H4). Enforced by: `src/lib/market.ts` tests against the NVIDIA fixture.
5. **SDK version is exact-pinned.** Violated → silent breakage on install (H7). Enforced by: `package.json` review.

## Open questions

| # | Question | Blocks |
| - | - | - |
| Q2 | Which wallet type is your account (F12)? Need the account wallet address from the polymarket.com profile menu, plus the signer key. | Phase 1 acceptance with real data. |
| Q3 | Do you need gasless operations (redeem, approvals) in v1? They need a Relayer API key (F13). Planned: no. | Nothing in v1. |

## Next action

User acceptance test (README "First live test"): add `.env.local`, VPN off, `npm run doctor`,
check the dashboard against polymarket.com, then on one NVIDIA candidate place a 5-share limit
BUY far below the market, see it in Open orders, cancel it. Then Phase 4 hardening.
