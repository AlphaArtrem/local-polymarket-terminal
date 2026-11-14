# Changelog

## Unreleased

- Project docs: phased plan, state tracker, external facts (verified 2026-11-13), hazards, agent
  instructions.
- Phase 0 slice A: app scaffold (Next.js, Node 24), env validation, Host/Origin middleware, `/api/access`, access badge, `npm run doctor`, client-bundle secret scan.
- Access badge uses Polymarket's API jurisdiction rules instead of the geoblock `blocked` flag, which only describes the website (IE, JP, NL, KR can trade via API).
- Phase 3 slice D: trade ticket with confirm dialog, `POST /api/orders` and `DELETE /api/orders/[id]` with server-side validation (tick, min size, cap, held size, trading mode), cancel button, market names in open orders and trade history.
- Phase 1 slice B: wallet dashboard (balance, portfolio value, PnL, positions, open orders, trades, activity).
- Phase 2 slice C: search bar (URL, slug, id, condition id), event page with live order book.
- Market orders now pass `maxSpend` (fees can no longer exceed the per-order cap) and a 5¢ worst-price bound.
- Dashboard shows an **Enable trading** notice when the wallet lacks its trading approvals; `GET/POST /api/approvals` checks and submits them after confirmation. README covers funding through the Polymarket bridge.
- Event page hides inactive placeholder outcomes behind a toggle; outcome list scrolls; ticket no longer requests a book before a market is selected.
