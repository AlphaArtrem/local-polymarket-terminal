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

