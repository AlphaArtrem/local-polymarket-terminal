# Changelog

## Unreleased

- Phase 8: limit orders can expire (GTD: 1 hour, 1 day, 1 week or a custom time) and be post-only; Open orders shows an Expires column. App-run take-profit/stop-loss and TWAP rules (off unless `AUTOMATION_ENABLED=true`; `AUTOMATION_FILE`): an Automate panel on the event page, an `/automation` page with pause/resume and cancel, and a header link. Rules place market orders through the same server checks, only while the app runs, and every restart begins paused.
- Fix: the ticket's post-only and price checks now pick the best bid/ask by value (book levels arrive worst-first).
- Project docs: phased plan, state tracker, external facts (verified 2026-11-13), hazards, agent
  instructions.
- Phase 0 slice A: app scaffold (Next.js, Node 24), env validation, Host/Origin middleware, `/api/access`, access badge, `npm run doctor`, client-bundle secret scan.
- Access badge uses Polymarket's API jurisdiction rules instead of the geoblock `blocked` flag, which only describes the website (IE, JP, NL, KR can trade via API).
- Phase 3 slice D: trade ticket with confirm dialog, `POST /api/orders` and `DELETE /api/orders/[id]` with server-side validation (tick, min size, cap, held size, trading mode), cancel button, market names in open orders and trade history.
- Phase 1 slice B: wallet dashboard (balance, portfolio value, PnL, positions, open orders, trades, activity).
- Phase 2 slice C: search bar (URL, slug, id, condition id), event page with live order book.
- Market orders now pass `maxSpend` (fees can no longer exceed the per-order cap) and a 5¢ worst-price bound.
- Dashboard shows an **Enable trading** notice when the wallet lacks its trading approvals; `GET/POST /api/approvals` checks and submits them after confirmation. README covers funding through the Polymarket bridge.
- Enable trading now works with a Relayer API key (`POLYMARKET_RELAYER_API_KEY`, `POLYMARKET_RELAYER_API_KEY_ADDRESS`) and explains when it is missing; new `POLYGON_RPC_URL` (default publicnode) because the SDK's default RPC rejects large batches; rejection logs include Polymarket's status and message.
- Phase 7: Redeem button on resolved positions and a "claim winnings" banner (`POST /api/redeem`, gasless via the relayer key); Cancel all open orders on the dashboard and per event (`DELETE /api/orders`); browser-only price alerts with notifications or in-page toasts, an Alerts page and header count (`/api/prices`).
- Event page: price chart for the selected outcome (1H/6H/1D/1W/1M/MAX, hover, change over range), live order book over Server-Sent Events with a polling fallback, and a live trade tape (`/api/history`, `/api/stream`). Single-market events open with that market selected.
- Browse home page: trending, new and ending-soon events, eight categories, keyword search from the header (`/api/events`, `/api/categories`, `/api/search`); recurring up/down events excluded via Polymarket's own tags. The wallet dashboard moved to `/portfolio`.
- Event page: "Your orders" strip lists open orders on that event with Cancel (polls every 10 s).
- Enable trading re-reads the approval state for up to ~12 s after submitting, so it no longer reports approvals as missing while the state catches up.
- Fix: dashboard open orders, trades, activity and positions were always empty (SDK `.from(undefined)` returns an empty page).
- MIT license; README disclaimer.
- README: step-by-step setup for other users (env variables, Relayer API key, funding via the bridge, enabling trading) and a troubleshooting table.
- Event page hides inactive placeholder outcomes behind a toggle; outcome list scrolls; ticket no longer requests a book before a market is selected.
