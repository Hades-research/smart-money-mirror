// OKX adapter — smart-money leaderboard + market data.
// mode 'mock' (default): fully working, driven by src/mock/scenario.js
// mode 'real'          : STUB — documents the exact rails to wire, throws until keys exist.
// Switch with env var OKX_MODE=real.
//
// ────────────────────────────────────────────────────────────────────────────
// REAL-MODE WIRING NOTES (CLI surface verified against okx/agent-skills docs
// + the CLI's own `list-tools` schema, 2026-07-02)
// ────────────────────────────────────────────────────────────────────────────
// Preferred rails: OKX's agent CLI (npm `@okx_ai/okx-trade-cli` — one binary
// powers the smart-money + market-data skills). Install locally, no -g:
//     npm install @okx_ai/okx-trade-cli
//     ./node_modules/.bin/okx list-tools --json     # sanity check (163 tools)
//
// Leaderboard + positions (smartmoney module — AUTH REQUIRED, live-only;
// signal/leaderboard data covers USDT/USDS-margined linear contracts only):
//     okx smartmoney traders-by-filter --sortBy pnl --period 30 --minWinRate 0.5 --limit 10 --json
//     okx smartmoney trader-positions --authorId <ID> --json
//     okx smartmoney performance-by-trader --authorIds <ID1,ID2> --json
// Auth is either OAuth device flow (`okx auth login --manual --site global`)
// or API keys in ~/.okx/config.toml via `okx config init` (Read perms only,
// never Withdraw). API-key config always wins over an OAuth session.
//
// Market context (market module — NO AUTH, public, rate limit 20 req/2s/IP):
//     okx market ticker BTC-USDT-SWAP --json
//     okx market mark-price --instType SWAP --instId BTC-USDT-SWAP --json
//     okx market funding-rate BTC-USDT-SWAP --json
//     okx market open-interest --instType SWAP --json
// Call the CLI as a subprocess, parse `data` out of the {code,msg,data}
// envelope. If it reports "Failed to call OKX endpoint", it is usually local
// DNS/proxy — the CLI honors HTTPS_PROXY / OKX_API_BASE_URL and ships an
// `okx diagnose` command for exactly this.
//
// Fallback: the raw OKX REST v5 endpoints the CLI wraps (public, no auth
// required for public copy-trading data; verify field names against docs
// before use):
//
//   1) Leaderboard (top lead traders):
//      GET https://www.okx.com/api/v5/copytrading/public-lead-traders
//          ?instType=SWAP&sortType=pnl&limit=10
//      → data[].ranks[]: { uniqueCode, nickName, pnl, winRatio, leadDays, ... }
//
//   2) A lead trader's current positions:
//      GET https://www.okx.com/api/v5/copytrading/public-current-subpositions
//          ?instType=SWAP&uniqueCode=<uniqueCode>
//      → data[]: { instId, posSide ('long'|'short'), subPos (size), openAvgPx,
//                  lever, margin, upl, ... }
//
//   3) Market context per instrument:
//      GET https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP
//          → last, open24h (derive chg24hPct), vol24h
//      GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP
//          → fundingRate (fraction; ×100 for %)
//      GET https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP
//          → oi, oiCcy (diff vs previous tick to get oiChg24hPct, or use
//            /api/v5/rubik/stat/contracts/open-interest-volume)
//
// Auth: the endpoints above are public. If a private endpoint is ever needed,
// OKX v5 signs requests with headers OK-ACCESS-KEY / OK-ACCESS-SIGN (HMAC-SHA256
// of timestamp+method+path+body, base64) / OK-ACCESS-TIMESTAMP / OK-ACCESS-PASSPHRASE.
// Env vars planned: OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE.
//
// The real implementation must return the SAME shapes the mock returns below,
// so nothing downstream (diff, significance, analyst, dispatch) changes.
// ────────────────────────────────────────────────────────────────────────────

import { config } from '../../config.js';
import { snapshotAt, marketAt } from '../mock/scenario.js';

// OKX public REST (copy-trading leaderboard + market data are all public — no
// auth). Real mode reads these directly; zero deps (Node global fetch).
const OKX_BASE = process.env.OKX_API_BASE_URL || 'https://www.okx.com';
const OKX_HTTP_TIMEOUT_MS = Number(process.env.OKX_HTTP_TIMEOUT_MS || 8000);

async function okxGet(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OKX_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${OKX_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (smart-money-mirror)' },
    });
    if (!res.ok) throw new Error(`OKX HTTP ${res.status} for ${path}`);
    const json = await res.json();
    if (String(json.code) !== '0') throw new Error(`OKX API ${json.code}: ${json.msg}`);
    return json.data;
  } finally {
    clearTimeout(t);
  }
}

function badgeForRank(rank) {
  if (rank === 1) return 'Legend';
  if (rank <= 3) return 'Whale';
  if (rank <= 6) return 'Gold';
  return 'Silver';
}

/** Map a lead trader's public sub-positions to the mock position shape. */
async function realTraderPositions(uniqueCode) {
  const rows = await okxGet(
    `/api/v5/copytrading/public-current-subpositions?instType=SWAP&uniqueCode=${encodeURIComponent(uniqueCode)}`
  );
  return (rows || [])
    .filter((r) => r.instId && (r.posSide === 'long' || r.posSide === 'short') && Number(r.subPos) > 0)
    .map((r) => ({
      instId: r.instId,
      side: r.posSide,
      size: Number(r.subPos),
      entryPx: Number(r.openAvgPx),
      lever: Number(r.lever),
    }));
}

/**
 * Fetch the current smart-money leaderboard snapshot.
 * @param {{tick?: number}} opts mock mode uses `tick` to advance the scripted scenario
 * @returns {Promise<{traders: Array<{id,name,rank,badge,pnl30d,positions:Array<{instId,side,size,entryPx,lever}>}>}>}
 */
export async function fetchLeaderboard({ tick = 1 } = {}) {
  if (config.mode !== 'real') return snapshotAt(tick);

  // Real: OKX public copy-trading leaderboard + each trader's live positions.
  // No auth. `tick` is irrelevant in real mode — every call returns the live
  // snapshot; the watcher diffs consecutive snapshots to detect moves.
  const size = config.leaderboardSize || 10;
  const data = await okxGet(
    `/api/v5/copytrading/public-lead-traders?instType=SWAP&sortType=pnl&limit=${size}`
  );
  const ranks = (data?.[0]?.ranks) || [];
  if (ranks.length === 0) throw new Error('OKX leaderboard returned no traders');

  const traders = [];
  for (let i = 0; i < ranks.length; i++) {
    const t = ranks[i];
    let positions = [];
    try {
      positions = await realTraderPositions(t.uniqueCode);
    } catch {
      positions = []; // a trader whose positions momentarily fail → no positions this tick
    }
    const pnlRatio = Number(t.pnlRatio ?? 0);
    const aum = Number(t.aum ?? 0);
    traders.push({
      id: t.uniqueCode,
      name: t.nickName || `Trader ${t.uniqueCode?.slice(0, 6)}`,
      rank: i + 1,
      badge: badgeForRank(i + 1),
      // pnl30d as a USD-scale figure: prefer a direct pnl field, else estimate
      // from AUM × 30d PnL ratio (real numbers, clearly an estimate).
      pnl30d: Math.round(t.pnl != null ? Number(t.pnl) : aum * pnlRatio),
      positions,
    });
  }
  return { traders };
}

/**
 * Fetch market context for a set of instruments.
 * @param {string[]} instIds
 * @param {{tick?: number}} opts
 * @returns {Promise<Record<string, {markPx:number, chg24hPct:number, fundingRatePct:number, oiChg24hPct:number}>>}
 */
export async function fetchMarketContext(instIds, { tick = 1 } = {}) {
  if (config.mode !== 'real') {
    const all = marketAt(tick);
    const out = {};
    for (const id of instIds) {
      if (all[id]) out[id] = all[id];
    }
    return out;
  }

  // Real: public ticker + funding per instrument (no auth). OI change needs
  // history we don't fetch here, so oiChg24hPct is left 0.
  const out = {};
  for (const id of instIds) {
    try {
      const [tk] = await okxGet(`/api/v5/market/ticker?instId=${encodeURIComponent(id)}`);
      const last = Number(tk.last);
      const open24h = Number(tk.open24h) || last;
      let fundingRatePct = 0;
      try {
        const [fr] = await okxGet(`/api/v5/public/funding-rate?instId=${encodeURIComponent(id)}`);
        fundingRatePct = Number(fr.fundingRate) * 100;
      } catch { /* funding optional */ }
      out[id] = {
        markPx: last,
        chg24hPct: open24h ? ((last - open24h) / open24h) * 100 : 0,
        fundingRatePct,
        oiChg24hPct: 0,
      };
    } catch {
      // Skip an instrument whose market data momentarily fails.
    }
  }
  return out;
}
