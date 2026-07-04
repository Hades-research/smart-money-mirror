// Filesystem layout + tiny JSON/log helpers (zero deps).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = path.join(ROOT, 'state');
export const OUT_DIR = path.join(ROOT, 'out');

export const STATE_FILE = path.join(STATE_DIR, 'positions.json');       // last-seen snapshot per tracked trader
export const EVENTS_LOG = path.join(OUT_DIR, 'events.jsonl');           // every detected event (digest source)
export const ALERTS_LOG = path.join(OUT_DIR, 'alerts.log');             // every dispatched alert (mock Telegram sink)
export const SUBSCRIBERS_FILE = path.join(STATE_DIR, 'subscribers.json'); // web subscribe box (demo — delivery not yet live)

export function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n', 'utf8');
}

export function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function resetRuntime() {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDirs();
}
