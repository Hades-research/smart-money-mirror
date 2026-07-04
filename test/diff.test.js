// Unit tests — Phase 1 diff engine (node:test, zero deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../src/diff.js';

const NOW = () => '2026-07-02T12:00:00.000Z';

const trader = (id, rank, positions, extra = {}) => ({
  id,
  name: `Trader_${id}`,
  rank,
  badge: 'Gold',
  pnl30d: 1_000_000,
  positions,
  ...extra,
});

const pos = (instId, side, size, entryPx = 100, lever = 5) => ({ instId, side, size, entryPx, lever });

const snap = (...traders) => ({ traders });

test('no changes → no events', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  assert.deepEqual(diffSnapshots(a, b, { now: NOW }), []);
});

test('OPEN detected for a new position', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10), pos('ETH-USDT-SWAP', 'short', 100, 3000)]));
  const events = diffSnapshots(a, b, { now: NOW });
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.type, 'OPEN');
  assert.equal(ev.instId, 'ETH-USDT-SWAP');
  assert.equal(ev.side, 'short');
  assert.equal(ev.size, 100);
  assert.equal(ev.trader.id, 't1');
  assert.equal(ev.ts, NOW());
});

test('CLOSE detected for a removed position, with realized pnl from marks', () => {
  const a = snap(trader('t1', 2, [pos('BTC-USDT-SWAP', 'long', 10, 100)]));
  const b = snap(trader('t1', 2, []));
  const events = diffSnapshots(a, b, { marks: { 'BTC-USDT-SWAP': 120 }, now: NOW });
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.type, 'CLOSE');
  assert.equal(ev.instId, 'BTC-USDT-SWAP');
  // long closed above entry → profit: (120 - 100) * 10
  assert.equal(ev.realizedPnlUsd, 200);
  assert.equal(ev.notionalUsd, 10 * 120);
});

test('CLOSE realized pnl respects short direction', () => {
  const a = snap(trader('t1', 2, [pos('BTC-USDT-SWAP', 'short', 10, 100)]));
  const b = snap(trader('t1', 2, []));
  const [ev] = diffSnapshots(a, b, { marks: { 'BTC-USDT-SWAP': 120 }, now: NOW });
  // short closed above entry → loss: (120 - 100) * 10 * -1
  assert.equal(ev.realizedPnlUsd, -200);
});

test('FLIP detected on side change (one event, not CLOSE+OPEN)', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10, 100)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'short', 8, 110)]));
  const events = diffSnapshots(a, b, { marks: { 'BTC-USDT-SWAP': 110 }, now: NOW });
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.type, 'FLIP');
  assert.equal(ev.prevSide, 'long');
  assert.equal(ev.side, 'short');
  assert.equal(ev.prevSize, 10);
  assert.equal(ev.size, 8);
  // pnl banked on the closed long leg: (110 - 100) * 10
  assert.equal(ev.realizedPnlUsd, 100);
});

test('SIZE_UP fires at exactly +50% (inclusive), not below', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 100)]));
  const exactly = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 150)]));
  const below = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 149)]));

  const hit = diffSnapshots(a, exactly, { now: NOW });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].type, 'SIZE_UP');
  assert.equal(hit[0].prevSize, 100);
  assert.equal(hit[0].size, 150);

  assert.deepEqual(diffSnapshots(a, below, { now: NOW }), []);
});

test('SIZE_DOWN fires at exactly -50% (inclusive), not above', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 100)]));
  const exactly = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 50)]));
  const above = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 51)]));

  const hit = diffSnapshots(a, exactly, { now: NOW });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].type, 'SIZE_DOWN');

  assert.deepEqual(diffSnapshots(a, above, { now: NOW }), []);
});

test('custom resize thresholds are honored', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 100)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 120)]));
  assert.equal(diffSnapshots(a, b, { now: NOW }).length, 0); // default 1.5x: no event
  const events = diffSnapshots(a, b, { sizeUpFactor: 1.2, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'SIZE_UP');
});

test('trader vanishing from leaderboard → CLOSE with traderDropped flag', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]), trader('t2', 2, [pos('ETH-USDT-SWAP', 'short', 5, 3000)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  const events = diffSnapshots(a, b, { now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'CLOSE');
  assert.equal(events[0].trader.id, 't2');
  assert.equal(events[0].traderDropped, true);
});

test('new trader entering leaderboard → OPEN with traderNew flag', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]), trader('t3', 3, [pos('SOL-USDT-SWAP', 'long', 1000, 150)]));
  const events = diffSnapshots(a, b, { now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OPEN');
  assert.equal(events[0].trader.id, 't3');
  assert.equal(events[0].traderNew, true);
});

test('multiple traders, multiple simultaneous events', () => {
  const a = snap(
    trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10, 100)]),
    trader('t2', 2, [pos('ETH-USDT-SWAP', 'short', 100, 3000), pos('SOL-USDT-SWAP', 'long', 1000, 150)]),
  );
  const b = snap(
    trader('t1', 1, [pos('BTC-USDT-SWAP', 'short', 12, 105)]), // flip
    trader('t2', 2, [pos('ETH-USDT-SWAP', 'short', 250, 3000)]), // size_up + sol close
  );
  const events = diffSnapshots(a, b, { now: NOW });
  const types = events.map((e) => `${e.trader.id}:${e.type}`).sort();
  assert.deepEqual(types, ['t1:FLIP', 't2:CLOSE', 't2:SIZE_UP']);
});

test('notional and book notional computed from marks (fallback: entry)', () => {
  const a = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10, 100)]));
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10, 100), pos('ETH-USDT-SWAP', 'long', 2, 3000)]));
  const [ev] = diffSnapshots(a, b, { marks: { 'BTC-USDT-SWAP': 200 }, now: NOW }); // no ETH mark → entry fallback
  assert.equal(ev.type, 'OPEN');
  assert.equal(ev.notionalUsd, 2 * 3000);
  assert.equal(ev.bookNotionalUsd, 10 * 200 + 2 * 3000);
});

test('baseline diff from empty snapshot reports OPENs (watcher suppresses these)', () => {
  const empty = { traders: [] };
  const b = snap(trader('t1', 1, [pos('BTC-USDT-SWAP', 'long', 10)]));
  const events = diffSnapshots(empty, b, { now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'OPEN');
  assert.equal(events[0].traderNew, true);
});
