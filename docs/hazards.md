# Hazards

Failure modes for this project. Entries marked **Prediction** have not happened yet; they are
reasoned from the domain. When one actually occurs, rewrite it as a **Lesson** with what happened,
when, and the fix. Never promote a prediction without an incident.

## H1 — Private key leaks to the browser or disk logs (Prediction)

The signer key lives in `.env.local`. One `NEXT_PUBLIC_` prefix, one import of a server module
from a client component, or one `console.log(env)` puts it in the browser bundle or terminal
history. A leaked key drains the account and cannot be revoked.

Guard: key is read only in `src/server/env.ts`, which imports `server-only`. No `NEXT_PUBLIC_`
env var ever holds a secret. Logs redact the key and API secrets. The build check greps the
client bundle for the key's address prefix.

## H2 — App reachable from the network (Prediction)

A dev server on `0.0.0.0` lets anything on the LAN, or a web page via DNS rebinding, call
`POST /api/orders` and trade with the user's key.

Guard: bind to `127.0.0.1`; middleware rejects requests whose `Host` is not
`127.0.0.1:<port>` or `localhost:<port>`, and rejects mutating requests whose `Origin` is not
the same.

## H3 — Order rejected or account flagged because of jurisdiction (Prediction)

The CLOB judges the connection's location. A VPN exit in a close-only country (the user's VPN
showed `AR`) makes opening orders fail even when the user's real country is API-open.
Geoblock's `blocked` flag is a website rule, so trusting it would wrongly disable trading from
IE, JP, NL or KR (external-facts F1, F3). Routing around a restriction (VPN, proxy, remote host)
breaches Polymarket's terms and is out of scope.

Guard: before every order the server computes the trading mode from the API jurisdiction table
and `fetchClosedOnlyMode` (`src/lib/jurisdiction.ts`). In close-only mode the ticket only allows
SELL of shares already held, capped at the held size, and tells the user which country was
detected so a VPN mismatch is obvious.

## H4 — Wrong trading identifier (Prediction)

Gamma returns `clobTokenIds` as a JSON string; Protocol V2 markets use `positionId` instead of
`tokenId` (F6, F15). Parsing the string wrong, or swapping Yes/No index, sends an order for the
opposite outcome.

Guard: one function maps a market to `{ outcome label → assetId }`, unit-tested against the
NVIDIA fixture; the confirm dialog shows the outcome label and question text.

## H5 — Price or size off the tick grid (Prediction)

The NVIDIA markets use a 0.001 tick and 5-share minimum (F6); other markets use 0.01. Floats like
`0.1 + 0.2` produce off-grid prices that the CLOB rejects.

Guard: prices and sizes travel as decimal strings; the server rounds to the market's tick, and
rejects sizes under `orderMinSize`.

## H6 — Portfolio looks wrong right after a trade (Prediction)

Fills settle on-chain asynchronously (F16) and the Data API reports freshness via
`/v2/status`. The dashboard may show a filled order with no position for some seconds.

Guard: after a fill, show "settling" until `waitForOrderFillSettlement` returns, then refresh.

## H7 — SDK breaking change (Prediction)

`@polymarket/client` is pre-1.0 and ships weekly (F8). A caret range upgrades silently into a
breaking minor.

Guard: pin the exact version. Upgrades are their own change, with external-facts updated.

## H8 — Fat-finger order (Prediction)

A misplaced decimal on a 0.013 market buys 10x the intended shares.

Guard: `MAX_ORDER_USDC` cap on buys enforced on the server (default 25) and passed to the SDK
as `maxSpend` so fees cannot push a market buy past it; market orders bounded to 5¢ beyond the
best quote (`src/server/orders/bounds.ts`); a confirm dialog showing shares, price, total cost
and outcome; no one-click trading in v1.

## H9 — Wallet operations fail on the SDK's default RPC (Lesson, 2026-11-14)

What happened: the first **Enable trading** click returned `UPSTREAM_ERROR`. The server log showed
only `RequestRejectedError`. With the rejection's status and message logged, it was
`JSON-RPC request to https://polygon.drpc.org failed with status 400`: the free dRPC tier refuses
batches over 10 requests (external-facts F14g). After switching the RPC, the next failure was the
missing Relayer API key (F14f). Nothing was submitted on-chain by either attempt.

Fix: `POLYGON_RPC_URL` (default publicnode) is passed to the SDK; `POLYMARKET_RELAYER_API_KEY`
and `_ADDRESS` are wired in; `/api/approvals` returns `RELAYER_KEY_REQUIRED` with setup steps when
the key is absent; trading-route logs now include Polymarket's status, code and message.

## H10 — "New" and "Ending soon" flooded by auto-generated events (Lesson, 2026-11-14)

What happened: `createdAt` order returned a wall of 5- and 15-minute crypto up/down events; the
first slice-side filter (slug patterns, 4 pages) still produced **0** events for New + Crypto, and
Ending soon showed `doge-updown-15m-*`. Settled sub-markets (price 1, not yet closed) also
headlined some rows at 100¢.

Fix: New and Ending exclude Polymarket's `hide-from-new` and `recurring` tags upstream
(external-facts F25), with the slug/series filter kept as a safety net; top outcomes skip closed
sub-markets and ones priced exactly 0 or 1. Regression tests cover all three.

## H11 — Dashboard lists silently empty (Lesson, 2026-11-14)

What happened: after the first live order (status `live`), **Open orders** showed nothing. The
route answered in ~2 ms without calling Polymarket. Cause: every list called
`paginator.from(cursor).firstPage()`, and in `@polymarket/client@0.18.0` `.from(undefined)`
returns an empty page with no request. Open orders, trades, activity and positions were all
affected since v1; mocked tests passed because the mock returned data from any cursor.

Fix: `pageAt()` in `src/server/portfolio.ts` calls `.firstPage()` when there is no cursor; the
test mock now mirrors the SDK's empty `.from(undefined)`, with a regression test.

## H12 — Live book stuck on "Loading" (Lesson, 2026-11-14)

What happened: in browser acceptance the order book never left "Loading…" although `/api/stream`
returned 200 and sent `book` events. `useLiveBook` passed an inline subscribe function to
`useSyncExternalStore`, so React resubscribed on every render; the ref-counted store hit zero
listeners each time, closed the EventSource and reset state. The network log showed a run of
aborted `/api/stream` requests. Unit tests passed because they cover the pure reducer, not React.

Fix: subscribe/getSnapshot are memoised per asset, and the store waits 2 s with no listeners
before closing the connection (survives re-renders and Strict Mode double mounts).


## H13 — App-run orders fire when nobody is watching (Prediction)

TP/SL and TWAP (Phase 8) are executed by this local server, not by Polymarket. Failure modes:
a rule fires on a midpoint spike in a thin book; a crash between "placing" and "recorded" leads to
a double order on restart; a stop-loss silently never fires because the app was closed; a
repeated venue refusal loops. Mitigations: off unless `AUTOMATION_ENABLED=true`; TP/SL needs the
trigger on two consecutive checks; every order goes through `placeOrder` (mode, size, cap and
slippage checks); a rule is saved as "firing" before the SDK call and an interrupted rule is
never re-fired; every restart begins paused until the user resumes; refusals stop the rule and
three failures in a row pause the engine. Nothing fires while the server is stopped.

## H14 — Deposit sent to the wrong address or network (Prediction)

Funds sent to the signer key's address, or plain USDC sent straight to the account wallet, are not
credited as pUSD; a wrong network or token needs recovery.polymarket.com. **Guard:** the Deposit
dialog shows only the bridge EVM address (checksummed, grouped), says Polygon USDC/USDC.e only,
shows the live minimum, and shows no address at all when the bridge call fails. The QR encodes exactly the shown address (`jsqr` round-trip test). The server refuses
(409) when the configured wallet and signer look misconfigured.

## H15 — A shortcut changes the order under a confirm dialog (Prediction)

If `s` or `n` changed the ticket while its confirm dialog was open, Confirm would send a different
order from the one shown. **Guard:** single-key shortcuts are ignored while any `dialog[open]`
exists and while the ticket is confirming or submitting; no shortcut maps Enter or Space or clicks
anything (tests/shortcuts.test.ts).

## H16 — CSV formula injection (Prediction)

Market titles are third-party text; a cell starting with `=`, `+`, `-` or `@` can run as a formula
in a spreadsheet. **Guard:** `src/lib/csv.ts` prefixes `'` on such cells, except plain numbers.

## H17 — Implicit Deposit Wallet deploy (Prediction)

`createSecureClient` deploys a Deposit Wallet when `wallet` is omitted or points to an undeployed
one, and with a relayer key it does so without any user signature (F32). **Guard:** `wallet` is
always set; a non-signer wallet with empty `eth_getCode` is refused first; tests spy on
`createSecureClient`.

## H18 — Wrong account auto-detected (Prediction)

A failed profile lookup that fell back to EOA would show an empty account, and deposits or orders
would go to the wrong place. **Guard:** only a 404 falls back; other errors are surfaced
(`ACCOUNT_LOOKUP_FAILED`); the source is shown in the wallet-mode header chip and by `npm run doctor` in key mode; there is an
override.

## H19 — Session or signing relay abuse (Prediction)

Another local process, tab or page tries to use the L2 credentials or trigger wallet prompts.
**Guard:** HttpOnly SameSite=Strict cookie, Origin check, one session, a signer that is inert
outside a user-started operation, an allowlist of primary types per operation, and every signature
or transaction checked against the session signer and the request.

## H20 — Signed order whose response is lost (Prediction)

The user signs, then closes the tab; the server still posts the order, and a retry double-orders.
**Guard:** one operation per session; the finished envelope is kept 10 minutes at
`/api/wallet/ops/[id]`; the UI says to check Open orders before retrying.

## H21 — EOA approvals stop partway (Prediction)

POL runs out, or the user rejects one of up to 17 transactions. **Guard:** POL pre-check
(`NEEDS_POL`), the state is re-read afterwards, and a re-run sends only the approvals still missing
(the SDK recomputes them).

## H22 — Automation using a browser session (Prediction)

**Guard:** background code has no request context, so `getSecureClient()` throws in wallet mode;
`requireEngine` refuses (`AUTOMATION_NEEDS_KEY`); the engine uses `getEnvSecureClient`.

## H23 — VPS exposed or used as a jurisdiction workaround (Prediction)

Port 3737 open in the security group, a readable `.env.local`, or a region chosen to dodge a
restriction. **Guard:** loopback bind, SSH tunnel only, a security group that allows 22 only,
`chmod 600`, and the README's jurisdiction warning first. See H3.
