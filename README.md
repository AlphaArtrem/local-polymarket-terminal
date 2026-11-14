# Local Polymarket Terminal

A local trading terminal for Polymarket. It runs on your machine at `http://127.0.0.1:3737`,
uses Polymarket's public APIs through the official SDK, and signs with your own wallet key kept
in a local env file.

> **Status:** v1 live-tested with a real wallet, plus Browse (Phase 5), charts/live data (Phase 6) and redeem/cancel-all/alerts (Phase 7) and advanced orders (Phase 8). See [docs/state.md](docs/state.md).

## What it does

- **Browse** (home page): trending, new and ending-soon events, eight categories, and keyword
  search, with each event's leading outcomes, 24h volume and end date. No key needed.
- **Lookup**: paste a Polymarket event URL, slug, or id to jump straight to its markets and live
  order books.
- **Charts and live data**: price chart per outcome (1H to MAX), order book that updates live,
  and a tape of recent trades; falls back to polling if the live stream drops.
- **Trade**: limit and market orders with server-side safety checks; your open orders on an event
  appear under it with Cancel.
- **Claim, cancel, alert**: Redeem winnings on resolved markets (needs the Relayer API key),
  cancel all open orders (everywhere or on one event), and price alerts that notify you while the
  app is open (`/alerts`; stored only in your browser).
- **Advanced orders**: limit orders that expire (GTD) or are post-only, and optional take-profit /
  stop-loss and TWAP rules that this app executes for you while it runs (`/automation`).
- **Portfolio** (`/portfolio`): pUSD balance, portfolio value, open and closed positions, open
  orders, trade history and activity, with **Export CSV** on each tab and a **Deposit** dialog.
- **Watchlist**: star an event or outcome (browse cards, market header); the Browse sidebar shows
  starred outcomes with live prices and the change since you starred them. Stored only in your
  browser.
- **Keyboard shortcuts**: press `?` for the list (see [Keyboard shortcuts](#keyboard-shortcuts)).

## Before you trade

Polymarket restricts **API** trading, not only the website, in many countries. Check yours:

```bash
curl https://polymarket.com/api/geoblock
```

The `blocked` field there describes the **website**. What matters for this terminal is whether
your country is API-restricted (Polymarket's geoblock docs list them). Run with any VPN off so the
check sees your real location. If your connection is in a close-only country, the terminal lets
you close existing positions but not open new ones. It does not try to work around this.

## Setup

You need a Polymarket account. The terminal trades as that account; it does not create one.

### 1. Install

```bash
nvm install 24 && nvm use      # Node 24 is required by the SDK
npm install
cp .env.example .env.local     # .env.local is git-ignored; never commit it
```

### 2. Fill in `.env.local`

| Variable | Required | What it is and where to get it |
| - | - | - |
| `POLYMARKET_PRIVATE_KEY` | to see your wallet or trade | The private key of the wallet you sign in to Polymarket with (`0x` + 64 hex). With MetaMask or another external wallet, export it from that wallet. With an email or Google login, use the private-key export in your Polymarket account settings. |
| `POLYMARKET_WALLET_ADDRESS` | with the key | Your Polymarket **account wallet**, shown in the polymarket.com profile menu. It is usually different from the key's own address. If the website is unavailable to you, look it up from the key's address: `curl "https://gamma-api.polymarket.com/public-profile?address=<key address>"` and use `proxyWallet`. |
| `POLYMARKET_RELAYER_API_KEY` | to enable trading | Needed once, for the gasless **Enable trading** approval (and later wallet operations). See step 3. |
| `POLYMARKET_RELAYER_API_KEY_ADDRESS` | with the relayer key | The **Signer Address** shown next to that key. |
| `POLYGON_RPC_URL` | no | Polygon JSON-RPC used for wallet operations. Default `https://polygon-bor-rpc.publicnode.com`. It must accept JSON-RPC batches of more than 10 requests; the SDK's built-in default (`polygon.drpc.org`, free tier) does not. |
| `MAX_ORDER_USDC` | no | Server-side cap per buy, in pUSD. Default 25. |
| `AUTOMATION_ENABLED` | no | `true` turns on take-profit/stop-loss and TWAP rules, which place orders **without asking again**. Default off. |
| `AUTOMATION_FILE` | no | Where rules are saved. Default `.data/automation.json` (gitignored). |
| `PORT` | no | Default 3737. The server only listens on 127.0.0.1. |

### 3. Create a Relayer API key

Polymarket accounts use smart wallets, so approving the exchange to use your funds is a gasless
transaction sent through Polymarket's relayer. The SDK refuses to send it without a Relayer API key.

1. Sign in at polymarket.com and open **Settings → API Keys → Relayer API Keys**.
2. Create a key.
3. Copy the **API Key** into `POLYMARKET_RELAYER_API_KEY` and the **Signer Address** shown with it
   into `POLYMARKET_RELAYER_API_KEY_ADDRESS`.
4. Restart the terminal (`npm run dev`) so it reads the new values.

Treat the relayer key like a password: keep it only in `.env.local`. The build check
(`npm run check`) fails if it, or the private key, ever ends up in the browser bundle.

### 4. Check and run

```bash
npm run doctor   # read-only: location, wallet type, addresses, pUSD balance, close-only mode
npm run dev      # http://127.0.0.1:3737
```

### 5. Fund the wallet

Send funds through Polymarket's bridge, not to the wallet address directly. The easiest way:
**Portfolio → Deposit** shows your bridge address for USDC or USDC.e on Polygon, with the current
minimum (the app only fetches the address; it never sends funds). Or get all your deposit
addresses yourself:

```bash
curl -X POST https://bridge.polymarket.com/deposit \
  -H 'Content-Type: application/json' \
  -d '{"address":"<POLYMARKET_WALLET_ADDRESS>"}'
```

Send a supported token to the matching address (`evm` for Polygon, Arbitrum, Base, Ethereum and
other EVM chains; `svm` for Solana; `btc`; `tron`). USDC on Polygon has a $2 minimum; check
`https://bridge.polymarket.com/supported-assets` for the current list and minimums before sending.
It arrives as pUSD, usually within minutes; `npm run doctor` shows the balance.

### 6. Enable trading (once per wallet)

A new wallet cannot trade until it approves the exchange to use its pUSD and outcome tokens. The
dashboard shows **Trading is not enabled on this wallet yet** until then. Click **Enable
trading**, review, confirm. It is gasless, places no order, and takes about 10 seconds; the
approval state can take a few more seconds to update.

## Trading

Open a market (`/market/<event-slug>`), pick a row, and use the ticket on the right.

- Choose Buy or Sell, the outcome, and Limit or Market. Limit takes a price in cents (snapped to the
  market's tick) and shares; Market BUY takes a pUSD amount, Market SELL takes shares. Sell has a Max
  button for the shares you hold.
- "Review order" opens a confirmation with the question, outcome, side, price, total and trading
  mode. Nothing is sent until you confirm.
- The server re-checks everything (tick, minimum size, `MAX_ORDER_USDC` cap on buys, held size,
  trading mode) and rejects, rather than adjusts, a bad order.
- Close-only: Buy is disabled and the ticket names the detected country. Blocked: everything is
  disabled.
- Cancel an open order from the Open orders tab on the dashboard.
- After a fill the ticket shows "Settling..." and refreshes your positions for about 20 seconds.
- Market orders spend at most the amount you enter including fees, and only fill within 5¢ of
  the best price at the time you place them.
- Limit orders can **expire** (1 hour, 1 day, 1 week or a custom time, at least 5 minutes ahead)
  and can be **post-only**: rejected instead of filling immediately against the book.

### Take-profit, stop-loss and TWAP (optional, off by default)

Polymarket only offers these for perps, so this app runs them itself. Set `AUTOMATION_ENABLED=true`
in `.env.local` and restart. Then use **⚙ Automate** under the ticket:

- **Take-profit / stop-loss**: sell up to N shares at market when the midpoint reaches a level you
  set (checked every 5 s; the trigger must hold on two checks in a row).
- **TWAP**: split a buy (pUSD) or sell (shares) into 2–50 market orders, one every 1–1440 minutes,
  optionally skipping slices while the price is beyond a limit.

What to know before you turn it on:

- Rules only run **while the app is running**. Nothing happens while it is stopped.
- After every restart automation is **paused**; resume it on `/automation`. On resume, rules are
  checked against the current price, so a stop already passed sells at once.
- Each order goes through the same server checks as the ticket (`MAX_ORDER_USDC`, held size,
  trading mode, 5¢ slippage bound). A refused order stops the rule; if an order call fails midway
  the rule stops too (it may or may not have been placed: check Open orders and Trades); three
  failures in a row pause everything.

### Keyboard shortcuts

| Keys | Action |
| - | - |
| ⌘K / Ctrl+K, `/` | Focus search |
| `g` then `b` / `p` / `a` | Go to Browse / Portfolio / Alerts |
| `b` / `s` | On a market: set the ticket to Buy / Sell and focus its first field |
| `y` / `n` | On a market: select the Yes / No outcome (first / second) |
| `?` | Show all shortcuts; single-key shortcuts can be switched off there |
| Esc | Close a dialog, leave the search box |

Shortcuts never review, confirm or place an order: that always takes a click. Single keys do
nothing while typing in a field or while any dialog (such as the order confirmation) is open.

### Export

**Export CSV** on each Portfolio tab downloads every row of that tab (up to 2,000) as
`polymarket-<tab>-<date>.csv`. Values are raw (prices as decimals, times in ISO-8601 UTC); cells
that start like a spreadsheet formula get a leading `'`.

## First live test

1. VPN off. `npm run doctor` prints your wallet type, addresses, pUSD balance and
   `close-only mode: false`.
2. Open http://127.0.0.1:3737. The badge reads OK, there is no "Trading is not enabled" notice,
   and balance, positions and recent trades match your polymarket.com profile.
3. Paste `https://polymarket.com/event/next-ceo-of-nvidia`, pick a candidate, place a **5-share
   limit BUY well below the best bid** (so it cannot fill), confirm.
4. See it in the dashboard's Open orders tab, cancel it, see it disappear.
5. Only then try a small market order or a Sell.

## Troubleshooting

| Symptom | Cause and fix |
| - | - |
| Doctor: `POLYMARKET_WALLET_ADDRESS: required when POLYMARKET_PRIVATE_KEY is set` | Add the account wallet address (setup step 2). |
| Enable trading: `RELAYER_KEY_REQUIRED` | Create the Relayer API key (setup step 3) and restart. |
| Enable trading: `Polymarket request failed`, log mentions an RPC `status 400` | `POLYGON_RPC_URL` points at an RPC that rejects large batches; use the default or another provider. |
| Balance 0 after a deposit | Check `https://bridge.polymarket.com/status/<your evm deposit address>`; deposits below the minimum are not processed. |
| Badge shows close-only | Your connection is in a country where Polymarket's API allows closing positions only. Turn any VPN off. |

## Disclaimer

This is an independent project, not affiliated with or endorsed by Polymarket. It trades real
money with your own keys; use it at your own risk and only where Polymarket's terms allow you to.

## License

[MIT](LICENSE)
