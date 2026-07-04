// Phase 2/3 — analyst: turns a significant event into a one-paragraph take.
// Thin orchestration over the llm adapter; market context is passed in by the
// watcher (which already fetched it for notional math).

import * as llm from './adapters/llm.js';

/**
 * @param {object} event      assessed diff event (with .significance)
 * @param {object} marketCtx  market context for event.instId (may be undefined)
 * @returns {Promise<string>} one-paragraph "why this matters"
 */
export async function writeTake(event, marketCtx) {
  return llm.generateTake(event, marketCtx);
}
