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

- **Phase 9 — Redesign, watchlist, shortcuts, export, deposit.** Tokens and shared classes in
  `src/app/globals.css` (legacy variable names kept as aliases); `Header` with `NavLink`,
  `HeaderAccount`, `?` help button. Watchlist: `src/lib/watchlist.ts`,
  `src/components/watchlist/*`, localStorage `pmterm.watchlist.v1` (cap 50), polls `/api/prices`
  every 15 s while visible. Shortcuts: pure `src/lib/shortcuts.ts`, `ShortcutsProvider` in the
  layout (one keydown listener; ticket actions via the `pmterm:shortcut` window event, help via
  `pmterm:open-help`), localStorage `pmterm.shortcuts.v1`. Export: `src/lib/{csv,export}.ts`,
  `ExportCsvButton` (walks pages, cap 40 × 50 rows). Deposit: `src/lib/deposit.ts`,
  `src/server/deposit.ts`, `POST /api/deposit` (bridge EVM address for the account wallet; 409
  `WALLET_CONFIG`, 502 `BAD_UPSTREAM` with no address), `src/components/deposit/*`.

- **Phase 10 — browser wallet, optional keys, QR.** Two exclusive modes: key mode
  (`POLYMARKET_PRIVATE_KEY` set; server signs) and wallet mode (blank; EIP-6963 wallet signs, the
  server keeps the session and L2 credentials in memory under an HttpOnly SameSite=Strict cookie,
  one session, one operation at a time). Account wallet resolved from the profile (404 → plain
  EOA), optional `POLYMARKET_WALLET_ADDRESS` override, source shown in the wallet-mode header chip
  and by `npm run doctor` in key mode. Relayer key optional: EOA accounts use the POL path (approvals, redeem; start needs
  0.02 POL) even in key mode with a relayer key; Safe and Deposit Wallet accounts need the key.
  Routes `/api/wallet/{session,ops/[id]}`; codes `WALLET_NOT_CONNECTED` 401, `NEEDS_POL` 409,
  `AUTOMATION_NEEDS_KEY` 403, `KEY_MODE` 409, `OP_IN_PROGRESS` 409, and in the connect envelope
  `USER_REJECTED` 403, `ACCOUNT_LOOKUP_FAILED` 503, `WALLET_CONFIG` 409, `CONNECT_FAILED` 500.
  Root layout is force-dynamic (mode read per request). Deposit QR: `uqr` 0.1.3, fixed black on
  white; `jsqr` 1.4.0 (dev) round-trip test. README has the VPS guide.
- **Phase 11 — app matches the design canvas** (claude.ai artifact BUokYHENKXK3Rtfsy8mPvN, the
  source of truth for UI). Header: Markets · Portfolio · Alerts · Automation, cash amount only,
  Deposit button and account menu on every page, no access chip (access still drives the ticket).
  Trade page: breadcrumb, Market | Limit | Pro ticket (automation moved into Pro), order book and
  trades fill the column, per-event bottom tabs, order confirm with BUY/SELL tag and a success toast.
  Markets: featured card with a 1-week chart, card Buy links preselect the Yes outcome, Watchlist /
  Your book / Shortcuts rail. Portfolio: banners, KPI tiles, Enable trading and Deposit as dialogs
  (wallet mode shows "transaction k of n" from `useWallet().requestCount`). Alerts and Automation
  redesigned. Shortcut chord `g m` replaces `g b`. No emoji in the UI.

Verified in the browser on a production build (2026-11-15). Wallet mode, no key: `/api/account`
and `POST /api/approvals` return 401 `WALLET_NOT_CONNECTED`; the Connect dialog says no wallet is
detected without an extension and lists an announced EIP-6963 stub wallet; rejecting in the wallet
shows "Request rejected in the wallet." and creates no session; the ticket says "Connect a browser
wallet to trade"; no overflow at 375 px. Key mode with the user's `.env.local`: same account
wallet as before (type DEPOSIT_WALLET, source env, gasless, approvals done); `POST
/api/wallet/session` → 409 `KEY_MODE`; the Deposit dialog shows the QR under the bridge address.
`npm run check` passes (50 test files, 532 tests, build, bundle scan of 27 files) and no SDK code
is in `.next/static`.

**Phase 10 not verified:** connecting and signing with a real extension; a browser-signed order;
EOA approvals paid in POL (count, real cost, whether 0.02 / 0.2 POL are sensible); an EOA redeem;
scanning the QR with a phone; the VPS walkthrough; `npm run doctor` without
`POLYMARKET_WALLET_ADDRESS`; whether the bridge credits an EOA account wallet; whether
`public-profile` returns a wallet for EOA-only traders.

Verified live without a key (2026-11-13): NVIDIA lookup by URL, market URL, condition id and id;
24 listed candidates; live order books; search routing; not-configured states; Host and Origin
rejections (403); order POST without key → 503.

**Not verified:** anything that needs the wallet — balances, positions, order placement,
cancel, close-only detection via `fetchClosedOnlyMode`, and the ticket's enabled state. No
order has ever been sent.

**Phase 12 (withdraw, 2026-11-16):** built and checked in key mode against the live bridge
without sending: `GET /api/withdraw` returned the balance, path "gasless" and six chains; a $5
Polygon USDC quote returned ≈4.9998 USDC, $0.024 fees, ~27 s; the dialog refuses the trading wallet
as recipient, shows the quote and the review, and fits 375 px. **Not verified:** a real withdrawal
(`POST /bridge/withdraw` has never been called), wallet-mode signing of the transfer, the EOA POL
path, and whether `minCheckoutUsd` is the real withdrawal minimum (F44).

**Not built:** nothing planned beyond Phase 12. Not supported: WalletConnect or mobile wallets; approvals or redeem for Safe/Deposit Wallet accounts without a relayer key (use polymarket.com); undeployed smart-wallet accounts (refused, never deployed implicitly); automation in wallet mode.

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
| The server holds the wallet session and L2 credentials; the browser only signs. | The SDK signs through a `Signer` and needs L2 credentials server-side (F31, F32); keeping them in memory avoids a secret in the browser. |
| EIP-6963 wallet discovery only, no WalletConnect. | No relay service or project id; extension wallets cover the use case. |
| Key mode and wallet mode are exclusive. | Avoids two signers for one session; `KEY_MODE` refuses connect. |
| A fresh address trades as an EOA account. | A profile 404 means no Polymarket account; deploying a Deposit Wallet silently is refused (H17). |
| The deposit QR encodes the plain bridge address, drawn with `uqr`. | Smallest correct option; round-trip tested. |
| TP/SL and TWAP run in this app (opt-in `AUTOMATION_ENABLED`), not natively, and only while the server runs. | Polymarket offers them only for perps (F28); user chose app-run on 2026-11-14. Risks in H13. |

## Invariants

Each names what breaks silently if violated.

1. **In key mode the private key never leaves the server process; in wallet mode the server holds no key, and L2 credentials live only in server memory, bound to the session cookie, never sent to the browser or written to disk.** Violated → key or credentials in browser bundle or logs, account drained (H1, H19). Enforced by: `server-only` import in `src/server/env.ts`; bundle grep in `npm run check`.
2. **Server binds to loopback and checks Host and Origin.** On a VPS it is reached only through an SSH tunnel on the same port as `PORT`. Violated → anything on the network can trade (H2, H23). Enforced by: `dev`/`start` scripts and `middleware.ts`.
3. **Every order passes server-side validation before the SDK call.** Violated → off-tick rejections, oversized orders, opening orders while close-only (H3, H5, H8). Enforced by: `src/server/orders/validate.ts` with unit tests.
4. **Outcome → assetId mapping lives in one tested function.** Violated → orders on the wrong outcome (H4). Enforced by: `src/lib/market.ts` tests against the NVIDIA fixture.
5. **SDK version is exact-pinned.** Violated → silent breakage on install (H7). Enforced by: `package.json` review.
6. **Automation never re-fires an order whose outcome is unknown.** Violated → duplicate unattended orders (H13). Enforced by: `firing` persisted before the SDK call, interrupted and thrown placements end the rule; `tests/automation-engine.test.ts`.
7. **No keyboard shortcut submits, reviews or confirms an order, and single-key shortcuts are inert while any dialog is open.** Violated → a key press changes or sends an order the user did not see (H15). Enforced by: `ACTION_KINDS` allow-list and dialog checks in `tests/shortcuts.test.ts`; the ticket ignores actions while confirming or submitting.
8. **The app never sends funds, and Deposit never offers the signer or account-wallet address as a target.** Violated → lost or uncredited deposits (H14). Enforced by: `tests/deposit.test.ts` (one bridge POST with the wallet, signer never sent, no address on upstream failure, no order or transfer calls in the deposit sources). The QR encodes exactly the displayed bridge address (`tests/deposit-qr.test.ts`, `jsqr` round-trip).
9. **`createSecureClient` is always called with an explicit `wallet`, never a non-signer wallet with no on-chain code.** Violated → the SDK deploys a Deposit Wallet silently (H17). Enforced by: `tests/account-resolve.test.ts`.
10. **The server asks a browser wallet to sign only inside an operation the user started, only for allowlisted primary types, and checks every returned signature or transaction against the session signer and the request before the SDK continues.** Violated → a page or process drives wallet prompts or signs something unseen (H19). Enforced by: `tests/bridge-signer.test.ts`.
11. **Automation runs in key mode only.** Violated → unattended orders using a browser session (H22). Enforced by: `tests/automation-routes.test.ts`, `tests/secure-client-context.test.ts`.
12. **Every SDK client is built with `sdkFetch`, which sends a non-default `User-Agent`.** Violated → Open and Closed positions fail with "Rate limited" on every load, because Polymarket refuses Node's default `node` (H26). Enforced by: `src/lib/polymarket-core.ts` (the only place clients are built), `tests/sdk-fetch.test.ts`, `tests/account-resolve.test.ts`.

## Open questions

| # | Question | Blocks |
| - | - | - |
| - | None open. Q3 (gasless operations) is resolved: the relayer key is optional and EOA accounts pay POL. | - |

## Next action

The user runs the live checks Phase 10 could not (agents must not place or sign anything):

1. Connect each extension you use (MetaMask, Phantom, Rabby, Trust, Coinbase) on Polygon and sign
   "Sign in to Polymarket".
2. Place and cancel one small order signed in the browser, as an EOA account and as a polymarket.com
   Safe or Deposit Wallet account.
3. On an EOA account, run Enable trading with POL: note the transaction count and gas cost, and
   whether 0.02 / 0.2 POL are sensible. Try a redeem.
4. Scan the Deposit QR with a phone and compare it with the address shown.
5. Walk through the VPS section of the README end to end.
6. Run `npm run doctor` with `POLYMARKET_WALLET_ADDRESS` blank.

7. Review the rebuilt UI against the design canvas; note gaps listed under Phase 11 in plan.md.
8. Withdraw a small amount (just above the $2 minimum) to a Polygon address you control and check
   it arrives as USDC; note the time and the amount received against the quote.

Report what failed; findings go to hazards.md and external-facts.md. No further phases planned.
