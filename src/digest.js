// Phase 3 — weekly digest generator.
// Reads out/events.jsonl (written by the watcher), builds out/digest-<date>.md:
// top moves of the week, winners/losers, and an X-post-ready block (≤280 chars)
// for the traction plan.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { EVENTS_LOG, OUT_DIR, STATE_FILE, ensureDirs, readJson, readLines } from './paths.js';
import { fmtUsd, describeMove, eventLabel, coinOf } from './format.js';

function loadEvents() {
  return readLines(EVENTS_LOG)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function tweetFor(events, alerts, realizedTotal) {
  const { hashtag, tweetMaxChars } = config.digest;
  const channel = config.telegram.channelHandle;
  const top = alerts[0] ?? events[0];
  const topLine = top
    ? `Top: #${top.trader.rank} ${top.trader.name} ${shortMove(top)}.`
    : '';
  const candidates = [
    `🐋 Smart money on OKX this week: ${events.length} tracked moves, ${alerts.length} high-signal alerts. ${topLine} Realized by trackees: ${fmtUsd(realizedTotal, { sign: true })}. Follow the money that wins → ${channel} ${hashtag}`,
    `🐋 OKX smart money this week: ${alerts.length} high-signal moves. ${topLine} Follow the money that wins → ${channel} ${hashtag}`,
    `🐋 ${alerts.length} smart-money moves caught this week on OKX. Follow the money that wins → ${channel} ${hashtag}`,
  ];
  return candidates.find((c) => c.length <= tweetMaxChars) ?? candidates[candidates.length - 1].slice(0, tweetMaxChars);
}

function shortMove(ev) {
  const coin = coinOf(ev.instId);
  switch (ev.type) {
    case 'FLIP':
      return `flipped ${coin} ${ev.prevSide}→${ev.side}${ev.realizedPnlUsd != null ? `, banked ${fmtUsd(ev.realizedPnlUsd, { sign: true })}` : ''}`;
    case 'OPEN':
      return `opened a ${fmtUsd(ev.notionalUsd)} ${coin} ${ev.side}`;
    case 'CLOSE':
      return `closed ${coin} for ${fmtUsd(ev.realizedPnlUsd, { sign: true })}`;
    case 'SIZE_UP':
      return `pressed ${coin} ${ev.side} +${Math.round((ev.size / ev.prevSize - 1) * 100)}%`;
    case 'SIZE_DOWN':
      return `cut ${coin} ${ev.side} ${Math.round((ev.size / ev.prevSize - 1) * 100)}%`;
    default:
      return `moved ${coin}`;
  }
}

/** Build the digest markdown + write out/digest-<date>.md. Returns { file, markdown, tweet }. */
export async function buildDigest({ quiet = false } = {}) {
  ensureDirs();
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const events = loadEvents();

  if (events.length === 0) {
    log('No events logged yet — run `npm run demo` (or a few `npm run tick`s) first.');
    return { file: null, markdown: null, tweet: null };
  }

  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(OUT_DIR, `digest-${date}.md`);

  const alerts = events.filter((e) => e.alert).sort((a, b) => b.significance.score - a.significance.score);
  const topMoves = alerts.slice(0, config.digest.topMoves);
  const closes = events.filter((e) => e.realizedPnlUsd != null);
  const winners = closes.filter((e) => e.realizedPnlUsd > 0).sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);
  const losers = closes.filter((e) => e.realizedPnlUsd < 0).sort((a, b) => a.realizedPnlUsd - b.realizedPnlUsd);
  const realizedTotal = closes.reduce((s, e) => s + e.realizedPnlUsd, 0);

  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;

  const period = {
    from: events.reduce((min, e) => (e.ts < min ? e.ts : min), events[0].ts).slice(0, 10),
    to: events.reduce((max, e) => (e.ts > max ? e.ts : max), events[0].ts).slice(0, 10),
  };

  // 30d leaderboard standing from the latest snapshot (context for the digest).
  const state = readJson(STATE_FILE, null);
  const leaderboard = (state?.snapshot?.traders ?? []).slice().sort((a, b) => a.rank - b.rank);

  const tweet = tweetFor(events, alerts, realizedTotal);

  const md = [];
  md.push(`# Smart Money Mirror — Weekly Digest (${period.from}${period.to !== period.from ? ` → ${period.to}` : ''})`);
  md.push('');
  md.push(`**${events.length} moves tracked** across the OKX smart-money top ${config.leaderboardSize} · **${alerts.length} cleared the significance bar** and were alerted · realized PnL across tracked closes: **${fmtUsd(realizedTotal, { sign: true })}**`);
  md.push('');
  md.push(`Event mix: ${Object.entries(byType).map(([t, n]) => `${eventLabel(t)} ×${n}`).join(' · ')}`);
  md.push('');
  md.push('## Top moves of the week');
  md.push('');
  topMoves.forEach((ev, i) => {
    md.push(`### ${i + 1}. ${eventLabel(ev.type)} — #${ev.trader.rank} ${ev.trader.name} · ${ev.instId} · score ${ev.significance.score}/100`);
    md.push('');
    md.push(`> ${ev.trader.name} ${describeMove(ev)}`);
    md.push('');
    if (ev.take) {
      md.push(`**Why it mattered:** ${ev.take}`);
      md.push('');
    }
  });
  md.push('## Winners & losers (realized, tracked closes)');
  md.push('');
  if (winners.length) {
    md.push('**Winners**');
    md.push('');
    for (const e of winners) md.push(`- ${e.trader.name} (#${e.trader.rank}) — ${coinOf(e.instId)} ${e.prevSide ? `${e.prevSide} (via flip)` : e.side}: **${fmtUsd(e.realizedPnlUsd, { sign: true })}**`);
    md.push('');
  }
  if (losers.length) {
    md.push('**Losers**');
    md.push('');
    for (const e of losers) md.push(`- ${e.trader.name} (#${e.trader.rank}) — ${coinOf(e.instId)} ${e.prevSide ? `${e.prevSide} (via flip)` : e.side}: **${fmtUsd(e.realizedPnlUsd, { sign: true })}**`);
    md.push('');
  }
  if (!winners.length && !losers.length) {
    md.push('_No positions were closed this period._');
    md.push('');
  }
  if (leaderboard.length) {
    md.push('## Leaderboard standing (30d PnL)');
    md.push('');
    md.push('| # | Trader | Badge | 30d PnL | Open positions |');
    md.push('|---|--------|-------|---------|----------------|');
    for (const t of leaderboard) {
      md.push(`| ${t.rank} | ${t.name} | ${t.badge} | ${fmtUsd(t.pnl30d, { sign: true })} | ${t.positions.map((p) => `${coinOf(p.instId)} ${p.side}`).join(', ') || '—'} |`);
    }
    md.push('');
  }
  md.push('## X-post (ready to ship)');
  md.push('');
  md.push('```');
  md.push(tweet);
  md.push('```');
  md.push('');
  md.push(`_${tweet.length}/280 chars · generated by Smart Money Mirror · subscribe: ${config.telegram.channelHandle} ($5–10/mo real-time alerts, weekly digest free)_`);
  md.push('');

  const markdown = md.join('\n');
  fs.writeFileSync(file, markdown, 'utf8');

  log(`digest written → ${file}`);
  log('');
  log('X-post block:');
  log(`  ${tweet}`);
  log(`  (${tweet.length}/280 chars)`);

  return { file, markdown, tweet };
}
