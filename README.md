# Local Polymarket Terminal

A local trading terminal for Polymarket. It runs on your machine at `http://127.0.0.1:3737`,
uses Polymarket's public APIs through the official SDK, and signs with your own wallet key kept
in a local env file.

> **Status:** v1. Wallet, lookup and trading work against a live account; the first-trade test is next. See [docs/state.md](docs/state.md).

## v1 scope

- Wallet: pUSD balance, portfolio value, open and closed positions, open orders, trade history.
- Lookup: paste a Polymarket event URL, slug, or id and see its markets and order books.
- Trade: limit and market orders with server-side safety checks, and cancel.

Browsing by category, trending markets and charts come later ([docs/plan.md](docs/plan.md)).

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

Send funds through Polymarket's bridge, not to the wallet address directly. Get your personal
deposit addresses:

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
