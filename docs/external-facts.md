# External Facts

Every fact this project depends on that lives outside the repo. Each entry has a source, the
date it was checked, and a grade:

- **Verified** — exercised against the live service from this machine.
- **Documented** — read in official docs or package metadata, not yet exercised.
- **Assumed** — believed true, no source yet. Must be checked before code relies on it.

When a fact changes, edit the entry in place and update the date.

## Access and jurisdiction

| # | Fact | Source | Checked | Grade |
| - | - | - | - | - |
| F1 | `GET https://polymarket.com/api/geoblock` returns `{blocked, ip, country, region}`. `blocked` reflects the **website** rule: from this Mac it returned `blocked: true` for both `AR` (user's VPN exit) and `IE` (`region: "L"`), though IE is API-open (F3). Trading mode must come from the jurisdiction table, not `blocked`. | Live curl, twice | 2026-11-13 | Verified |
| F2 | Argentina (AR) is **close-only on both the frontend and the API**: existing positions can be closed, new positions cannot be opened. Orders from blocked regions are rejected by the CLOB. | docs.polymarket.com/developers/CLOB/geoblock | 2026-11-13 | Documented |
| F3 | Only IE, JP, NL, KR (and MT for sports) are restricted on the frontend but **not** on the API. | Same page | 2026-11-13 | Documented |
| F4 | The SDK exposes `fetchClosedOnlyMode`, so the account's close-only state can be read directly rather than inferred from IP. | `@polymarket/client@0.18.0` type definitions | 2026-11-13 | Documented |

## Market data (Gamma)

| # | Fact | Source | Checked | Grade |
| - | - | - | - | - |
| F5 | `GET https://gamma-api.polymarket.com/events?slug=next-ceo-of-nvidia` returns a list with one event: id `1353337`, `negRisk: true`, active, 107 markets. No auth. | Live curl | 2026-11-13 | Verified |
| F6 | Each market carries `id`, `question`, `conditionId`, `slug`, `clobTokenIds` and `outcomes` and `outcomePrices` (all three are **JSON-encoded strings**, not arrays), `negRisk`, `orderPriceMinTickSize` (0.001 here), `orderMinSize` (5 shares here), `acceptingOrders`. | Live curl | 2026-11-13 | Verified |
| F7 | Polymarket event URLs are `polymarket.com/event/<event-slug>`, optionally followed by `/<market-slug>`. | Test URL from user; site convention | 2026-11-13 | Assumed (second segment) |

## Trading and account (CLOB, SDK)

| # | Fact | Source | Checked | Grade |
| - | - | - | - | - |
| F8 | Official TypeScript SDK is `@polymarket/client`. Latest is `0.18.0`, published 2026-11-09. Pre-1.0: expect breaking changes between minors. | `npm view` | 2026-11-13 | Verified |
| F9 | `@polymarket/client@0.18.0` requires **Node >= 24** (`engines`). This Mac has Node 23.7.0 (Homebrew) and 22.13.1 (nvm). | package.json, `node -v` | 2026-11-13 | Verified |
| F10 | Peer dependency `viem ^2.46.3`. Signer from a key: `privateKey(key)` from `@polymarket/client/viem`. | package.json, docs | 2026-11-13 | Documented |
| F11 | `createSecureClient({ wallet, signer })` connects an existing polymarket.com account. `wallet` is the account wallet address shown in the polymarket.com profile menu, which differs from the signer (key) address for smart wallets. | docs.polymarket.com/trading/wallets-auth, /trading/quickstart | 2026-11-13 | Documented |
| F12 | Wallet types: `EOA=0`, `POLY_PROXY=1` (Magic/Google), `GNOSIS_SAFE=2` (MetaMask etc.), `DEPOSIT_WALLET=3` (all accounts created on or after 2026-05-04). | Same | 2026-11-13 | Documented |
| F13 | A Relayer API key (polymarket.com → Settings → API Keys) is needed only for gasless wallet operations (approvals, redeem), not for placing CLOB orders. | Same | 2026-11-13 | Documented |
| F14 | Collateral is **pUSD**. Market orders: `placeMarketOrder({ assetId, side, amount })`, where `amount` is pUSD to spend on a BUY; unfilled remainder is cancelled. | /trading/quickstart | 2026-11-13 | Documented |
| F15 | A market's trading id is `outcome.tokenId` for CTF markets and `outcome.positionId` for Protocol V2 markets (`market.version === "v2"`). | /trading/quickstart | 2026-11-13 | Documented |
| F14a | Market BUY `amount` is pre-fee notional; fees are added on top unless `maxSpend` is set. `maxPrice` (BUY) and `minPrice` (SELL) bound execution price. Market SELL takes `shares`. `orderType` is FAK (default) or FOK. `placeLimitOrder({assetId, price, size, side})` is GTC unless `expiration` is set. Responses: `{ok:true, orderId, status: live\|matched\|delayed, tradeIds}` or `{ok:false, code, message}`. | `@polymarket/client@0.18.0` type definitions | 2026-11-13 | Documented |
| F14b | The client has no `fetchTickSize`; the order book carries `tickSize` and `minOrderSize`. Book levels arrive worst-first. | Type definitions, live `/api/book` | 2026-11-13 | Verified |
| F14c | The SDK's `<X>Error.isError` guards match any SDK error; use `instanceof` to tell error classes apart. Unknown slugs/ids come back as `RequestRejectedError` 404 (422 for malformed id). | Slice C finding, live calls | 2026-11-13 | Verified |
| F14d | In negRisk events Gamma pre-creates placeholder outcomes with `active: false, closed: false`, 50¢ and no volume ("Candidate S"…). NVIDIA: 82 of 107. The website hides them. | Live SDK `fetchEvent`, fixture | 2026-11-13 | Verified |
| F16 | Fills settle on-chain asynchronously; `waitForOrderFillSettlement(response)` returns tx hashes. Positions lag until settlement. | /trading/quickstart | 2026-11-13 | Documented |
| F17 | SDK methods this project plans to use: `fetchEvent`, `fetchMarket`, `fetchOrderBook`, `fetchMidpoint`, `fetchTickSize`, `fetchBalanceAllowance` (pUSD balance: the standalone action from `@polymarket/client/actions` with `{ assetType: AssetType.COLLATERAL }`, returns base units with 6 decimals; `fetchBalances` is perps-only), `fetchClosedOnlyMode`, `fetchPortfolioValue`, `listPositions`, `listAccountTrades`, `listActivity`, `listOpenOrders`, `placeLimitOrder`, `placeMarketOrder`, `cancelOrder`. Exact argument shapes: read `node_modules/@polymarket/client/dist/*.d.ts`. | Type definitions | 2026-11-13 | Documented |
| F18 | Each SDK action has an error guard (`<Action>Error.isError(e)`) with names such as `RateLimitError`, `UserInputError`. | /getting-started/typescript | 2026-11-13 | Documented |

## Portfolio data (Data API)

| # | Fact | Source | Checked | Grade |
| - | - | - | - | - |
| F19 | Data API v1 is **retired**; `GET /positions` returns `{"error":"Data API v1 has been retired"}`. v2 lives at `https://data-api.polymarket.com/v2`, no auth. | Live curl, docs | 2026-11-13 | Verified |
| F20 | v2 wraps payloads in `data` and paginates by cursor only (`pagination.next_cursor`, `has_more`). Routes: `/v2/positions` (`status=CLOSED` for closed), `/v2/trades`, `/v2/activity`, `/v2/value`, `/v2/user-pnl`. Amounts suffixed `_usdc` are dollars; bare `size` is shares; `null` means unavailable, not zero. | /api-reference/data-api/overview, /migrate/data-api-v1-to-v2 | 2026-11-13 | Documented |
