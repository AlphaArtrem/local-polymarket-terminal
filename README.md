# Local Polymarket Terminal

A local trading terminal for Polymarket. It runs on your machine at `http://127.0.0.1:3737`,
uses Polymarket's public APIs through the official SDK, and signs with your own wallet key kept
in a local env file.

> **Status:** v1 code-complete, awaiting first live test with a wallet. See [docs/state.md](docs/state.md).

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

```bash
nvm install 24 && nvm use
npm install
cp .env.example .env.local   # then fill in the values
npm run doctor
npm run dev
```

`.env.local` needs `POLYMARKET_PRIVATE_KEY` (the signer key) and `POLYMARKET_WALLET_ADDRESS`
(the account wallet shown in your polymarket.com profile menu). Never commit this file.

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

1. VPN off. `npm run doctor` should print your wallet type, addresses, pUSD balance and
   `closed-only: false`.
2. `npm run dev`, open http://127.0.0.1:3737. The badge should read OK. Compare balance,
   positions and recent trades with your polymarket.com profile.
3. Paste `https://polymarket.com/event/next-ceo-of-nvidia`, pick a candidate, place a **5-share
   limit BUY well below the best bid** (so it cannot fill), confirm.
4. See it in the dashboard's Open orders tab, cancel it, see it disappear.
5. Only then try a small market order or a Sell.
