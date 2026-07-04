# STATUS — Smart Money Mirror

_Last updated: 2026-07-02. Built mock-first: the entire pipeline runs offline today; every external call sits behind an adapter with a documented real-mode stub._

## How to run

```
cd smart-money-mirror
npm run serve    # web terminal + service API → http://localhost:4103 (PORT to override)
npm run demo     # the 90s demo backbone: reset → 5 scripted ticks → digest
npm run tick     # one watcher pass (cron this ~5min in production)
npm run digest   # regenerate out/digest-<date>.md from the event log
npm run reset    # wipe state/ + out/
npm run x402-demo # x402 handshake demo: 402 → mock pay → 200 + receipt
npm test         # 29 unit tests (diff engine + significance filter + x402 gate)
```

Requires Node ≥ 18. **Zero npm dependencies** — no install step needed.
Mode switch: `OKX_MODE=mock` (default) | `OKX_MODE=real` (throws with wiring instructions until credentials exist).

## What WORKS (real logic, runs today)

| Piece | Where | Notes |
|---|---|---|
| Diff engine | `src/diff.js` | Pure function; detects OPEN / CLOSE / FLIP / SIZE_UP ≥50% / SIZE_DOWN ≥50%; realized-PnL estimates from marks; handles traders entering/leaving the leaderboard. 13 unit tests. |
| Significance filter | `src/significance.js` + `config.js` | Score 0–100 from trader rank + position-vs-book share + unusualness (flip > open > close > resize); `alertThreshold` 65, `minNotionalUsd` $250K floor. 5 unit tests. |
| Watcher tick | `src/watcher.js` | fetch → diff vs `state/positions.json` → score/filter → analyst take → dispatch → persist. First tick = baseline sync (no alert spam). |
| Event log | `out/events.jsonl` | Every event with score, filter verdict, take, market context — the digest's source of truth. |
| Weekly digest | `src/digest.js` | `out/digest-<date>.md`: top moves by score, winners/losers from realized closes, leaderboard table, X-post block auto-clamped ≤280 chars with #okxai. |
| CLI + demo | `src/index.js` | `tick` / `digest` / `demo` / `reset`. Demo = 5 scripted ticks end-to-end (8 events → 6 alerts → digest). |
| Scripted scenario | `src/mock/scenario.js` | 10 traders / 14 positions; tick 2 rank-1 flips BTC, tick 3 rank-3 opens big ETH long, ticks 4–5 adds/closes + noise that the filter correctly drops. Market drifts lower so the flip reads prescient. |
| Web terminal + service API | `src/server.js` + `src/web/index.html` | Zero-dep `node:http` server on port 4103. Live feed (alerts highlighted, filtered events dimmed with score + reason), tick/reset demo controls, leaderboard, digest view with X-post copy button, subscribe box. Single-file UI, no CDNs, offline-safe. |
| Subscriber store | `state/subscribers.json` | `POST /api/subscribe` validates email / telegram handle, dedupes, appends `{contact, channel, since}`. **Demo only — nothing is delivered to these contacts yet** (delivery lands with the Phase 3 Telegram bot). |

## What is MOCKED (and where the real wiring is documented)

| Adapter | Mock behavior | Real-mode stub documents |
|---|---|---|
| `src/adapters/okx.js` | Serves the scripted scenario (leaderboard + market context per tick) | The OKX agent CLI, npm **`@okx_ai/okx-trade-cli`** (one binary powers the smart-money + market-data skills; command surface verified against the skill docs + the CLI's own `list-tools` schema): `okx smartmoney traders-by-filter` / `trader-positions` for the leaderboard (auth, live-only, linear contracts only) and `okx market ticker` / `funding-rate` / `open-interest` for context (public, no auth) — exact commands in the adapter header and §Wiring below. Fallback: the raw OKX REST v5 endpoints the CLI wraps: `GET /api/v5/copytrading/public-lead-traders`, `GET /api/v5/copytrading/public-current-subpositions`, `GET /api/v5/market/ticker`, `GET /api/v5/public/funding-rate`, `GET /api/v5/public/open-interest`. Env planned: `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE` (public endpoints need none). |
| `src/adapters/telegram.js` | Prints boxed alert to console AND appends to `out/alerts.log` with timestamps | Bot API `POST https://api.telegram.org/bot<TOKEN>/sendMessage` (HTML parse mode, rate limits), plus the full subscribe-flow design: `/start` `/stop` `/threshold <n>`, `state/subscribers.json`, getUpdates long-poll, free-vs-paid tier gating. Env planned: `TELEGRAM_BOT_TOKEN`. |
| `src/adapters/llm.js` | Well-written canned templates (2 variants per event type, deterministically picked) interpolating real event numbers + market context | Exact Claude Messages API call: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key` + `anthropic-version: 2023-06-01`, model `claude-haiku-4-5` (cheap/fast for per-alert takes; `claude-opus-4-8` for max quality), `max_tokens: 300`, system prompt + `buildPrompt()` already written. Env planned: `ANTHROPIC_API_KEY`. |

The real implementations must return the same shapes the mocks return — nothing downstream changes when they're wired.

## Wiring steps to go live (in order)

1. **OKX data:** install the CLI and smoke-test it, then implement the two functions in `src/adapters/okx.js` against it (or the raw v5 endpoints listed above). Verified command surface:

   ```bash
   npm install @okx_ai/okx-trade-cli          # local install; binary at ./node_modules/.bin/okx
   okx list-tools --json                      # sanity check (163 tools, works offline)
   # market data — public, NO auth (rate limit 20 req/2s/IP):
   okx market ticker BTC-USDT-SWAP --json
   okx market mark-price --instType SWAP --instId BTC-USDT-SWAP --json
   okx market funding-rate BTC-USDT-SWAP --json
   okx market open-interest --instType SWAP --json
   # smart-money — AUTH required, live-only, USDT/USDS linear contracts only:
   okx auth login --manual --site global      # OAuth device flow (or: okx config init → ~/.okx/config.toml, Read perms only)
   okx smartmoney traders-by-filter --sortBy pnl --period 30 --minWinRate 0.5 --limit 10 --json
   okx smartmoney trader-positions --authorId <ID> --json
   okx smartmoney performance-by-trader --authorIds <ID1,ID2> --json
   ```

   Call the CLI as a subprocess, parse `data` from the `{code,msg,data}` envelope, and map API fields → snapshot shape (`uniqueCode→id`, `subPos→size`, `openAvgPx→entryPx`). If the CLI reports "Failed to call OKX endpoint", check local DNS/proxy first (it honors `HTTPS_PROXY` / `OKX_API_BASE_URL`; `okx diagnose` exists for this) — that's an environment issue, not an auth bug.
2. **Telegram:** create bot via @BotFather → `TELEGRAM_BOT_TOKEN`; implement `sendAlert` broadcast + the getUpdates command loop per the design comments; add `state/subscribers.json`.
3. **Claude:** set `ANTHROPIC_API_KEY`; swap the throw in `llm.generateTake` for the documented fetch call; keep templates as the error fallback.
4. **Cron:** schedule `node src/index.js tick` every ~5 min and `node src/index.js digest` weekly.
5. **Set `OKX_MODE=real`** and re-run `npm run demo`'s equivalent against live data before recording the real demo.
6. Tune `config.js` thresholds against a day of live events (the mock thresholds were calibrated on the scripted scenario).

## Service API (the future paid surface)

`npm run serve` exposes the product as JSON over HTTP (port 4103, `PORT`/`HOST` env to override; binds `127.0.0.1` by default). These are the exact endpoints a paid tier would meter — subscription gating (free = digest, paid = real-time events) or pay-per-call pricing on `/api/events` + `/api/digest` — so the web terminal and any future billing sit on the same surface:

| Method | Path | Today (demo) | Paid-tier plan |
|---|---|---|---|
| GET | `/api/health` | `{ok:true, mode}` | unmetered |
| GET | `/api/events?limit=n` | full event feed, newest first, incl. scores + filter verdicts + takes | **paid real-time tier** (or per-call) |
| GET | `/api/leaderboard` | current tracked snapshot | paid |
| GET | `/api/digest` | builds + returns weekly digest markdown + X-post block | **free tier** (the funnel) |
| POST | `/api/tick` | advances the scripted scenario (demo control) | replaced by the ~5min cron in production |
| POST | `/api/reset` | rewinds the scripted scenario (demo control) | removed in production |
| POST | `/api/subscribe` | `{contact}` → validated, deduped, appended to `state/subscribers.json` | becomes the paid-signup entry point (payment link + Telegram bot handoff) |

No API-key auth exists, but pay-per-call metering does: `POST /api/subscribe` is gated by the x402 payment layer below (off by default).

## x402 payment layer (pay-per-call on POST /api/subscribe)

OKX.AI lists the paid service as A2MCP, so the listed endpoint implements the
[x402 standard](https://www.x402.org): HTTP 402 payment handshake, settled
instantly per call. Only `POST /api/subscribe` (the 7 USDT/month purchase) is
gated — the feed page, `/api/events`, `/api/tick`, `/api/digest` and
`/api/health` stay free (the free tier is the funnel).

**Modules** (same adapter pattern as the rest of the project):
- `src/x402/gate.js` — the handshake: builds the challenge (PaymentRequirements
  wrapped in `accepts[]`), decodes `PAYMENT-SIGNATURE` (or legacy `X-PAYMENT`),
  calls the facilitator, attaches `PAYMENT-RESPONSE`.
- `src/adapters/facilitator.js` — verify/settle. Mock = in-process +
  deterministic; real = OKX x402 facilitator over HTTPS.
- `scripts/x402-demo.js` — end-to-end demo client (`npm run x402-demo`).

**Envs:**

| Env | Meaning |
|---|---|
| `X402_MODE` | `off` (default — all routes behave exactly as before) \| `mock` (in-process facilitator, works today) \| `real` (OKX facilitator; fails fast without creds) |
| `X402_PAY_TO` | Owner wallet that receives payment (defaults to the `0xREPLACE_OWNER_WALLET` placeholder — set before go-live) |
| `OKX_X402_API_KEY` / `OKX_X402_SECRET` / `OKX_X402_PASSPHRASE` | Facilitator credentials, required only in real mode |
| `OKX_X402_FACILITATOR_URL` | Facilitator base URL override (default `https://web3.okx.com`) |

**Flow** (X402_MODE=mock or real):
1. `POST /api/subscribe` with no payment header → **HTTP 402** with header
   `PAYMENT-REQUIRED: base64(JSON challenge)` — the challenge is the FULL
   object `{x402Version: 1, resource: "/api/subscribe", accepts:
   [PaymentRequirements]}` (validators decode the header and read `accepts[]`;
   a bare PaymentRequirements object is rejected as "accepts is empty").
   The `accepts[0]` entry carries scheme `exact`, network `eip155:196`
   (X Layer), `maxAmountRequired: "7000000"` (7 USDT × 10^6, USDT has 6
   decimals), asset `0x779ded0c9e1022225f8e0630b35a9b54be713736` (USDT on
   X Layer). A small JSON body echoes the same challenge:
   `{ok: false, x402Version, resource, error, accepts: [requirements]}`.
2. Client signs the chosen `accepts[]` entry and retries with
   `PAYMENT-SIGNATURE: base64(JSON PaymentPayload)` (v2, checked first); the
   legacy v1 `X-PAYMENT: base64(JSON PaymentPayload)` header is still accepted
   as a fallback.
3. Server runs facilitator `verify()` then `settle()`; on success the normal
   subscribe handler runs — the subscriber is recorded with `tier: "paid"` and
   `paidUntil = now + 30 days` in `state/subscribers.json` — and the 200
   response carries `PAYMENT-RESPONSE: base64(JSON receipt)` (tx hash, network,
   payer, status). Any failure → 402 with an `error` field.

**Confirmed vs assumed:**
- ✅ Confirmed working (mock): full handshake verified by `npm run x402-demo`
  and 11 unit tests (off-mode passthrough, challenge shape with `accepts[]`,
  amount math, PAYMENT-SIGNATURE round trip with deterministic tx hash, legacy
  X-PAYMENT round trip, header precedence, bad-payment rejections).
- ⚠️ ASSUMED (real mode, commented in `src/adapters/facilitator.js`): the OKX
  facilitator endpoints `POST https://web3.okx.com/api/v6/pay/x402/verify` +
  `/settle` with body `{paymentPayload, paymentRequirements}`, authenticated
  with OKX v5-style HMAC headers (`OK-ACCESS-KEY`, `OK-ACCESS-SIGN` =
  base64(hmacSHA256(timestamp+method+requestPath+body, secret)),
  `OK-ACCESS-TIMESTAMP`, `OK-ACCESS-PASSPHRASE`). Header names/paths are
  pending confirmation against the official docs. **Alternative:** swap the
  hand-rolled real mode for the official OKX SDKs
  (`@okxweb3/x402-core` / `x402-express` middleware / `x402-evm`) once
  dependencies are acceptable — this project is intentionally zero-dep.
- Mock `verify` checks structure only (base64 JSON, scheme/network match,
  declared amount ≥ required); no signature or on-chain validation until real
  mode is wired.

## Known limitations / honest notes

- Mock scenario is finite: ticks past 5 return steady state ("no position changes") — by design.
- FLIP realized PnL is an estimate (mark-at-detection vs avg entry), same limitation the real version will have from polling ~5min.
- The digest window is "everything in `out/events.jsonl`", not a rolling 7 days yet — fine until the log spans more than a week; trim by `ts` when wiring cron.
- Subscribe flow and payments (Phase 4) are design-only; the mock broadcasts to a single sink. The web subscribe box stores contacts in `state/subscribers.json` but **delivers nothing yet** — the UI says so explicitly.
- The web server is a local demo console: no auth, no rate limiting, binds `127.0.0.1` by default. Harden before exposing publicly.
- `GET /api/digest` regenerates `out/digest-<date>.md` on every call (same as `npm run digest`).
- `state/` and `out/` are gitignored runtime artifacts; `npm run reset` clears them.

## Verified

- `npm test` → 29/29 pass (Node 24.14, Windows) — 18 original + 11 x402.
- `npm run x402-demo` → full mock handshake: 402 challenge decoded (full
  `{x402Version, resource, accepts[]}` object, requirements from `accepts[0]`)
  → mock PaymentPayload → PAYMENT-SIGNATURE retry → 200 with PAYMENT-RESPONSE
  receipt (deterministic 32-byte tx hash) → subscriber recorded with
  `tier: paid`, `paidUntil` +30d.
- `X402_MODE=off` (and unset) → `POST /api/subscribe` response byte-identical
  to the pre-x402 behavior; no payment headers emitted.
- `npm run demo` → end-to-end: 8 events detected, 6 alerts dispatched, 2 correctly filtered (tiny DOGE open below notional floor; DOGE size-down below score threshold), digest + 214/280-char X-post generated.
- `OKX_MODE=real node src/index.js tick` → fails fast with pointer to wiring notes (as intended).
