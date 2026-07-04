#!/usr/bin/env node
// x402 demo client — walks the full pay-per-call handshake against the gated
// POST /api/subscribe endpoint. Zero dependencies (node:child_process + fetch).
//
//   npm run x402-demo
//
// What it does:
//   1. Boots the server in a child process with X402_MODE=mock on a spare port
//      (skipped if X402_DEMO_URL points at an already-running server).
//   2. Calls POST /api/subscribe with no payment header    → expects HTTP 402
//      and decodes the PAYMENT-REQUIRED challenge ({x402Version, resource,
//      accepts: [PaymentRequirements]}) — the requirements come from accepts[0].
//   3. Builds a mock PaymentPayload for those requirements (exact scheme,
//      eip155:196, 7 USDT in atomic units).
//   4. Retries with PAYMENT-SIGNATURE: base64(payload)     → expects HTTP 200,
//      decodes the PAYMENT-RESPONSE receipt, prints the subscription result.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.X402_DEMO_PORT) || 4113;
const BASE = process.env.X402_DEMO_URL || `http://127.0.0.1:${PORT}`;
const OWN_SERVER = !process.env.X402_DEMO_URL;

const b64encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const b64decode = (value) => JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function fail(msg) {
  console.error(`\n✖ DEMO FAILED: ${msg}`);
  process.exitCode = 1;
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  let child = null;
  if (OWN_SERVER) {
    step(0, `starting server (X402_MODE=mock) on port ${PORT} …`);
    child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      env: { ...process.env, X402_MODE: 'mock', PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: 'ignore',
    });
    if (!(await waitForHealth())) {
      fail(`server did not come up on ${BASE} within 10s`);
      child.kill();
      return;
    }
    console.log(`    server up at ${BASE}`);
  }

  try {
    // ── 1. unpaid call → 402 challenge ──────────────────────────────────────
    step(1, 'POST /api/subscribe with NO payment header …');
    const first = await fetch(`${BASE}/api/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact: 'whale.watcher@example.com' }),
    });
    console.log(`    HTTP ${first.status}`);
    if (first.status !== 402) {
      fail(`expected 402, got ${first.status} — is the server running with X402_MODE=mock?`);
      return;
    }
    const challengeHeader = first.headers.get('payment-required');
    if (!challengeHeader) {
      fail('402 response is missing the PAYMENT-REQUIRED header');
      return;
    }
    const challenge = b64decode(challengeHeader);
    if (challenge.x402Version !== 1 || !Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
      fail('PAYMENT-REQUIRED header must decode to {x402Version, resource, accepts:[…]} with a non-empty accepts[]');
      return;
    }
    const requirements = challenge.accepts[0];
    console.log('    PAYMENT-REQUIRED decoded (full challenge):');
    console.log(`      x402Version=${challenge.x402Version}  resource=${challenge.resource}  accepts=${challenge.accepts.length} option(s)`);
    console.log('    using accepts[0]:');
    console.log(
      `      scheme=${requirements.scheme}  network=${requirements.network}  ` +
        `amount=${requirements.maxAmountRequired} (${Number(requirements.maxAmountRequired) / 10 ** requirements.extra.decimals} ${requirements.extra.name})`,
    );
    console.log(`      payTo=${requirements.payTo}`);
    console.log(`      asset=${requirements.asset}`);
    console.log(`      resource=${requirements.resource}  timeout=${requirements.maxTimeoutSeconds}s`);

    // ── 2. build a mock PaymentPayload for the challenge ────────────────────
    step(2, 'building mock PaymentPayload (exact scheme, EIP-3009-style authorization) …');
    const now = Math.floor(Date.now() / 1000);
    const paymentPayload = {
      x402Version: requirements.x402Version,
      scheme: requirements.scheme,
      network: requirements.network,
      payload: {
        authorization: {
          from: '0xDEM0000000000000000000000000000000PAYER'.toLowerCase(),
          to: requirements.payTo,
          value: requirements.maxAmountRequired, // pay exactly what's asked
          validAfter: String(now - 60),
          validBefore: String(now + requirements.maxTimeoutSeconds),
          nonce: '0x' + 'ab'.repeat(32),
        },
        signature: '0x' + 'cd'.repeat(65), // mock signature — not checked in mock mode
      },
    };
    console.log(`    paying ${requirements.maxAmountRequired} atomic units of ${requirements.extra.name}`);

    // ── 3. retry with PAYMENT-SIGNATURE → 200 + receipt ─────────────────────
    step(3, 'retrying POST /api/subscribe WITH PAYMENT-SIGNATURE header …');
    const second = await fetch(`${BASE}/api/subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': b64encode(paymentPayload),
      },
      body: JSON.stringify({ contact: 'whale.watcher@example.com' }),
    });
    console.log(`    HTTP ${second.status}`);
    if (second.status !== 200) {
      fail(`expected 200 after payment, got ${second.status}: ${await second.text()}`);
      return;
    }
    const receiptHeader = second.headers.get('payment-response');
    if (!receiptHeader) {
      fail('200 response is missing the PAYMENT-RESPONSE header');
      return;
    }
    const receipt = b64decode(receiptHeader);
    const body = await second.json();

    console.log('    PAYMENT-RESPONSE receipt:');
    console.log(`      status=${receipt.status}  network=${receipt.network}`);
    console.log(`      transaction=${receipt.transaction}`);
    console.log(`      payer=${receipt.payer}`);
    console.log('    subscription confirmed:');
    console.log(`      subscribed=${body.subscribed}  channel=${body.channel}  tier=${body.tier}`);
    console.log(`      paidUntil=${body.paidUntil}`);
    console.log(`      total subscribers=${body.total}`);

    if (!body.paid || !body.paidUntil || !/^0x[0-9a-f]{64}$/.test(receipt.transaction)) {
      fail('response shape is off — expected paid:true, paidUntil, and a 32-byte tx hash');
      return;
    }

    console.log('\n✔ x402 handshake complete: 402 challenge (accepts[]) → PAYMENT-SIGNATURE → 200 + PAYMENT-RESPONSE. Subscriber recorded with a 30-day paid window.');
  } finally {
    if (child) child.kill();
  }
}

main().catch((err) => fail(err.message));
