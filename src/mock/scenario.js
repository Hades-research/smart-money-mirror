// Scripted mock scenario — the data spine of mock mode and the 90s demo.
// Consecutive ticks mutate a base leaderboard so the watcher's diff engine has
// interesting, story-shaped events to detect:
//
//   tick 1  baseline sync (10 traders, 14 positions — no alerts on first sync)
//   tick 2  #1 0xAxiom FLIPS BTC long→short (huge) ..... ALERT
//           #9 trims SOL -15% ......................... no event (below resize bar)
//           #10 opens tiny DOGE long ................... event, filtered (too small)
//   tick 3  #3 Nakamoto_Cartel opens BIG ETH long ...... ALERT
//           #8 adds +20% SOL ........................... no event
//   tick 4  #2 QuietWhale sizes SOL short +80% ......... ALERT
//           #5 MoonSonata capitulates ETH long (loss) ... ALERT
//           #4 trims ETH short -15% .................... no event
//   tick 5  #1 0xAxiom adds +60% to the BTC short ...... ALERT
//           #6 basisTrader9 takes BTC profit ........... ALERT
//           #7 LiqHunterX cuts DOGE short -60% ......... event, filtered (score below bar)
//
// Market drifts lower after tick 2, so the rank-1 flip reads prescient.
// Ticks > 5 return the tick-5 snapshot (steady state, no further events).

export const FINAL_TICK = 5;

const BASE_TRADERS = [
  { id: 'axiom',      name: '0xAxiom',         rank: 1,  badge: 'Legend', pnl30d: 2_840_000, positions: [
    { instId: 'BTC-USDT-SWAP', side: 'long', size: 210, entryPx: 64_900, lever: 5 },
    { instId: 'ETH-USDT-SWAP', side: 'long', size: 1_150, entryPx: 3_310, lever: 3 },
  ]},
  { id: 'quietwhale', name: 'QuietWhale',      rank: 2,  badge: 'Whale',  pnl30d: 1_920_000, positions: [
    { instId: 'SOL-USDT-SWAP', side: 'short', size: 45_000, entryPx: 158.4, lever: 4 },
    { instId: 'BTC-USDT-SWAP', side: 'long', size: 85, entryPx: 65_800, lever: 3 },
  ]},
  { id: 'nakamoto',   name: 'Nakamoto_Cartel', rank: 3,  badge: 'Gold',   pnl30d: 1_410_000, positions: [
    { instId: 'BTC-USDT-SWAP', side: 'long', size: 64, entryPx: 66_200, lever: 10 },
  ]},
  { id: 'delta',      name: 'delta_hedgerr',   rank: 4,  badge: 'Gold',   pnl30d: 980_000, positions: [
    { instId: 'ETH-USDT-SWAP', side: 'short', size: 820, entryPx: 3_540, lever: 5 },
    { instId: 'SOL-USDT-SWAP', side: 'long', size: 8_000, entryPx: 148, lever: 2 },
  ]},
  { id: 'moonsonata', name: 'MoonSonata',      rank: 5,  badge: 'Silver', pnl30d: 720_000, positions: [
    { instId: 'ETH-USDT-SWAP', side: 'long', size: 640, entryPx: 3_505, lever: 8 },
  ]},
  { id: 'basis9',     name: 'basisTrader9',    rank: 6,  badge: 'Silver', pnl30d: 540_000, positions: [
    { instId: 'BTC-USDT-SWAP', side: 'long', size: 38, entryPx: 63_100, lever: 2 },
  ]},
  { id: 'liqhunter',  name: 'LiqHunterX',      rank: 7,  badge: 'Silver', pnl30d: 410_000, positions: [
    { instId: 'DOGE-USDT-SWAP', side: 'short', size: 6_500_000, entryPx: 0.141, lever: 6 },
  ]},
  { id: 'seoul',      name: 'seoul_scalper',   rank: 8,  badge: 'Bronze', pnl30d: 350_000, positions: [
    { instId: 'SOL-USDT-SWAP', side: 'long', size: 3_400, entryPx: 149.9, lever: 10 },
  ]},
  { id: 'gamma',      name: 'GammaGoblin',     rank: 9,  badge: 'Bronze', pnl30d: 290_000, positions: [
    { instId: 'SOL-USDT-SWAP', side: 'long', size: 2_600, entryPx: 151.2, lever: 4 },
  ]},
  { id: 'wenlambo',   name: 'wen_lambo_wal',   rank: 10, badge: 'Bronze', pnl30d: 210_000, positions: [
    { instId: 'BTC-USDT-SWAP', side: 'long', size: 4.5, entryPx: 66_000, lever: 20 },
  ]},
];

// Per-tick market context: mark price, 24h change, funding, open-interest change.
const MARKET = {
  1: {
    'BTC-USDT-SWAP':  { markPx: 67_400, chg24hPct: 1.8,  fundingRatePct: 0.010,  oiChg24hPct: 1.2 },
    'ETH-USDT-SWAP':  { markPx: 3_480,  chg24hPct: 2.1,  fundingRatePct: 0.012,  oiChg24hPct: 0.8 },
    'SOL-USDT-SWAP':  { markPx: 152.3,  chg24hPct: 3.4,  fundingRatePct: 0.018,  oiChg24hPct: 2.2 },
    'DOGE-USDT-SWAP': { markPx: 0.128,  chg24hPct: 1.1,  fundingRatePct: 0.008,  oiChg24hPct: -0.5 },
  },
  2: {
    'BTC-USDT-SWAP':  { markPx: 67_510, chg24hPct: 0.9,  fundingRatePct: 0.014,  oiChg24hPct: 3.1 },
    'ETH-USDT-SWAP':  { markPx: 3_489,  chg24hPct: 1.2,  fundingRatePct: 0.013,  oiChg24hPct: 1.5 },
    'SOL-USDT-SWAP':  { markPx: 151.8,  chg24hPct: 1.9,  fundingRatePct: 0.015,  oiChg24hPct: 1.0 },
    'DOGE-USDT-SWAP': { markPx: 0.1268, chg24hPct: -0.4, fundingRatePct: 0.006,  oiChg24hPct: -1.2 },
  },
  3: {
    'BTC-USDT-SWAP':  { markPx: 67_320, chg24hPct: -0.3, fundingRatePct: 0.011,  oiChg24hPct: 2.4 },
    'ETH-USDT-SWAP':  { markPx: 3_462,  chg24hPct: -0.6, fundingRatePct: 0.015,  oiChg24hPct: 4.6 },
    'SOL-USDT-SWAP':  { markPx: 150.9,  chg24hPct: -0.9, fundingRatePct: 0.012,  oiChg24hPct: 0.4 },
    'DOGE-USDT-SWAP': { markPx: 0.125,  chg24hPct: -1.5, fundingRatePct: 0.004,  oiChg24hPct: -2.0 },
  },
  4: {
    'BTC-USDT-SWAP':  { markPx: 66_780, chg24hPct: -1.1, fundingRatePct: 0.006,  oiChg24hPct: -0.8 },
    'ETH-USDT-SWAP':  { markPx: 3_401,  chg24hPct: -1.8, fundingRatePct: 0.008,  oiChg24hPct: -1.4 },
    'SOL-USDT-SWAP':  { markPx: 148.2,  chg24hPct: -2.4, fundingRatePct: 0.005,  oiChg24hPct: -2.6 },
    'DOGE-USDT-SWAP': { markPx: 0.1216, chg24hPct: -2.7, fundingRatePct: 0.001,  oiChg24hPct: -3.1 },
  },
  5: {
    'BTC-USDT-SWAP':  { markPx: 66_150, chg24hPct: -2.0, fundingRatePct: -0.002, oiChg24hPct: -2.9 },
    'ETH-USDT-SWAP':  { markPx: 3_378,  chg24hPct: -2.3, fundingRatePct: -0.001, oiChg24hPct: -2.2 },
    'SOL-USDT-SWAP':  { markPx: 146.0,  chg24hPct: -3.1, fundingRatePct: -0.003, oiChg24hPct: -3.5 },
    'DOGE-USDT-SWAP': { markPx: 0.119,  chg24hPct: -3.4, fundingRatePct: -0.005, oiChg24hPct: -4.0 },
  },
};

// Ordered mutations applied cumulatively on top of the base snapshot.
// op: 'open' | 'close' | 'flip' | 'resize'
const OPS = {
  2: [
    { trader: 'axiom', op: 'flip', instId: 'BTC-USDT-SWAP', side: 'short', size: 180, entryPx: 67_520, lever: 5 },
    { trader: 'gamma', op: 'resize', instId: 'SOL-USDT-SWAP', size: 2_210 }, // -15%: below resize bar, no event
    { trader: 'wenlambo', op: 'open', instId: 'DOGE-USDT-SWAP', side: 'long', size: 900_000, entryPx: 0.1268, lever: 10 }, // tiny: filtered
  ],
  3: [
    { trader: 'nakamoto', op: 'open', instId: 'ETH-USDT-SWAP', side: 'long', size: 2_400, entryPx: 3_462, lever: 10 },
    { trader: 'seoul', op: 'resize', instId: 'SOL-USDT-SWAP', size: 4_100, entryPx: 150.1 }, // +20%: no event
  ],
  4: [
    { trader: 'quietwhale', op: 'resize', instId: 'SOL-USDT-SWAP', size: 81_000, entryPx: 153.9 }, // +80% add to short
    { trader: 'moonsonata', op: 'close', instId: 'ETH-USDT-SWAP' }, // capitulates an underwater long
    { trader: 'delta', op: 'resize', instId: 'ETH-USDT-SWAP', size: 700 }, // -15%: no event
  ],
  5: [
    { trader: 'axiom', op: 'resize', instId: 'BTC-USDT-SWAP', size: 288, entryPx: 67_006 }, // +60% conviction add
    { trader: 'basis9', op: 'close', instId: 'BTC-USDT-SWAP' }, // takes profit
    { trader: 'liqhunter', op: 'resize', instId: 'DOGE-USDT-SWAP', size: 2_600_000 }, // -60%: event, filtered by score
  ],
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function applyOp(traders, op) {
  const trader = traders.find((t) => t.id === op.trader);
  if (!trader) throw new Error(`scenario op references unknown trader: ${op.trader}`);
  const idx = trader.positions.findIndex((p) => p.instId === op.instId);
  switch (op.op) {
    case 'open':
      trader.positions.push({ instId: op.instId, side: op.side, size: op.size, entryPx: op.entryPx, lever: op.lever });
      break;
    case 'close':
      if (idx >= 0) trader.positions.splice(idx, 1);
      break;
    case 'flip':
      trader.positions[idx] = { instId: op.instId, side: op.side, size: op.size, entryPx: op.entryPx, lever: op.lever };
      break;
    case 'resize': {
      const pos = trader.positions[idx];
      pos.size = op.size;
      if (op.entryPx != null) pos.entryPx = op.entryPx; // avg entry moves on adds
      break;
    }
    default:
      throw new Error(`unknown scenario op: ${op.op}`);
  }
}

const clampTick = (tick) => Math.max(1, Math.min(FINAL_TICK, tick));

export function snapshotAt(tick) {
  const t = clampTick(tick);
  const traders = clone(BASE_TRADERS);
  for (let i = 2; i <= t; i++) {
    for (const op of OPS[i] ?? []) applyOp(traders, op);
  }
  return { traders };
}

export function marketAt(tick) {
  return clone(MARKET[clampTick(tick)]);
}
