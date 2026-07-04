// Telegram adapter — subscriber delivery.
// mode 'mock' (default): prints the formatted alert to the console AND appends
//                        it to out/alerts.log with a timestamp. Fully working.
// mode 'real'          : STUB — documents the exact Bot API call + subscribe
//                        flow, throws until TELEGRAM_BOT_TOKEN exists.
//
// ────────────────────────────────────────────────────────────────────────────
// REAL-MODE WIRING NOTES — Bot API
// ────────────────────────────────────────────────────────────────────────────
// 1. Create the bot with @BotFather → env var TELEGRAM_BOT_TOKEN.
// 2. Send an alert (zero-dep, Node >= 18 global fetch):
//
//    const res = await fetch(
//      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
//      {
//        method: 'POST',
//        headers: { 'content-type': 'application/json' },
//        body: JSON.stringify({
//          chat_id,                       // one call per subscriber chat id
//          text,                          // the alert body
//          parse_mode: 'HTML',            // HTML is safer than MarkdownV2 (no
//                                         // escaping of . - ! etc.); wrap the
//                                         // headline in <b>…</b>, take in plain text
//          disable_web_page_preview: true,
//        }),
//      },
//    );
//    const data = await res.json();
//    if (!data.ok) throw new Error(`[telegram] ${data.error_code} ${data.description}`);
//
//    Rate limits: ~30 messages/second overall, 1 msg/sec per chat — add a tiny
//    queue with delay when broadcasting to many subscribers.
//
// ────────────────────────────────────────────────────────────────────────────
// SUBSCRIBE-FLOW DESIGN (commands: /start /stop /threshold)
// ────────────────────────────────────────────────────────────────────────────
// State: state/subscribers.json →
//   { "<chat_id>": { tier: 'free'|'paid', threshold: 65, since: ISO } }
//
// Receive updates via long-poll (simplest; no public URL needed):
//   GET https://api.telegram.org/bot<TOKEN>/getUpdates?timeout=50&offset=<last+1>
//   → data.result[].message: { chat: { id }, text }
//   (Production alternative: setWebhook to an HTTPS endpoint.)
//
// Command handling:
//   /start          → upsert subscriber { tier:'free', threshold: config default }.
//                     Reply with welcome + sample alert + upgrade pitch ($5-10/mo).
//                     Free tier receives the weekly digest; paid receives real-time
//                     alerts (tier flag checked at dispatch time).
//   /stop           → delete subscriber; confirm with a "come back anytime" message.
//   /threshold <n>  → clamp n to 50..95, store per-subscriber threshold; dispatch
//                     then sends an alert to a subscriber only when
//                     event.significance.score >= their threshold. Reply confirms
//                     e.g. "You'll now only get moves scoring ≥ 80/100."
//   anything else   → short help text listing the three commands.
//
// Payments (Phase 4): gate tier:'paid' via OKX Pay / Stripe link; the bot only
// flips the tier flag after the webhook confirms payment. Out of scope here.
// ────────────────────────────────────────────────────────────────────────────

import { config } from '../../config.js';
import { ALERTS_LOG, appendLine, ensureDirs } from '../paths.js';

const BOX_WIDTH = 78;

function boxed(text) {
  const top = '┌' + '─'.repeat(BOX_WIDTH) + '┐';
  const bottom = '└' + '─'.repeat(BOX_WIDTH) + '┘';
  const wrap = (line) => {
    const out = [];
    let rest = line;
    do {
      out.push(rest.slice(0, BOX_WIDTH - 2));
      rest = rest.slice(BOX_WIDTH - 2);
    } while (rest.length > 0);
    return out;
  };
  const body = text
    .split('\n')
    .flatMap(wrap)
    .map((l) => '│ ' + l.padEnd(BOX_WIDTH - 2) + ' │');
  return [top, ...body, bottom].join('\n');
}

/**
 * Deliver one alert to subscribers.
 * Mock: console + out/alerts.log. Real: Telegram sendMessage per subscriber.
 * @param {string} text fully formatted alert body
 * @returns {Promise<{delivered: string}>}
 */
export async function sendAlert(text) {
  if (config.mode === 'real') {
    throw new Error(
      '[telegram adapter] real mode not wired yet — no TELEGRAM_BOT_TOKEN exists. ' +
        'See REAL-MODE WIRING NOTES + SUBSCRIBE-FLOW DESIGN in src/adapters/telegram.js.',
    );
  }
  ensureDirs();
  console.log(boxed(text));
  const stamp = new Date().toISOString();
  appendLine(ALERTS_LOG, `[${stamp}]\n${text}\n${'-'.repeat(BOX_WIDTH)}`);
  return { delivered: 'console+alerts.log' };
}
