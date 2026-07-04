# Smart Money Mirror

**Whale-move alerts + weekly digest, sold as a subscription.** Tracks OKX smart-money leaderboard traders; when a top trader opens/closes/flips a position, subscribers get an alert with a one-paragraph "why this matters" take.

## Why this wins

Subscriptions = recurring, provable marketplace revenue. And every interesting whale move is a free viral post on X with #okxai — the product markets itself: each alert is both the paid good and the ad for it.

## Revenue model

- Monthly subscription ($5–10/mo) for real-time alerts
- Free tier: weekly digest (funnel + the viral surface)

## How it works

```
┌─ Watcher (cron, ~5min) ─┐   smart-money skill:
│ poll leaderboard traders│   leaderboard + position
│ diff positions vs last  │   monitoring
└──────────┬──────────────┘
           ▼
┌─ Analyst ───────────────┐   market-data skill for context
│ significance filter     │   (price at entry, funding, OI)
│ + Claude take:          │
│ "why this matters"      │
└──────────┬──────────────┘
           ▼
┌─ Dispatch ──────────────┐
│ subscribers: Telegram / │
│ email alert             │
│ public: X post (weekly  │
│ digest + big moves)     │
└─────────────────────────┘
```

## Stack

- Node.js (plain ESM JavaScript, zero dependencies — no TS build step)
- OKX agent CLI (`@okx_ai/okx-trade-cli`) smart-money + market-data modules (behind `src/adapters/okx.js`; mock until keys exist — exact commands documented in the adapter and `STATUS.md`)
- Telegram bot for subscriber delivery (behind `src/adapters/telegram.js`; mock = console + `out/alerts.log`)
- Claude for the analysis paragraph (behind `src/adapters/llm.js`; mock = canned templates over real event numbers)
- State store: JSON file (`state/positions.json`, last-seen positions per tracked trader) — SQLite dropped to keep zero native deps

**Run it:** `npm run serve` (web terminal, below), `npm run demo` (scripted 5-tick CLI demo), `npm run tick`, `npm run digest`, `npm test`. Mode via `OKX_MODE=mock|real` (default mock). See `STATUS.md` for what's real vs mocked and the wiring steps.

## Web terminal + service API

```
npm run serve        # → http://localhost:4103   (PORT=xxxx to override)
```

A zero-dependency `node:http` server (`src/server.js`) serving a single-file trading-terminal console (`src/web/index.html` — no CDNs, works fully offline):

- **Live alert feed** from `out/events.jsonl`, newest first. Significant alerts highlighted; filtered-out events stay visible but dimmed **with their scores and filter reason shown** — transparency about what the filter dropped is a feature, not a leak.
- **Simulate next tick** button drives the scripted whale scenario (`POST /api/tick`); the feed polls `GET /api/events` and updates live. **Reset scenario** rewinds to tick 0.
- **Event detail** — click any row for the full analyst take, the significance-score math (rank + book share + unusualness), and market context.
- **Leaderboard** panel: current snapshot with per-trader positions and 30d PnL.
- **Weekly digest** view (`GET /api/digest`) including the ≤280-char X-post block with a copy button.
- **Subscribe box** (email or Telegram handle → `POST /api/subscribe` → `state/subscribers.json`) — clearly badged **demo, delivery not yet live**.

The page is badged **MOCK DATA — SCRIPTED DEMO** whenever the engine runs in mock mode. The JSON endpoints under `/api/*` are the same surface a paid subscription/pay-per-call service would meter — documented in `STATUS.md → Service API`.

## Build plan

- [x] Phase 1 — Rails: smart-money skill pulling leaderboard + positions; diff engine detecting opens/closes/flips — **done in mock mode** (diff engine real + unit-tested; OKX pull is a documented stub in `src/adapters/okx.js` until API keys exist)
- [x] Phase 2 — Analyst: significance filter (position size, trader rank, unusualness) + Claude one-paragraph take — **done in mock mode** (filter real + tested; takes are templates until `ANTHROPIC_API_KEY` exists; exact Claude call documented in `src/adapters/llm.js`)
- [ ] Phase 3 — Dispatch: Telegram bot with subscribe flow; weekly digest generator — **partial:** dispatch pipeline + weekly digest generator work end-to-end (mock delivery → console + `out/alerts.log`); the real Telegram bot + `/start` `/stop` `/threshold` subscribe flow is fully designed in `src/adapters/telegram.js` comments but **not wired** (no bot token yet)
- [x] Phase 3.5 — Web terminal + service API: `npm run serve` → live feed, tick/reset demo controls, digest view with X-post copy, subscribe box, JSON API (`src/server.js` + `src/web/index.html`, zero deps) — **done** (demo mode; subscribe stores locally, delivery pending Phase 3 bot)
- [ ] Phase 4 — Marketplace: ASP listing, subscription pricing, free-tier funnel
- [ ] Phase 5 — Traction: start posting big moves on X with #okxai immediately (before judging)
- [ ] Submit Google form (after listing, before Jul 17 00:00 UTC)
- [ ] Post demo on X with #okxai

## Demo script (≤90s)

1. (0–15s) "The top 10 traders on OKX just moved. Did you see it? Subscribers did — 4 minutes later."
2. (15–60s) Live: watcher catches a position flip → alert lands in Telegram with the take
3. (60–90s) Weekly digest scroll-through. "Follow the money that wins. $5/month."
