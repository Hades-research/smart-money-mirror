#!/usr/bin/env node
// Smart Money Mirror — CLI entrypoint.
//
//   node src/index.js tick     one watcher pass (fetch → diff → filter → alert)
//   node src/index.js digest   build out/digest-<date>.md from the event log
//   node src/index.js demo     reset + 5 scripted ticks + digest (the 90s demo)
//   node src/index.js reset    wipe state/ and out/ for a fresh run
//
// Mode: OKX_MODE=mock (default, fully offline) | OKX_MODE=real (needs keys; stubs throw).

import { config } from '../config.js';
import { runTick } from './watcher.js';
import { buildDigest } from './digest.js';
import { resetRuntime } from './paths.js';
import { FINAL_TICK } from './mock/scenario.js';

const HELP = `Smart Money Mirror — whale-move alerts + weekly digest (mode: ${config.mode})

Usage:
  node src/index.js tick     Run one watcher tick (diff leaderboard vs state, alert on significant moves)
  node src/index.js digest   Generate out/digest-<date>.md from the event log
  node src/index.js demo     Full scripted demo: reset -> ${FINAL_TICK} ticks -> digest
  node src/index.js reset    Clear state/ and out/

Env:
  OKX_MODE=mock|real   (default mock; real mode throws until credentials are wired — see src/adapters/*)
`;

function banner(text) {
  const line = '═'.repeat(80);
  console.log(`\n${line}\n  ${text}\n${line}`);
}

async function demo() {
  banner(`SMART MONEY MIRROR — scripted demo (mode: ${config.mode})`);
  console.log('\nPitch: the top 10 traders on OKX just moved. Did you see it? Subscribers did.\n');
  resetRuntime();

  let totalEvents = 0;
  let totalAlerts = 0;
  for (let i = 1; i <= FINAL_TICK; i++) {
    banner(`TICK ${i} of ${FINAL_TICK} — watcher polls the smart-money leaderboard`);
    const res = await runTick();
    totalEvents += res.events.length;
    totalAlerts += res.alerts.length;
  }

  banner('WEEKLY DIGEST — free tier + the viral surface');
  await buildDigest();

  banner('DEMO COMPLETE');
  console.log(`
  ${totalEvents} position events detected → ${totalAlerts} high-signal alerts dispatched.
  Artifacts:
    state/positions.json   last-seen positions per tracked trader
    out/events.jsonl       every event with score + filter verdict + analyst take
    out/alerts.log         every dispatched alert (mock Telegram sink)
    out/digest-*.md        weekly digest incl. X-post block (#okxai)

  "Follow the money that wins. $5/month."
`);
}

async function main() {
  const cmd = process.argv[2] ?? 'help';
  switch (cmd) {
    case 'tick':
      await runTick();
      break;
    case 'digest':
      await buildDigest();
      break;
    case 'demo':
      await demo();
      break;
    case 'reset':
      resetRuntime();
      console.log('state/ and out/ cleared.');
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n[smart-money-mirror] ${err.message}`);
  process.exitCode = 1;
});
