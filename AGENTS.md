# Agent Instructions

## Session start

1. `aw-memory boot --task "<task>"` (or `~/.agents/bin/aw-memory`), then the docs it cites.
2. [docs/state.md](docs/state.md) — what exists, invariants, next action.
3. [docs/plan.md](docs/plan.md) — the phase and slice you are working on.
4. [docs/hazards.md](docs/hazards.md) and [docs/external-facts.md](docs/external-facts.md) before
   touching keys, orders or SDK calls.

## Defining constraints

- **Real money.** Never place, sign or submit a live order from an agent, script or test. Tests
  mock the SDK. Only the user places live orders.
- **The private key stays in the server process.** Only `src/server/env.ts` reads it; it imports
  `server-only`. No secret behind a `NEXT_PUBLIC_` variable. Never print env values.
- **Loopback only.** Bind to `127.0.0.1`; keep the Host/Origin middleware.
- **No jurisdiction workarounds.** Do not add VPN, proxy or relay logic to get around geoblock
  or close-only mode.
- **Pinned SDK.** `@polymarket/client` stays at an exact version; upgrades are their own change.
- Runtime is Node 24 (`nvm use`).

## Validation

```bash
nvm use && npm run check   # typecheck + lint + vitest + build + client-bundle secret scan
npm run doctor             # read-only account and access status
aw-memory docs drift
```

## Where findings go

| Finding | Goes to |
| - | - |
| Something now exists or a decision was made | `docs/state.md` (edit in place) |
| Plan or slice scope changes | `docs/plan.md` |
| A fact about Polymarket, the SDK or Node | `docs/external-facts.md` with source, date, grade |
| A failure mode, predicted or real | `docs/hazards.md` |
| User-visible change | `CHANGELOG.md` |
| Trap, decision, failed approach for future sessions | `aw-memory close-session` |

## Answer shape

Full technical answer first (what changed, commands run, what was verified versus assumed, what
failed and why), then `---`, then a short plain-language **Summary**: what changed, what did not
work, and the one decision now the reader's.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
