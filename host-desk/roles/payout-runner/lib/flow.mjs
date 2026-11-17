// flow: shared parts of start.mjs and settle.mjs. Contract (API index, logs/manual/manual-2026-11-16T23-01-32-060Z.txt):
//   POST /practice | /run  { attempt }                       → a task: { status:"task", n, of, runLimitMs, timeLeftMs, booking, payout:{account,url}, task }
//   POST /practice | /run  { task, answer, payout }          → the next task (or the end)
//   POST /run              { task, flag:"needs-owner", reason }
//   POST pay-s04 /payouts  X-Payout-Key, { task, account, amount } → { receipt }
// The task token is a secret: it is captured as CUR_TASK before anything is logged, so the model and every log see
// {{CUR_TASK}}; scripts send "{{CUR_TASK}}" and the request layer fills it in.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_FILE } from '../extensions/vars.mjs';

export const API = 'https://hq.mega.dev/challenges/twenty-payouts';
export const PAYOUTS = 'https://pay-s04.mega.dev/payouts';
export const batchUrl = (batch) => `${process.env.API_BASE || API}/${batch}`;
export const payoutsUrl = () => process.env.PAYOUTS_URL || PAYOUTS;

export function state() {
  try {
    return JSON.parse(readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

const currentFile = (batch) => join(dirname(STATE_FILE()), `current-${batch}.json`);
export function saveCurrent(batch, maskedBody) {
  mkdirSync(dirname(currentFile(batch)), { recursive: true });
  writeFileSync(currentFile(batch), maskedBody, { mode: 0o600 });
}
export function current(batch) {
  try {
    return JSON.parse(readFileSync(currentFile(batch), 'utf8'));
  } catch {
    return null;
  }
}

/** Captures the task token of a reply as CUR_TASK. */
export const captureTask = (raw) => {
  try {
    const t = JSON.parse(raw)?.task;
    return typeof t === 'string' && t.length >= 8 ? { CUR_TASK: t } : {};
  } catch {
    return {};
  }
};

/** A short, masked view of a reply for the model. */
export function show(r) {
  if (r.refused) return `REFUSED (not sent): ${r.refused}`;
  if (r.error) return `ERROR: ${r.error}`;
  return `${r.status} ${r.body}`;
}

export function batchArg(v) {
  if (v !== 'practice' && v !== 'run') {
    console.log('First argument: practice or run.');
    process.exit(2);
  }
  return v;
}
