// LLM adapter — the "why this matters" analyst paragraph.
// mode 'mock' (default): well-written canned templates interpolating the real
//                        event numbers + market context. Deterministic (hash-picked
//                        variant) so demos are reproducible.
// mode 'real'          : STUB — documents the exact Claude Messages API call,
//                        throws until ANTHROPIC_API_KEY exists.
//
// ────────────────────────────────────────────────────────────────────────────
// REAL-MODE WIRING NOTES
// ────────────────────────────────────────────────────────────────────────────
// Zero-dependency path (Node >= 18 global fetch — matches this repo's no-deps rule):
//
//   const res = await fetch('https://api.anthropic.com/v1/messages', {
//     method: 'POST',
//     headers: {
//       'content-type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//     body: JSON.stringify({
//       model: config.llm.model,            // 'claude-haiku-4-5' — cheap+fast for
//                                           // one-paragraph takes on every alert;
//                                           // use 'claude-opus-4-8' for max quality
//       max_tokens: config.llm.maxTokens,   // 300 — one tight paragraph
//       system: SYSTEM_PROMPT,              // see buildPrompt() below
//       messages: [{ role: 'user', content: buildPrompt(event, marketCtx) }],
//     }),
//   });
//   const data = await res.json();
//   if (!res.ok) throw new Error(`[llm] ${res.status} ${data?.error?.message}`);
//   if (data.stop_reason === 'refusal') return fallbackTemplate(event, marketCtx);
//   return data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
//
// If adding deps ever becomes acceptable, prefer the official SDK instead:
//   npm i @anthropic-ai/sdk   →   const client = new Anthropic();
//   await client.messages.create({ model, max_tokens, system, messages })
//
// Env var planned: ANTHROPIC_API_KEY. Keep the mock as the fallback path when
// the API errors — an alert with a templated take beats a dropped alert.
// ────────────────────────────────────────────────────────────────────────────

import { config } from '../../config.js';
import { fmtUsd, fmtPx, fmtPct, fmtQty, coinOf } from '../format.js';

export const SYSTEM_PROMPT =
  'You are the analyst voice of Smart Money Mirror, a service that alerts subscribers ' +
  'when top OKX leaderboard traders move. Given one position event and market context, ' +
  'write ONE tight paragraph (60-90 words) explaining why this move matters: what the ' +
  'trader is expressing, how it squares with funding/OI/price action, and what a subscriber ' +
  'might watch next. Confident, concrete, no hedging boilerplate, no financial advice disclaimer.';

// Used by the real-mode call and useful for eyeballing what the model would see.
export function buildPrompt(ev, m) {
  return [
    `EVENT: ${ev.type}`,
    `Trader: #${ev.trader.rank} ${ev.trader.name} (${ev.trader.badge}, 30d PnL ${fmtUsd(ev.trader.pnl30d, { sign: true })})`,
    `Instrument: ${ev.instId}`,
    `Detail: side=${ev.side} size=${ev.size} entry=${ev.entryPx} lever=${ev.lever}x notional=${fmtUsd(ev.notionalUsd)}`,
    ev.prevSide ? `Previous side: ${ev.prevSide} (size ${ev.prevSize})` : null,
    ev.prevSize && !ev.prevSide ? `Previous size: ${ev.prevSize}` : null,
    ev.realizedPnlUsd != null ? `Realized PnL on closed leg: ${fmtUsd(ev.realizedPnlUsd, { sign: true })}` : null,
    `Share of trader's book: ${Math.round((ev.significance?.bookShare ?? 0) * 100)}%`,
    m ? `Market: mark=${m.markPx} chg24h=${m.chg24hPct}% funding=${m.fundingRatePct}% OIchg24h=${m.oiChg24hPct}%` : null,
  ].filter(Boolean).join('\n');
}

// ── mock implementation ─────────────────────────────────────────────────────

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = (arr, key) => arr[hash(key) % arr.length];

function marketClause(m, coin) {
  if (!m) return '';
  const funding = m.fundingRatePct >= 0 ? `funding still positive at ${fmtPct(m.fundingRatePct, 3)}` : `funding now negative (${fmtPct(m.fundingRatePct, 3)})`;
  const oi = m.oiChg24hPct >= 0 ? `open interest up ${fmtPct(m.oiChg24hPct)}` : `open interest bleeding ${fmtPct(m.oiChg24hPct)}`;
  return `${coin} trades at ${fmtPx(m.markPx)} (${fmtPct(m.chg24hPct)} in 24h) with ${funding} and ${oi}.`;
}

const TEMPLATES = {
  FLIP: [
    (ev, m, coin, share) =>
      `This is the loudest signal a leaderboard trader can send. ${ev.trader.name} — ranked #${ev.trader.rank} with ${fmtUsd(ev.trader.pnl30d, { sign: true })} over 30 days — didn't trim the ${coin} ${ev.prevSide}, they reversed it entirely${ev.realizedPnlUsd != null ? `, banking ${fmtUsd(ev.realizedPnlUsd, { sign: true })} on the way out` : ''}. The new ${ev.side} is ${fmtUsd(ev.notionalUsd)} at ${ev.lever}x, roughly ${share}% of their entire book. ${marketClause(m, coin)} When the #${ev.trader.rank} trader pays the spread twice to change direction, they expect the move to be worth it — watch whether funding follows them.`,
    (ev, m, coin, share) =>
      `Full reversal from ${ev.trader.name} (#${ev.trader.rank}, ${ev.trader.badge}): ${coin} ${ev.prevSide} → ${ev.side}, now ${fmtUsd(ev.notionalUsd)} at ${ev.lever}x — about ${share}% of everything they have on. ${marketClause(m, coin)} Flips are rare precisely because they are expensive; a trader this ranked doesn't make that trade for a scalp. If price confirms lower, expect copy-flow to chase this within hours.`,
  ],
  OPEN: [
    (ev, m, coin, share) =>
      `${ev.trader.name} (#${ev.trader.rank}, 30d ${fmtUsd(ev.trader.pnl30d, { sign: true })}) just put on a fresh ${coin} ${ev.side} worth ${fmtUsd(ev.notionalUsd)} at ${ev.lever}x — instantly ${share}% of their book, which makes this a conviction trade rather than a probe. ${marketClause(m, coin)} New positions this size from top-3 accounts tend to front-run narrative, not follow it; the entry at ${fmtPx(ev.entryPx)} is the level to watch for invalidation.`,
    (ev, m, coin, share) =>
      `A cold open, and not a small one: ${fmtUsd(ev.notionalUsd)} of ${coin} ${ev.side} at ${ev.lever}x from ${ev.trader.name}, ranked #${ev.trader.rank}. It lands at ${share}% of their total exposure. ${marketClause(m, coin)} The sizing says they expect follow-through — if OI keeps building while they hold, this becomes the trade the rest of the leaderboard copies.`,
  ],
  CLOSE: [
    (ev, m, coin, share) =>
      `${ev.trader.name} (#${ev.trader.rank}) just took the ${coin} ${ev.side} off the table — ${fmtUsd(ev.notionalUsd)}, ${share}% of their book, realized ${fmtUsd(ev.realizedPnlUsd, { sign: true })}. ${marketClause(m, coin)} ${ev.realizedPnlUsd >= 0 ? 'Winners cashing out at rank like this often precede chop: the easy leg of the move may be done.' : 'A ranked trader eating a loss rather than averaging down is information — they see better uses for that margin, and capitulation from smart money often marks acceleration, not the bottom.'}`,
    (ev, m, coin, share) =>
      `Position gone: ${ev.trader.name} closed the entire ${coin} ${ev.side} (${fmtUsd(ev.notionalUsd)}, ~${share}% of book) for ${fmtUsd(ev.realizedPnlUsd, { sign: true })}. ${marketClause(m, coin)} ${ev.realizedPnlUsd >= 0 ? `That locks the win while funding still favors exit — de-risking from a #${ev.trader.rank} account is a sentiment data point in itself.` : 'Cutting instead of holding tells you their thesis broke; watch whether others in the top 10 follow within the next few ticks.'}`,
  ],
  SIZE_UP: [
    (ev, m, coin, share) =>
      `${ev.trader.name} (#${ev.trader.rank}) just pressed the ${coin} ${ev.side} ${Math.round((ev.size / ev.prevSize - 1) * 100)}% harder: ${fmtQty(ev.prevSize)} → ${fmtQty(ev.size)}, taking the position to ${fmtUsd(ev.notionalUsd)} — ${share}% of their book. ${marketClause(m, coin)} Adding into a working trade is how leaderboard accounts get to the top; the add repriced their average to ${fmtPx(ev.entryPx)}, so that's now the line they're defending.`,
    (ev, m, coin, share) =>
      `Doubling down, nearly literally: the ${coin} ${ev.side} from ${ev.trader.name} grew from ${fmtQty(ev.prevSize)} to ${fmtQty(ev.size)} contracts-worth (${fmtUsd(ev.notionalUsd)} total, ${share}% of book). ${marketClause(m, coin)} A #${ev.trader.rank} trader compounding into strength means they read this move as early, not late — the risk is now concentrated enough that their exit will also be a signal.`,
  ],
  SIZE_DOWN: [
    (ev, m, coin, share) =>
      `${ev.trader.name} (#${ev.trader.rank}) cut the ${coin} ${ev.side} by ${Math.round((1 - ev.size / ev.prevSize) * 100)}% — from ${fmtQty(ev.prevSize)} to ${fmtQty(ev.size)}, leaving ${fmtUsd(ev.notionalUsd)} on. ${marketClause(m, coin)} Halving a position without closing it reads as profit-protection, not a change of thesis; the remainder tells you they still want exposure if the move extends.`,
  ],
};

/**
 * Generate the one-paragraph "why this matters" take for a significant event.
 * @param {object} ev   assessed diff event (includes .significance)
 * @param {object} m    market context for ev.instId (may be undefined)
 * @returns {Promise<string>}
 */
export async function generateTake(ev, m) {
  if (config.mode === 'real') {
    throw new Error(
      '[llm adapter] real mode not wired yet — no ANTHROPIC_API_KEY exists. ' +
        'See REAL-MODE WIRING NOTES in src/adapters/llm.js (POST https://api.anthropic.com/v1/messages).',
    );
  }
  const coin = coinOf(ev.instId);
  const share = Math.round((ev.significance?.bookShare ?? (ev.notionalUsd / (ev.bookNotionalUsd || ev.notionalUsd))) * 100);
  const variants = TEMPLATES[ev.type] ?? TEMPLATES.OPEN;
  const template = pick(variants, `${ev.trader.id}|${ev.instId}|${ev.type}`);
  return template(ev, m, coin, share);
}
