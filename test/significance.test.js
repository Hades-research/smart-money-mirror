// Unit tests — Phase 2 significance filter basics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvent, assessEvents } from '../src/significance.js';
import { config } from '../config.js';

const cfg = config.significance;

const ev = (over = {}) => ({
  type: 'OPEN',
  trader: { id: 't', name: 'T', rank: 1, badge: 'Gold', pnl30d: 1e6 },
  instId: 'BTC-USDT-SWAP',
  side: 'long',
  size: 10,
  entryPx: 100,
  lever: 5,
  markPx: 100,
  notionalUsd: 1_000_000,
  bookNotionalUsd: 1_000_000,
  ...over,
});

test('flip outranks open outranks resize, all else equal', () => {
  const flip = scoreEvent(ev({ type: 'FLIP' }), cfg).score;
  const open = scoreEvent(ev({ type: 'OPEN' }), cfg).score;
  const sizeUp = scoreEvent(ev({ type: 'SIZE_UP' }), cfg).score;
  assert.ok(flip > open, `flip ${flip} should beat open ${open}`);
  assert.ok(open > sizeUp, `open ${open} should beat size_up ${sizeUp}`);
});

test('rank 1 outranks rank 10, all else equal', () => {
  const top = scoreEvent(ev(), cfg).score;
  const bottom = scoreEvent(ev({ trader: { rank: 10 } }), cfg).score;
  assert.ok(top > bottom);
});

test('minNotionalUsd gates alerts regardless of score', () => {
  const tiny = ev({ notionalUsd: cfg.minNotionalUsd - 1, bookNotionalUsd: cfg.minNotionalUsd - 1, type: 'FLIP' });
  const [assessed] = assessEvents([tiny], cfg);
  assert.equal(assessed.alert, false);
  assert.match(assessed.filteredReason, /notional/);
});

test('rank-1 full-book flip clears the alert threshold', () => {
  const [assessed] = assessEvents([ev({ type: 'FLIP' })], cfg);
  assert.equal(assessed.alert, true);
  assert.ok(assessed.significance.score >= cfg.alertThreshold);
});

test('dropped-trader closes are down-weighted', () => {
  const normal = scoreEvent(ev({ type: 'CLOSE' }), cfg).score;
  const dropped = scoreEvent(ev({ type: 'CLOSE', traderDropped: true }), cfg).score;
  assert.ok(dropped < normal);
});
