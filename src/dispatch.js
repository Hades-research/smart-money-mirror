// Phase 3 — dispatch: format the alert and hand it to the delivery adapter.

import * as telegram from './adapters/telegram.js';
import { buildAlertText } from './format.js';

/**
 * @param {object} event      assessed diff event (with .significance)
 * @param {string} take       analyst paragraph
 * @param {object} marketCtx  market context for event.instId
 * @returns {Promise<string>} the dispatched alert text
 */
export async function dispatchAlert(event, take, marketCtx) {
  const text = buildAlertText(event, take, marketCtx);
  await telegram.sendAlert(text);
  return text;
}
