# Local Polymarket Terminal

A local trading terminal for Polymarket. It runs on your machine at `http://127.0.0.1:3737`,
uses Polymarket's public APIs through the official SDK, and signs with a browser wallet you
connect or with your own key kept in a local env file.

> **Status:** v1 live-tested with a real wallet, plus Browse (Phase 5), charts/live data (Phase 6), redeem/cancel-all/alerts (Phase 7), advanced orders (Phase 8) and browser-wallet signing (Phase 10). See [docs/state.md](docs/state.md).

## What it does

- **Browse** (home page): trending, new and ending-soon events, eight categories, and keyword
  search, with each event's leading outcomes, 24h volume and end date. No key needed.
- **Lookup**: paste a Polymarket event URL, slug, or id to jump straight to its markets and live
  order books.
- **Charts and live data**: price chart per outcome (1H to MAX), order book that updates live,
  and a tape of recent trades; falls back to polling if the live stream drops.
- **Trade**: limit and market orders with server-side safety checks; your open orders on an event
  appear under it with Cancel.
- **Claim, cancel, alert**: Redeem winnings on resolved markets (gasless with a Relayer API key; EOA accounts pay POL),
  cancel all open orders (everywhere or on one event), and price alerts that notify you while the
  app is open (`/alerts`; stored only in your browser).
- **Advanced orders**: limit orders that expire (GTD) or are post-only, and optional take-profit /
  stop-loss and TWAP rules that this app executes for you while it runs (`/automation`).
- **Portfolio** (`/portfolio`): pUSD balance, portfolio value, open and closed positions, open
  orders, trade history and activity, with **Export CSV** on each tab. **Deposit** and **Withdraw** are in the
  account menu (the address button, top right) on every page, and on Portfolio.
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

You need a Polymarket account, or a wallet you are happy to trade from as a plain account. The
terminal trades as that account; it does not create one. Fuller documentation will come later;
this README covers what you need to run it.

### Run locally

```bash
nvm install 24 && nvm use      # Node 24 is required by the SDK
npm ci
cp .env.example .env.local     # .env.local is git-ignored; never commit it
chmod 600 .env.local
npm run build && npm run start # http://127.0.0.1:3737
```

`npm run dev` also works for development. Then pick how you sign (next section).

### Two ways to sign

The app is in **key mode** when `POLYMARKET_PRIVATE_KEY` is set and in **wallet mode** when it is
blank. The two are exclusive: in key mode the Connect button is hidden and `POST /api/wallet/session`
answers 409 `KEY_MODE`.

**A. Connect a browser wallet (default, no key on disk).** Leave `POLYMARKET_PRIVATE_KEY` blank,
open the app and click **Connect wallet**. Wallets that announce themselves through EIP-6963 are
listed (MetaMask, Phantom, Rabby, Trust, Coinbase and similar extensions; mobile wallets and
WalletConnect are not supported). Use Polygon.

- You sign **Sign in to Polymarket** once per session. It proves you own the address and gives
  the server Polymarket API credentials, which stay in server memory, tied to an HttpOnly cookie.
  It is not a transaction and costs nothing.
- Later prompts are real: each **order** is a typed-data signature, and each approval or redeem on
  an EOA account is a transaction that costs POL. Read the prompt; the app shows what it asked for.
- The server keeps one session (idle 12 h, at most 24 h). A restart ends it; reconnect. If you
  close the tab mid-order, the server may still post it: check Open orders before retrying.
- Rejecting a prompt shows "Request rejected in the wallet." and changes nothing.

**B. Server key.** Set `POLYMARKET_PRIVATE_KEY` (`0x` + 64 hex) in `.env.local`. The server signs
everything and the key never reaches the browser. The account wallet is found automatically from
the key; `POLYMARKET_WALLET_ADDRESS` is only an optional override. **Automation (take-profit,
stop-loss, TWAP) needs this mode**, because it runs while no browser is connected.

### Account types

The app trades as one account wallet. How it is found, and how gas works, depend on its type:

| Type | What it is | Approvals and redeem |
| - | - | - |
| EOA | Your signer address itself | Sent as normal transactions: **you pay POL**. Keep about 0.2 POL on the signer; the app refuses to start below 0.02 POL. Up to 17 transactions, one wallet prompt each. |
| Safe | Created for MetaMask-style logins on polymarket.com | Gasless, but only with a relayer key that matches the signer. Otherwise do it on polymarket.com. |
| Deposit Wallet | Accounts created on polymarket.com since 2026-05-04 | Same as Safe. |

In wallet mode the account chip in the header shows the wallet type and the **source**:
`profile` (found through the Polymarket profile of the signer), `chosen` (the "Account wallet"
field) or `default` (no profile, so the address itself is the account). In key mode,
`npm run doctor` prints the same, with `env` meaning your `POLYMARKET_WALLET_ADDRESS` override.
The Deposit dialog always names the account wallet it credits. **An address that has never used Polymarket
trades as a plain EOA account.** That is a new, separate account, not a Polymarket website
account, so check the chip before you deposit. To trade as a different wallet, use the override
(key mode: `POLYMARKET_WALLET_ADDRESS`; wallet mode: the "Account wallet (advanced)" field in the
Connect dialog). The app never deploys a Deposit Wallet for you: if the account wallet is a
smart wallet that is not deployed yet, finish setup on polymarket.com.

### Fill in `.env.local`

| Variable | Required | What it is |
| - | - | - |
| `POLYMARKET_PRIVATE_KEY` | key mode only | Signer key. Leave blank for wallet mode. Export it from your wallet, or from your Polymarket account settings for an email or Google login. |
| `POLYMARKET_WALLET_ADDRESS` | no | Override of the account wallet (key mode only). Normally found automatically. |
| `POLYMARKET_RELAYER_API_KEY` | no | Makes approvals and redeem gasless. See below. |
| `POLYMARKET_RELAYER_API_KEY_ADDRESS` | with the relayer key | The **Signer Address** shown next to that key. Set both or neither. |
| `POLYGON_RPC_URL` | no | Polygon JSON-RPC for wallet operations. Default `https://polygon-bor-rpc.publicnode.com`. It must accept batches of more than 10 requests; the SDK's built-in default does not. |
| `MAX_ORDER_USDC` | no | Server-side cap per buy, in pUSD. Default 25. |
| `AUTOMATION_ENABLED` | no | `true` turns on take-profit/stop-loss and TWAP rules, which place orders **without asking again**. Key mode only. Default off. |
| `AUTOMATION_FILE` | no | Where rules are saved. Default `.data/automation.json` (gitignored). |
| `PORT` | no | Default 3737. The server only listens on 127.0.0.1. |

### Relayer API key (optional)

A relayer key makes approvals and redeem gasless. It is optional:

- **With it**, those operations cost no POL, for every account type. The key's Signer Address
  should match your signer.
- **Without it**, EOA accounts pay POL (see the table). Safe and Deposit Wallet accounts cannot
  enable trading or redeem from this app; do that on polymarket.com (accounts made there usually
  have their approvals already) or add a key.
- A key-mode **EOA** account uses the POL path even if a relayer key is set.

To create one: sign in at polymarket.com, open **Settings → API Keys → Relayer API Keys**, create a
key, copy the **API Key** and the **Signer Address** into the two variables, and restart. Treat it
like a password: keep it only in `.env.local`. `npm run check` fails if it, or the private key,
ends up in the browser bundle.

### Check and run

```bash
npm run doctor   # read-only: location, wallet type, addresses, pUSD balance, close-only mode
npm run start    # http://127.0.0.1:3737
```

`npm run doctor` needs a private key in `.env.local`; in wallet mode, check the access badge and
the account chip in the app instead.

### Fund the account

Send funds through Polymarket's bridge, not to the wallet address directly. **Portfolio →
Deposit** shows your bridge address for USDC or USDC.e on Polygon with the current minimum, a **QR
code** of exactly that address (black on white so it scans in any theme), and the account it
credits. The app only fetches the address; it never sends funds. Or get all your deposit
addresses yourself:

```bash
curl -X POST https://bridge.polymarket.com/deposit \
  -H 'Content-Type: application/json' \
  -d '{"address":"<account wallet>"}'
```

Send a supported token to the matching address (`evm` for Polygon, Arbitrum, Base, Ethereum and
other EVM chains; `svm` for Solana; `btc`; `tron`). USDC on Polygon has a $2 minimum; check
`https://bridge.polymarket.com/supported-assets` for the current list and minimums before sending.
It arrives as pUSD, usually within minutes.

### Withdraw

**Withdraw** (account menu and Portfolio) sends pUSD out of the trading wallet through Polymarket's
bridge, the same way polymarket.com does. Pick a network (Polygon, Ethereum, Base, Arbitrum,
Optimism or BNB Smart Chain), a token (stablecoins first), paste the recipient address and an
amount. The dialog shows the bridge's estimate of what arrives and its fees, then a review with the
full recipient address. On confirm the app asks the bridge for a one-off address for that exact
destination and sends your pUSD to it; the bridge swaps it and pays the recipient, usually within
a minute or two.

- Check the recipient twice. Transfers cannot be reversed, and an exchange may not accept every
  token on every chain.
- The trading wallet itself and the zero address are refused. Each token has a minimum ($2, or $3
  on Ethereum).
- Same rules as Enable trading: gasless with a matching relayer key; EOA accounts pay POL; Safe and
  Deposit Wallet accounts without a relayer key withdraw on polymarket.com.
- If the result says **Submitted** rather than **Confirmed**, open the transaction link before
  trying again, or you may withdraw twice.

### Enable trading (once per wallet)

A new wallet cannot trade until it approves the exchange to use its pUSD and outcome tokens. The
dashboard shows **Trading is not enabled on this wallet yet** until then. Click **Enable
trading**, review, confirm. With a relayer key it is gasless and takes about 10 seconds. On an EOA
without one, your wallet asks you to confirm each transaction and you pay POL; if it stops partway
(out of POL, or you reject one), run it again and only the missing approvals are sent. The
approval state can take a few seconds to update.

### Run on a VPS (AWS EC2 example)

**Read this first.** Polymarket sees the VPS's IP address, not yours. Use a region where you are
allowed to trade from where you actually are. Never use a VPS to get around a restriction: that
breaches Polymarket's terms and this app does not support it. The access badge shows the VPS
location, and a close-only or blocked country applies to the VPS.

1. Launch an Ubuntu 24.04 instance. Security group inbound: **only TCP 22 from your IP**. Never
   open 3737.
2. Create a user and install the app:

   ```bash
   sudo adduser --disabled-password pmterm
   sudo -iu pmterm
   # install nvm (see nvm's README), then:
   nvm install 24
   git clone <this repository> app && cd app
   npm ci && npm run build
   cp .env.example .env.local && chmod 600 .env.local
   ```

3. Edit `.env.local` as `pmterm`. Prefer wallet mode on a VPS, so no key lives there. If you use a
   key, make it a dedicated wallet with a low balance.
4. Create `/etc/systemd/system/pmterm.service`:

   ```ini
   [Unit]
   Description=Local Polymarket terminal
   After=network-online.target

   [Service]
   User=pmterm
   WorkingDirectory=/home/pmterm/app
   Environment=NODE_ENV=production PORT=3737
   ExecStart=/bin/bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && exec npm run start'
   Restart=on-failure
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   Then `sudo systemctl enable --now pmterm` and `journalctl -u pmterm -f`.
5. From your computer, open a tunnel and browse locally:

   ```bash
   ssh -N -L 3737:127.0.0.1:3737 pmterm@<host>
   # then open http://127.0.0.1:3737
   ```

   The local port **must equal `PORT`**, or the Host check answers 403. Your wallet extension
   signs on your computer; the VPS sends the orders.
6. Update with `git pull && npm ci && npm run build && sudo systemctl restart pmterm`. Wallet
   sessions end on restart; reconnect.
7. Automation (key mode only) keeps running while you are disconnected. Every restart begins
   paused; resume it on `/automation`.

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
| `g` then `m` / `p` / `a` | Go to Markets / Portfolio / Alerts |
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
| API answers 401 `WALLET_NOT_CONNECTED` | Wallet mode, no session: click Connect wallet. |
| 409 `KEY_MODE` on connect | A private key is set, so the server signs; blank it to use a browser wallet. |
| 409 `NEEDS_POL` | The signer has under 0.02 POL for an EOA transaction; add POL. |
| 403 `AUTOMATION_NEEDS_KEY` | Automation needs `POLYMARKET_PRIVATE_KEY`. |
| 409 `OP_IN_PROGRESS` | A wallet operation is already waiting for your confirmation. |
| Connect: 403 `USER_REJECTED`, 503 `ACCOUNT_LOOKUP_FAILED`, 409 `WALLET_CONFIG`, 500 `CONNECT_FAILED` | You rejected the prompt; Polymarket's profile lookup failed (retry); the account wallet is misconfigured; or sign-in failed. |
| Enable trading: `RELAYER_KEY_REQUIRED` | Add a Relayer API key (see Relayer API key) and restart, or enable trading on polymarket.com. |
| Enable trading: `Polymarket request failed`, log mentions an RPC `status 400` | `POLYGON_RPC_URL` points at an RPC that rejects large batches; use the default or another provider. |
| Balance 0 after a deposit | Check `https://bridge.polymarket.com/status/<your evm deposit address>`; deposits below the minimum are not processed. |
| Badge shows close-only | Your connection is in a country where Polymarket's API allows closing positions only. Turn any VPN off. |

## Disclaimer

This is an independent project, not affiliated with or endorsed by Polymarket. It trades real
money with your own keys; use it at your own risk and only where Polymarket's terms allow you to.

## License

[MIT](LICENSE)
