// x402 gate + facilitator tests (mock mode + off-mode passthrough).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gate,
  buildPaymentRequirements,
  x402Mode,
  decodeB64Json,
  encodeB64Json,
  PRICE_ATOMIC_UNITS,
} from '../src/x402/gate.js';
import { verify, settle } from '../src/adapters/facilitator.js';

// ── tiny req/res doubles (node:http shaped) ─────────────────────────────────

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
      return this;
    },
    end(body) {
      this.body = body;
      this.ended = true;
    },
  };
}

function validPayload(overrides = {}) {
  const req = buildPaymentRequirements();
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:196',
    payload: {
      authorization: {
        from: '0x' + '1'.repeat(40),
        to: req.payTo,
        value: req.maxAmountRequired,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 60),
        nonce: '0x' + 'ab'.repeat(32),
      },
      signature: '0x' + 'cd'.repeat(65),
    },
    ...overrides,
  };
}

function withMode(mode, fn) {
  const prev = process.env.X402_MODE;
  if (mode === undefined) delete process.env.X402_MODE;
  else process.env.X402_MODE = mode;
  const restore = () => {
    if (prev === undefined) delete process.env.X402_MODE;
    else process.env.X402_MODE = prev;
  };
  return Promise.resolve(fn()).finally(restore);
}

// ── off mode: passthrough ───────────────────────────────────────────────────

test('X402_MODE unset defaults to off and the gate is a pure passthrough', async () => {
  await withMode(undefined, async () => {
    assert.equal(x402Mode(), 'off');
    const res = mockRes();
    const result = await gate(mockReq(), res);
    assert.equal(result.pass, true);
    assert.equal(result.paid, false);
    // The gate must not have touched the response at all.
    assert.equal(res.ended, false);
    assert.equal(res.statusCode, null);
    assert.deepEqual(res.headers, {});
  });
});

test('X402_MODE=off is an explicit passthrough, even with a payment header attached', async () => {
  await withMode('off', async () => {
    const res = mockRes();
    const result = await gate(mockReq({ 'x-payment': encodeB64Json(validPayload()) }), res);
    assert.equal(result.pass, true);
    assert.equal(res.ended, false);
  });
});

// ── challenge shape ─────────────────────────────────────────────────────────

test('mock mode without payment header → 402 with a well-formed PAYMENT-REQUIRED challenge', async () => {
  await withMode('mock', async () => {
    const res = mockRes();
    const result = await gate(mockReq(), res);
    assert.equal(result.pass, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.ended, true);

    // Header decodes to the FULL challenge object {x402Version, resource,
    // accepts: [PaymentRequirements]} — not a bare requirements object.
    const challenge = decodeB64Json(res.headers['payment-required']);
    assert.ok(challenge, 'PAYMENT-REQUIRED must be base64 JSON');
    assert.equal(challenge.x402Version, 1);
    assert.equal(challenge.resource, '/api/subscribe');
    assert.ok(Array.isArray(challenge.accepts), 'challenge.accepts must be an array');
    assert.equal(challenge.accepts.length, 1);

    const requirements = challenge.accepts[0];
    assert.equal(requirements.x402Version, 1);
    assert.equal(requirements.scheme, 'exact');
    assert.equal(requirements.network, 'eip155:196');
    assert.equal(requirements.maxAmountRequired, '7000000');
    assert.equal(requirements.resource, '/api/subscribe');
    assert.equal(requirements.mimeType, 'application/json');
    assert.equal(requirements.asset, '0x779ded0c9e1022225f8e0630b35a9b54be713736');
    assert.equal(requirements.maxTimeoutSeconds, 60);
    assert.deepEqual(requirements.extra, { name: 'USDT', decimals: 6 });
    assert.ok(requirements.payTo.startsWith('0x'));

    // Body is small JSON echoing the same challenge.
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(body.x402Version, 1);
    assert.equal(body.resource, '/api/subscribe');
    assert.ok(body.error.includes('payment'));
    assert.deepEqual(body.accepts, [requirements]);
  });
});

// ── amount math ─────────────────────────────────────────────────────────────

test('price is 7 USDT in 6-decimal atomic units', () => {
  assert.equal(PRICE_ATOMIC_UNITS, String(7 * 10 ** 6));
  const req = buildPaymentRequirements();
  assert.equal(req.maxAmountRequired, '7000000');
  assert.equal(Number(req.maxAmountRequired) / 10 ** req.extra.decimals, 7);
});

test('facilitator verify: declared amount must cover the required amount', async () => {
  await withMode('mock', async () => {
    const req = buildPaymentRequirements();

    const exact = validPayload();
    assert.equal((await verify(exact, req)).isValid, true);

    const generous = validPayload();
    generous.payload.authorization.value = '7000001';
    assert.equal((await verify(generous, req)).isValid, true);

    const short = validPayload();
    short.payload.authorization.value = '6999999';
    const v = await verify(short, req);
    assert.equal(v.isValid, false);
    assert.match(v.invalidReason, /below required/);
  });
});

// ── mock round trip ─────────────────────────────────────────────────────────

test('mock round trip: valid PAYMENT-SIGNATURE → pass, receipt header, deterministic tx hash', async () => {
  await withMode('mock', async () => {
    const payload = validPayload();
    const res = mockRes();
    const result = await gate(mockReq({ 'payment-signature': encodeB64Json(payload) }), res);

    assert.equal(result.pass, true);
    assert.equal(result.paid, true);
    assert.equal(res.ended, false, 'gate must not end the response on success');

    const receipt = decodeB64Json(res.headers['payment-response']);
    assert.equal(receipt.success, true);
    assert.equal(receipt.status, 'success');
    assert.equal(receipt.network, 'eip155:196');
    assert.equal(receipt.payer, payload.payload.authorization.from);
    assert.match(receipt.transaction, /^0x[0-9a-f]{64}$/);
    assert.deepEqual(result.receipt.transaction, receipt.transaction);

    // Deterministic: settling the same payload twice yields the same tx hash.
    const req = buildPaymentRequirements();
    const s1 = await settle(payload, req);
    const s2 = await settle(payload, req);
    assert.equal(s1.transaction, s2.transaction);
    assert.equal(s1.transaction, receipt.transaction);

    // …and a different payload yields a different hash.
    const other = validPayload();
    other.payload.authorization.nonce = '0x' + 'ee'.repeat(32);
    const s3 = await settle(other, req);
    assert.notEqual(s3.transaction, s1.transaction);
  });
});

// ── legacy v1 header still supported ────────────────────────────────────────

test('legacy X-PAYMENT header still pays: valid payload → pass + receipt', async () => {
  await withMode('mock', async () => {
    const payload = validPayload();
    const res = mockRes();
    const result = await gate(mockReq({ 'x-payment': encodeB64Json(payload) }), res);
    assert.equal(result.pass, true);
    assert.equal(result.paid, true);
    const receipt = decodeB64Json(res.headers['payment-response']);
    assert.equal(receipt.success, true);
    assert.match(receipt.transaction, /^0x[0-9a-f]{64}$/);
  });
});

test('PAYMENT-SIGNATURE wins over a legacy X-PAYMENT header when both are sent', async () => {
  await withMode('mock', async () => {
    const good = validPayload();
    const res = mockRes();
    // The x-payment payload is garbage — if the gate preferred it, it would 402.
    const result = await gate(
      mockReq({ 'payment-signature': encodeB64Json(good), 'x-payment': '!!!garbage!!!' }),
      res,
    );
    assert.equal(result.pass, true);
    assert.equal(result.paid, true);
  });
});

// ── bad payments rejected ───────────────────────────────────────────────────

test('garbage payment header (not base64 JSON) → 402', async () => {
  await withMode('mock', async () => {
    const res = mockRes();
    const result = await gate(mockReq({ 'payment-signature': '!!!not-base64-json!!!' }), res);
    assert.equal(result.pass, false);
    assert.equal(res.statusCode, 402);
    assert.match(JSON.parse(res.body).error, /invalid payment header/);
  });
});

test('wrong scheme or network → 402 with verification error', async () => {
  await withMode('mock', async () => {
    for (const bad of [{ scheme: 'upto' }, { network: 'eip155:1' }]) {
      const res = mockRes();
      const result = await gate(
        mockReq({ 'x-payment': encodeB64Json(validPayload(bad)) }),
        res,
      );
      assert.equal(result.pass, false);
      assert.equal(res.statusCode, 402);
      assert.match(JSON.parse(res.body).error, /verification failed/);
    }
  });
});

test('insufficient declared amount → 402, nothing settled', async () => {
  await withMode('mock', async () => {
    const cheap = validPayload();
    cheap.payload.authorization.value = '1'; // 0.000001 USDT
    const res = mockRes();
    const result = await gate(mockReq({ 'x-payment': encodeB64Json(cheap) }), res);
    assert.equal(result.pass, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.headers['payment-response'], undefined);
    assert.match(JSON.parse(res.body).error, /below required/);
  });
});
