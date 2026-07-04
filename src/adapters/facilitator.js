// x402 facilitator adapter — verifies and settles payment payloads.
// Mirrors the project's adapter pattern (okx.js / telegram.js / llm.js):
// mode 'mock' : fully in-process, deterministic, zero network. Works today.
// mode 'real' : POSTs to the OKX x402 facilitator. Endpoints + auth headers
//               are documented below; header names are ASSUMED pending
//               confirmation (see the block comment). Fails fast without creds.
//
// Mode comes from X402_MODE (off | mock | real, default off — set by the gate;
// this adapter is only ever called in mock/real mode).
//
// ────────────────────────────────────────────────────────────────────────────
// REAL-MODE WIRING NOTES — OKX x402 facilitator
// ────────────────────────────────────────────────────────────────────────────
// Endpoints (X Layer / EIP-155 chain 196 settlement, USDT):
//   POST https://web3.okx.com/api/v6/pay/x402/verify
//   POST https://web3.okx.com/api/v6/pay/x402/settle
//   Body: { paymentPayload, paymentRequirements }   (JSON, per the x402 spec)
//
// Auth: OKX v5-style HMAC signing. ⚠ ASSUMED header names — the x402
// facilitator docs were not reachable at build time; these mirror the
// documented OKX REST v5 signing scheme and MUST be confirmed against the
// official docs (or replaced with the official SDK — see STATUS.md, which
// notes @okxweb3/x402-core / x402-express / x402-evm as the SDK alternative):
//   OK-ACCESS-KEY:        env OKX_X402_API_KEY
//   OK-ACCESS-SIGN:       base64(hmacSHA256(timestamp + method + requestPath + body, OKX_X402_SECRET))
//   OK-ACCESS-TIMESTAMP:  ISO-8601 UTC timestamp (same value signed above)
//   OK-ACCESS-PASSPHRASE: env OKX_X402_PASSPHRASE
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

const FACILITATOR_BASE = process.env.OKX_X402_FACILITATOR_URL || 'https://web3.okx.com';

function facilitatorMode() {
  return (process.env.X402_MODE || 'off').toLowerCase();
}

// The exact-EVM PaymentPayload nests the transfer authorization; accept the
// canonical location plus flatter shapes so hand-rolled demo payloads work.
function declaredAmount(payload) {
  return (
    payload?.payload?.authorization?.value ??
    payload?.payload?.value ??
    payload?.value ??
    null
  );
}

function payerOf(payload) {
  return (
    payload?.payload?.authorization?.from ??
    payload?.payload?.from ??
    payload?.from ??
    payload?.payer ??
    null
  );
}

// ── real-mode HTTP call (OKX facilitator) ───────────────────────────────────

async function realCall(action, paymentPayload, paymentRequirements) {
  const key = process.env.OKX_X402_API_KEY;
  const secret = process.env.OKX_X402_SECRET;
  const passphrase = process.env.OKX_X402_PASSPHRASE;
  if (!key || !secret || !passphrase) {
    // Fail fast: real mode without credentials is a misconfiguration.
    throw new Error(
      '[x402 facilitator] X402_MODE=real requires OKX_X402_API_KEY, OKX_X402_SECRET ' +
        'and OKX_X402_PASSPHRASE. See REAL-MODE WIRING NOTES in src/adapters/facilitator.js.',
    );
  }
  const requestPath = `/api/v6/pay/x402/${action}`;
  const body = JSON.stringify({ paymentPayload, paymentRequirements });
  const timestamp = new Date().toISOString();
  // OKX v5-style signature: base64(HMAC-SHA256(timestamp + METHOD + path + body)).
  const sign = crypto
    .createHmac('sha256', secret)
    .update(timestamp + 'POST' + requestPath + body)
    .digest('base64');
  const res = await fetch(FACILITATOR_BASE + requestPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // ⚠ ASSUMED header names (OKX v5 convention) — confirm before go-live.
      'OK-ACCESS-KEY': key,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`[x402 facilitator] ${action} → HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // OKX REST responses wrap results in a {code,msg,data} envelope; unwrap if present.
  return data && typeof data === 'object' && 'data' in data ? data.data : data;
}

// ── public adapter surface ──────────────────────────────────────────────────

/**
 * Verify a decoded PaymentPayload against the PaymentRequirements.
 * @returns {Promise<{isValid: boolean, invalidReason?: string, payer?: string}>}
 */
export async function verify(paymentPayload, paymentRequirements) {
  if (facilitatorMode() === 'real') {
    return realCall('verify', paymentPayload, paymentRequirements);
  }
  // mock: structural checks only — no signature/on-chain validation.
  if (!paymentPayload || typeof paymentPayload !== 'object' || Array.isArray(paymentPayload)) {
    return { isValid: false, invalidReason: 'payload is not a JSON object' };
  }
  if (paymentPayload.scheme !== paymentRequirements.scheme) {
    return {
      isValid: false,
      invalidReason: `scheme mismatch: got "${paymentPayload.scheme}", need "${paymentRequirements.scheme}"`,
    };
  }
  if (paymentPayload.network !== paymentRequirements.network) {
    return {
      isValid: false,
      invalidReason: `network mismatch: got "${paymentPayload.network}", need "${paymentRequirements.network}"`,
    };
  }
  const amount = declaredAmount(paymentPayload);
  let sufficient = false;
  try {
    sufficient = amount != null && BigInt(amount) >= BigInt(paymentRequirements.maxAmountRequired);
  } catch {
    sufficient = false;
  }
  if (!sufficient) {
    return {
      isValid: false,
      invalidReason: `declared amount "${amount}" is below required ${paymentRequirements.maxAmountRequired} (atomic units)`,
    };
  }
  return { isValid: true, payer: payerOf(paymentPayload) ?? 'unknown' };
}

/**
 * Settle a verified payment.
 * Mock: deterministic tx hash = sha256 of the payload JSON (stable across runs).
 * @returns {Promise<{success: boolean, transaction?: string, network?: string, payer?: string, status?: string, errorReason?: string}>}
 */
export async function settle(paymentPayload, paymentRequirements) {
  if (facilitatorMode() === 'real') {
    return realCall('settle', paymentPayload, paymentRequirements);
  }
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(paymentPayload))
    .digest('hex'); // 64 hex chars
  return {
    success: true,
    transaction: `0x${hash}`,
    network: paymentRequirements.network,
    payer: payerOf(paymentPayload) ?? 'unknown',
    status: 'success',
  };
}
