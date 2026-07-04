// x402 payment gate — the HTTP 402 pay-per-call handshake for gated routes.
// Standard: https://www.x402.org (v1). OKX.AI lists this agent's paid service
// (POST /api/subscribe, 7 USDT / month) as A2MCP — payment settles per call.
//
// Modes via env X402_MODE:
//   off  (default) — gate is a no-op; every route behaves exactly as before.
//   mock           — in-process facilitator (deterministic verify + settle).
//   real           — OKX x402 facilitator over HTTPS (needs OKX_X402_* creds).
//
// Handshake:
//   1. Client calls the gated route with no payment header.
//   2. Server replies 402 + `PAYMENT-REQUIRED: base64(JSON challenge)` where
//      the challenge is the FULL object {x402Version, resource, accepts: [
//      PaymentRequirements]} — validators decode the header and read
//      `accepts[]`, so a bare PaymentRequirements object is rejected as
//      "accepts is empty".
//   3. Client signs the chosen accepts[] entry and retries with
//      `PAYMENT-SIGNATURE: base64(JSON PaymentPayload)` (v2), or the legacy
//      v1 form `X-PAYMENT: base64(JSON PaymentPayload)` — both still accepted.
//   4. Server verify()s then settle()s via the facilitator adapter; on success
//      the normal handler runs and the response carries
//      `PAYMENT-RESPONSE: base64(JSON receipt)`.
//
// Only POST /api/subscribe is gated. Feed page, /api/events, /api/tick,
// /api/digest and /api/health stay free — the free tier is the funnel.

import { verify, settle } from '../adapters/facilitator.js';

export const X402_VERSION = 1;

// 7 USDT × 10^6 (USDT on X Layer has 6 decimals) — matches LISTING.md fee "7".
export const PRICE_ATOMIC_UNITS = '7000000';

const MODES = new Set(['off', 'mock', 'real']);

/** Current gate mode (read lazily so tests/scripts can flip the env). */
export function x402Mode() {
  const m = (process.env.X402_MODE || 'off').toLowerCase();
  return MODES.has(m) ? m : 'off';
}

/** PaymentRequirements for the gated subscribe endpoint (x402 v1, exact scheme). */
export function buildPaymentRequirements() {
  return {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: 'eip155:196', // X Layer mainnet
    maxAmountRequired: PRICE_ATOMIC_UNITS,
    resource: '/api/subscribe',
    description: 'One month of significance-scored whale-move alerts with analyst takes',
    mimeType: 'application/json',
    payTo: process.env.X402_PAY_TO || '0xREPLACE_OWNER_WALLET',
    maxTimeoutSeconds: 60,
    asset: '0x779ded0c9e1022225f8e0630b35a9b54be713736', // USDT on X Layer
    extra: { name: 'USDT', decimals: 6 },
  };
}

// ── base64(JSON) helpers ────────────────────────────────────────────────────

export function encodeB64Json(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

export function decodeB64Json(value) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ── 402 challenge ───────────────────────────────────────────────────────────

/**
 * Full v2 challenge object. Validators and payer CLIs decode the
 * PAYMENT-REQUIRED header and read `accepts[]` from it — encoding a bare
 * PaymentRequirements object gets rejected as "accepts is empty".
 */
export function buildChallenge(requirements = buildPaymentRequirements()) {
  return {
    x402Version: X402_VERSION,
    resource: requirements.resource,
    accepts: [requirements],
  };
}

function send402(res, requirements, error) {
  const challenge = buildChallenge(requirements);
  const body = JSON.stringify({
    ok: false,
    x402Version: X402_VERSION,
    resource: requirements.resource,
    error,
    accepts: [requirements],
  });
  res.writeHead(402, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'PAYMENT-REQUIRED': encodeB64Json(challenge),
  });
  res.end(body);
}

// ── the gate ────────────────────────────────────────────────────────────────

/**
 * Run the x402 handshake for a gated request.
 * Returns { pass: true } when the request may proceed (off mode, or payment
 * settled — then `paid: true` and `receipt` are set and the PAYMENT-RESPONSE
 * header is already attached to `res`). Returns { pass: false } after a 402
 * response has been written — the caller must stop handling the request.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<{pass: boolean, paid?: boolean, receipt?: object}>}
 */
export async function gate(req, res) {
  if (x402Mode() === 'off') return { pass: true, paid: false };

  const requirements = buildPaymentRequirements();
  // v2 retry header (PAYMENT-SIGNATURE) first, legacy v1 X-PAYMENT second —
  // same base64-JSON PaymentPayload either way.
  const header = req.headers['payment-signature'] ?? req.headers['x-payment'];
  if (!header) {
    send402(
      res,
      requirements,
      'payment required — sign an accepts[] entry from the PAYMENT-REQUIRED challenge and retry with a PAYMENT-SIGNATURE header (base64 JSON PaymentPayload; legacy X-PAYMENT also accepted)',
    );
    return { pass: false };
  }

  const payload = decodeB64Json(header);
  if (!payload) {
    send402(res, requirements, 'invalid payment header — PAYMENT-SIGNATURE (or legacy X-PAYMENT) must be base64-encoded JSON');
    return { pass: false };
  }

  try {
    const verification = await verify(payload, requirements);
    if (!verification.isValid) {
      send402(res, requirements, `payment verification failed: ${verification.invalidReason}`);
      return { pass: false };
    }
    const settlement = await settle(payload, requirements);
    if (!settlement.success) {
      send402(res, requirements, `payment settlement failed: ${settlement.errorReason ?? 'unknown'}`);
      return { pass: false };
    }
    const receipt = {
      success: true,
      transaction: settlement.transaction,
      network: settlement.network,
      payer: settlement.payer,
      status: settlement.status ?? 'success',
      settledAt: new Date().toISOString(),
    };
    res.setHeader('PAYMENT-RESPONSE', encodeB64Json(receipt));
    return { pass: true, paid: true, receipt };
  } catch (err) {
    send402(res, requirements, `payment processing error: ${err.message}`);
    return { pass: false };
  }
}
