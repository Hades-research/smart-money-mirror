// The watcher tick — one full pipeline pass:
//   fetch snapshot → diff vs state → score/filter → analyst take → dispatch →
//   persist state + event log.
// In production this runs on a ~5min cron; here `node src/index.js tick` runs one pass.

import { config } from '../config.js';
import * as okx from './adapters/okx.js';
import { diffSnapshots } from './diff.js';
import { assessEvents } from './significance.js';
import { writeTake } from './analyst.js';
import { dispatchAlert } from './dispatch.js';
import { describeMove } from './format.js';
import { STATE_FILE, EVENTS_LOG, ensureDirs, readJson, writeJson, appendLine } from './paths.js';

function loadState() {
  return readJson(STATE_FILE, { tick: 0, snapshot: null, updatedAt: null });
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function collectInstIds(...snapshots) {
  const ids = new Set();
  for (const snap of snapshots) {
    for (const t of snap?.traders ?? []) {
      for (const p of t.positions) ids.add(p.instId);
    }
  }
  return [...ids];
}

/** Run one watcher tick. Returns a summary object (used by demo + tests). */
export async function runTick({ quiet = false } = {}) {
  ensureDirs();
  const log = quiet ? () => {} : (...a) => console.log(...a);

  const state = loadState();
  const tick = state.tick + 1;

  const snapshot = await okx.fetchLeaderboard({ tick });
  const instIds = collectInstIds(snapshot, state.snapshot);
  const market = await okx.fetchMarketContext(instIds, { tick });
  const marks = Object.fromEntries(Object.entries(market).map(([id, m]) => [id, m.markPx]));

  // First ever tick = baseline sync. Record positions, alert on nothing —
  // otherwise every existing position would spam an OPEN alert.
  if (!state.snapshot) {
    saveState({ tick, snapshot, updatedAt: new Date().toISOString() });
    const positions = snapshot.traders.reduce((n, t) => n + t.positions.length, 0);
    log(`[tick ${tick}] baseline synced — tracking ${snapshot.traders.length} traders, ${positions} open positions. No alerts on first sync.`);
    return { tick, baseline: true, events: [], alerts: [] };
  }

  const rawEvents = diffSnapshots(state.snapshot, snapshot, { marks, ...config.resize });
  const assessed = assessEvents(rawEvents, config.significance);

  const alerts = [];
  for (const ev of assessed) {
    let take = null;
    if (ev.alert) {
      take = await writeTake(ev, market[ev.instId]);
      await dispatchAlert(ev, take, market[ev.instId]);
      alerts.push(ev);
    } else {
      log(`  · filtered ${ev.type} — ${ev.trader.name} ${describeMove(ev)}  (${ev.filteredReason})`);
    }
    appendLine(EVENTS_LOG, JSON.stringify({ ...ev, take, market: market[ev.instId] ?? null }));
  }

  saveState({ tick, snapshot, updatedAt: new Date().toISOString() });

  log(`[tick ${tick}] ${rawEvents.length} event(s) detected → ${alerts.length} alert(s) sent, ${rawEvents.length - alerts.length} filtered.`);
  if (rawEvents.length === 0) log('  · no position changes vs last snapshot.');

  return { tick, baseline: false, events: assessed, alerts };
}
