// Phase 1 — the diff engine.
// Pure function: compares two leaderboard snapshots and emits position events.
// No I/O, no clock (injectable), fully unit-testable.
//
// Snapshot shape (produced by src/adapters/okx.js):
//   { traders: [ { id, name, rank, badge, pnl30d,
//                  positions: [ { instId, side: 'long'|'short', size, entryPx, lever } ] } ] }
//
// Event types:
//   OPEN      — position exists now, didn't before
//   CLOSE     — position existed before, gone now
//   FLIP      — same instrument, side changed (long→short or short→long)
//   SIZE_UP   — same side, size grew    >= sizeUpFactor   (default 1.5x = +50%)
//   SIZE_DOWN — same side, size shrank  <= sizeDownFactor (default 0.5x = -50%)

const DEFAULTS = { sizeUpFactor: 1.5, sizeDownFactor: 0.5 };

export function diffSnapshots(prev, curr, opts = {}) {
  const { marks = {}, sizeUpFactor = DEFAULTS.sizeUpFactor, sizeDownFactor = DEFAULTS.sizeDownFactor, now } = opts;
  const ts = now ? now() : new Date().toISOString();
  const events = [];

  const markOf = (pos) => marks[pos.instId] ?? pos.entryPx;
  const notionalOf = (pos) => pos.size * markOf(pos);
  const bookOf = (trader) => trader.positions.reduce((sum, p) => sum + notionalOf(p), 0);
  const realized = (pos) => {
    const dir = pos.side === 'long' ? 1 : -1;
    return (markOf(pos) - pos.entryPx) * pos.size * dir;
  };
  const traderMeta = (t) => ({ id: t.id, name: t.name, rank: t.rank, badge: t.badge, pnl30d: t.pnl30d });

  const prevById = new Map((prev?.traders ?? []).map((t) => [t.id, t]));
  const currById = new Map((curr?.traders ?? []).map((t) => [t.id, t]));

  const base = (trader, pos, extra) => ({
    ts,
    trader: traderMeta(trader),
    instId: pos.instId,
    side: pos.side,
    size: pos.size,
    entryPx: pos.entryPx,
    lever: pos.lever,
    markPx: markOf(pos),
    notionalUsd: notionalOf(pos),
    ...extra,
  });

  // Traders present now.
  for (const currTrader of currById.values()) {
    const prevTrader = prevById.get(currTrader.id);
    const currBook = bookOf(currTrader);

    if (!prevTrader) {
      // Trader newly entered the tracked leaderboard: report positions as OPENs.
      for (const pos of currTrader.positions) {
        events.push(base(currTrader, pos, { type: 'OPEN', bookNotionalUsd: currBook, traderNew: true }));
      }
      continue;
    }

    const prevBook = bookOf(prevTrader);
    const prevPos = new Map(prevTrader.positions.map((p) => [p.instId, p]));
    const currPos = new Map(currTrader.positions.map((p) => [p.instId, p]));

    for (const [instId, pos] of currPos) {
      const old = prevPos.get(instId);
      if (!old) {
        events.push(base(currTrader, pos, { type: 'OPEN', bookNotionalUsd: currBook }));
      } else if (old.side !== pos.side) {
        events.push(
          base(currTrader, pos, {
            type: 'FLIP',
            prevSide: old.side,
            prevSize: old.size,
            prevEntryPx: old.entryPx,
            prevNotionalUsd: notionalOf(old),
            realizedPnlUsd: realized(old), // pnl banked on the leg that was closed to flip
            bookNotionalUsd: currBook,
          }),
        );
      } else if (old.size > 0 && pos.size >= old.size * sizeUpFactor) {
        events.push(
          base(currTrader, pos, {
            type: 'SIZE_UP',
            prevSize: old.size,
            prevNotionalUsd: notionalOf(old),
            bookNotionalUsd: currBook,
          }),
        );
      } else if (old.size > 0 && pos.size <= old.size * sizeDownFactor) {
        events.push(
          base(currTrader, pos, {
            type: 'SIZE_DOWN',
            prevSize: old.size,
            prevNotionalUsd: notionalOf(old),
            bookNotionalUsd: currBook,
          }),
        );
      }
      // smaller size drift: intentionally no event
    }

    for (const [instId, old] of prevPos) {
      if (!currPos.has(instId)) {
        events.push(
          base(currTrader, old, {
            type: 'CLOSE',
            realizedPnlUsd: realized(old),
            bookNotionalUsd: prevBook, // share of the book it occupied before closing
          }),
        );
      }
    }
  }

  // Traders that vanished from the leaderboard: positions are out of sight, not
  // necessarily closed — flag them so the significance filter can down-weight.
  for (const prevTrader of prevById.values()) {
    if (currById.has(prevTrader.id)) continue;
    const prevBook = bookOf(prevTrader);
    for (const pos of prevTrader.positions) {
      events.push(
        base(prevTrader, pos, {
          type: 'CLOSE',
          realizedPnlUsd: realized(pos),
          bookNotionalUsd: prevBook,
          traderDropped: true,
        }),
      );
    }
  }

  return events;
}
