#!/usr/bin/env node
// Smart Money Mirror — web console + service API.
// Zero dependencies: node:http only. `npm run serve` → http://localhost:4103
// (override with PORT / HOST env vars).
//
// This is the product surface AND the future paid surface: the same JSON
// endpoints the console polls are what a pay-per-call / subscription API
// would meter. See STATUS.md → "Service API".
//
// Routes:
//   GET  /                 console UI (single file, src/web/index.html, no CDNs)
//   GET  /api/health       { ok: true, mode }
//   GET  /api/events       event feed, newest first (?limit=n)
//   GET  /api/leaderboard  current snapshot (state; scenario baseline preview before first tick)
//   POST /api/tick         advance the watcher one tick (demo control)
//   POST /api/reset        wipe state/ + out/ and restart the scripted scenario (demo control)
//   GET  /api/digest       build + return the weekly digest (markdown + X-post block)
//   POST /api/subscribe    { contact } → state/subscribers.json  (demo — delivery not yet live)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { runTick } from './watcher.js';
import { buildDigest } from './digest.js';
import {
  EVENTS_LOG,
  STATE_FILE,
  SUBSCRIBERS_FILE,
  ensureDirs,
  readJson,
  readLines,
  writeJson,
  resetRuntime,
} from './paths.js';
import { describeMove, eventLabel } from './format.js';
import { FINAL_TICK, snapshotAt } from './mock/scenario.js';
import { gate as x402Gate, x402Mode } from './x402/gate.js';

// The hosted service defaults to real OKX public data (leaderboard + positions
// are public — no keys), so the live feed shows actual lead traders. Mutating
// the shared config object works because the adapter reads config.mode at call
// time. CLI/tests/demo import config fresh, so they keep the scripted mock
// scenario (the better 90-second demo). Override with OKX_MODE.
config.mode = (process.env.OKX_MODE || 'real').toLowerCase();

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const INDEX_HTML = path.join(WEB_DIR, 'index.html');

const PORT = Number(process.env.PORT) || 4103;
// Bind all interfaces by default so containerized/PaaS deploys (Railway, Render,
// etc.) are reachable; override with HOST for a locked-down local bind.
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 16 * 1024;

// ── helpers ─────────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

function loadState() {
  return readJson(STATE_FILE, { tick: 0, snapshot: null, updatedAt: null });
}

function loadEvents() {
  const events = [];
  readLines(EVENTS_LOG).forEach((line, i) => {
    try {
      const ev = JSON.parse(line);
      // Enrich with the same one-liners the CLI/digest use, so every client
      // renders moves identically without re-implementing format logic.
      events.push({ id: i, ...ev, label: eventLabel(ev.type), desc: describeMove(ev) });
    } catch {
      /* skip corrupt line */
    }
  });
  return events;
}

function loadSubscribers() {
  const subs = readJson(SUBSCRIBERS_FILE, []);
  return Array.isArray(subs) ? subs : [];
}

// email → 'email'; @handle / t.me/handle / bare handle → 'telegram'; else null.
function classifyContact(raw) {
  const contact = String(raw ?? '').trim();
  if (!contact || contact.length > 120) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)) return { contact, channel: 'email' };
  const handle = contact.replace(/^(https?:\/\/)?(t\.me\/)/i, '').replace(/^@/, '');
  if (/^[A-Za-z0-9_]{4,32}$/.test(handle)) return { contact: `@${handle}`, channel: 'telegram' };
  return null;
}

// ── route handlers ──────────────────────────────────────────────────────────

let tickInFlight = false;

const routes = {
  'GET /api/health': (req, res) => {
    sendJson(res, 200, { ok: true, mode: config.mode });
  },

  'GET /api/events': (req, res, url) => {
    const state = loadState();
    const all = loadEvents().reverse(); // newest first
    const limit = Number(url.searchParams.get('limit'));
    const events = Number.isFinite(limit) && limit > 0 ? all.slice(0, limit) : all;
    sendJson(res, 200, {
      ok: true,
      mode: config.mode,
      demo: config.mode === 'mock',
      tick: state.tick,
      finalTick: config.mode === 'mock' ? FINAL_TICK : null,
      updatedAt: state.updatedAt,
      alerts: all.filter((e) => e.alert).length,   // totals over the whole log,
      filtered: all.filter((e) => !e.alert).length, // not just the returned page
      count: all.length,
      events,
    });
  },

  'GET /api/leaderboard': (req, res) => {
    const state = loadState();
    let snapshot = state.snapshot;
    let preview = false;
    if (!snapshot && config.mode === 'mock') {
      snapshot = snapshotAt(1); // pre-sync peek at the scripted baseline
      preview = true;
    }
    if (!snapshot) {
      sendJson(res, 200, { ok: false, error: 'no snapshot yet — run a tick first' });
      return;
    }
    const traders = snapshot.traders
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((t) => ({
        ...t,
        bookNotionalUsd: t.positions.reduce((s, p) => s + p.size * p.entryPx, 0),
      }));
    sendJson(res, 200, { ok: true, tick: state.tick, updatedAt: state.updatedAt, preview, traders });
  },

  'POST /api/tick': async (req, res) => {
    if (tickInFlight) {
      sendJson(res, 409, { ok: false, error: 'tick already in progress' });
      return;
    }
    tickInFlight = true;
    try {
      const result = await runTick({ quiet: true });
      sendJson(res, 200, {
        ok: true,
        tick: result.tick,
        baseline: result.baseline,
        events: result.events.length,
        alerts: result.alerts.length,
        filtered: result.events.length - result.alerts.length,
        steadyState: config.mode === 'mock' && result.tick > FINAL_TICK,
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    } finally {
      tickInFlight = false;
    }
  },

  'POST /api/reset': (req, res) => {
    resetRuntime();
    sendJson(res, 200, { ok: true, message: 'state/ and out/ cleared — scenario rewound to tick 0' });
  },

  'GET /api/digest': async (req, res) => {
    try {
      const { file, markdown, tweet } = await buildDigest({ quiet: true });
      if (!markdown) {
        sendJson(res, 200, { ok: false, error: 'no events logged yet — run a few ticks first' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        file: path.basename(file),
        markdown,
        tweet,
        tweetChars: tweet.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  },

  'POST /api/subscribe': async (req, res) => {
    // x402 pay-per-call gate (X402_MODE=off → no-op, route behaves as before).
    // On 402 the response is already written; on paid success the
    // PAYMENT-RESPONSE header is attached and `payment.receipt` is set.
    const payment = await x402Gate(req, res);
    if (!payment.pass) return;

    const body = await readJsonBody(req);
    const parsed = classifyContact(body.contact);
    if (!parsed) {
      sendJson(res, 400, {
        ok: false,
        error: 'send { "contact": "you@example.com" } or a telegram handle like "@whale_watcher"',
      });
      return;
    }
    ensureDirs();
    const subs = loadSubscribers();
    const existing = subs.find((s) => s.contact.toLowerCase() === parsed.contact.toLowerCase());
    const exists = Boolean(existing);
    const paidUntil = payment.paid
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // now + 30d
      : null;
    if (!exists) {
      const record = {
        contact: parsed.contact,
        channel: parsed.channel,
        since: new Date().toISOString(),
        delivery: 'demo — delivery not yet live',
      };
      if (payment.paid) {
        record.tier = 'paid';
        record.paidUntil = paidUntil;
        record.payment = {
          transaction: payment.receipt.transaction,
          network: payment.receipt.network,
          payer: payment.receipt.payer,
        };
      }
      subs.push(record);
      writeJson(SUBSCRIBERS_FILE, subs);
    } else if (payment.paid) {
      // Renewal: extend the existing subscriber's paid window.
      existing.tier = 'paid';
      existing.paidUntil = paidUntil;
      existing.payment = {
        transaction: payment.receipt.transaction,
        network: payment.receipt.network,
        payer: payment.receipt.payer,
      };
      writeJson(SUBSCRIBERS_FILE, subs);
    }
    sendJson(res, 200, {
      ok: true,
      subscribed: parsed.contact,
      channel: parsed.channel,
      alreadySubscribed: exists,
      total: subs.length,
      note: 'demo — delivery not yet live',
      ...(payment.paid
        ? { paid: true, tier: 'paid', paidUntil, transaction: payment.receipt.transaction }
        : {}),
    });
  },
};

// ── server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  try {
    if (key === 'GET /' || key === 'GET /index.html') {
      const html = fs.readFileSync(INDEX_HTML);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end(); // favicon ships as an inline data URI in the page
      return;
    }
    const handler = routes[key];
    if (handler) {
      await handler(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: `no route: ${key}` });
      return;
    }
    res.writeHead(302, { location: '/' }).end();
  } catch (err) {
    sendJson(res, err.status ?? 500, { ok: false, error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} is busy — set PORT to something free, e.g.  PORT=4104 npm run serve`);
  } else {
    console.error(`[server] ${err.message}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  ensureDirs();
  const rows = [
    `SMART MONEY MIRROR — console up (mode: ${config.mode}, x402: ${x402Mode()})`,
    `http://${HOST}:${PORT}`,
    'API: /api/health /api/events /api/tick /api/digest /api/subscribe',
  ];
  const width = Math.max(...rows.map((r) => r.length)) + 2;
  console.log(`┌${'─'.repeat(width)}┐`);
  for (const r of rows) console.log(`│ ${r.padEnd(width - 2)} │`);
  console.log(`└${'─'.repeat(width)}┘`);
  console.log('Ctrl+C to stop. POST /api/tick advances the scripted scenario.');
});
