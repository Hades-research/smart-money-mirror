// Shared formatting helpers for alerts, logs, and the digest.

export function fmtUsd(n, { sign = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const s = n < 0 ? '-' : sign ? '+' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${s}$${(abs / 1_000).toFixed(0)}K`;
  return `${s}$${abs.toFixed(0)}`;
}

export function fmtPx(n) {
  if (n == null) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function fmtQty(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function fmtPct(n, digits = 1) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function coinOf(instId) {
  return String(instId).split('-')[0];
}

const EVENT_LABEL = {
  OPEN: 'NEW POSITION',
  CLOSE: 'POSITION CLOSED',
  FLIP: 'POSITION FLIP',
  SIZE_UP: 'SIZE UP ≥50%',
  SIZE_DOWN: 'SIZE DOWN ≥50%',
};

const EVENT_EMOJI = { OPEN: '🟢', CLOSE: '⚪', FLIP: '🔄', SIZE_UP: '📈', SIZE_DOWN: '📉' };

export function eventLabel(type) {
  return EVENT_LABEL[type] || type;
}

export function eventEmoji(type) {
  return EVENT_EMOJI[type] || '🐋';
}

// One-line description of the move itself, reused by alert + digest.
export function describeMove(ev) {
  const coin = coinOf(ev.instId);
  const side = (s) => (s === 'long' ? 'LONG' : 'SHORT');
  switch (ev.type) {
    case 'OPEN':
      return `opened ${side(ev.side)} ${fmtQty(ev.size)} ${coin} @ ${fmtPx(ev.entryPx)} (${ev.lever}x) — ${fmtUsd(ev.notionalUsd)}`;
    case 'CLOSE':
      return `closed ${side(ev.side)} ${fmtQty(ev.size)} ${coin} — ${fmtUsd(ev.notionalUsd)}${ev.realizedPnlUsd != null ? `, realized ${fmtUsd(ev.realizedPnlUsd, { sign: true })}` : ''}`;
    case 'FLIP':
      return `flipped ${coin} ${side(ev.prevSide)} → ${side(ev.side)} ${fmtQty(ev.size)} @ ${fmtPx(ev.entryPx)} (${ev.lever}x)${ev.realizedPnlUsd != null ? `, banked ${fmtUsd(ev.realizedPnlUsd, { sign: true })} on the ${ev.prevSide}` : ''}`;
    case 'SIZE_UP':
      return `added to ${side(ev.side)} ${coin}: ${fmtQty(ev.prevSize)} → ${fmtQty(ev.size)} (+${Math.round((ev.size / ev.prevSize - 1) * 100)}%) — now ${fmtUsd(ev.notionalUsd)}`;
    case 'SIZE_DOWN':
      return `cut ${side(ev.side)} ${coin}: ${fmtQty(ev.prevSize)} → ${fmtQty(ev.size)} (${Math.round((ev.size / ev.prevSize - 1) * 100)}%) — now ${fmtUsd(ev.notionalUsd)}`;
    default:
      return `${ev.type} ${coin}`;
  }
}

// Full alert body (plain text; telegram mock prints it, real mode wraps in HTML).
export function buildAlertText(ev, take, marketCtx) {
  const t = ev.trader;
  const shareTxt = ev.significance ? `${Math.round(ev.significance.bookShare * 100)}% of book` : '';
  const lines = [
    `${eventEmoji(ev.type)} SMART MONEY ALERT — ${eventLabel(ev.type)}`,
    `#${t.rank} ${t.name} (${t.badge}, 30d PnL ${fmtUsd(t.pnl30d, { sign: true })})`,
    `${ev.instId}: ${describeMove(ev)}`,
    `Position vs book: ${fmtUsd(ev.notionalUsd)} (${shareTxt})` +
      (marketCtx ? ` | ${coinOf(ev.instId)} ${fmtPx(marketCtx.markPx)} (${fmtPct(marketCtx.chg24hPct)} 24h)` : ''),
    ev.significance ? `Significance: ${ev.significance.score}/100` : null,
    '',
    `Why this matters: ${take}`,
  ].filter((l) => l !== null);
  return lines.join('\n');
}
