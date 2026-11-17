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

export const parkedUrl = () => `${process.env.API_BASE || API}/parked`;
export const verifyUrl = () => `${process.env.VERIFY_BASE || 'https://verify-s04.mega.dev'}/{{VERIFY_PATH}}`;

const currentFile = (batch) => join(dirname(STATE_FILE()), `current-${batch}.json`);
const taskFile = (batch, n) => join(dirname(STATE_FILE()), `task-${batch}-${n}.json`);
/** Keeps the last reply of a batch, and each task it shows under its own n (parked.mjs reads it after the flag). */
export function saveCurrent(batch, maskedBody) {
  mkdirSync(dirname(currentFile(batch)), { recursive: true });
  writeFileSync(currentFile(batch), maskedBody, { mode: 0o600 });
  try {
    const t = JSON.parse(maskedBody);
    if (t?.status === 'task' && Number.isInteger(t.n)) writeFileSync(taskFile(batch, t.n), maskedBody, { mode: 0o600 });
  } catch {}
}
export function current(batch) {
  try {
    return JSON.parse(readFileSync(currentFile(batch), 'utf8'));
  } catch {
    return null;
  }
}
/** The task n of a batch as it was shown (masked), or null. */
export function taskOf(batch, n) {
  try {
    return JSON.parse(readFileSync(taskFile(batch, n), 'utf8'));
  } catch {
    return null;
  }
}

/** The var that holds the token of task n, e.g. TASK_RUN_7. */
export const taskVar = (batch, n) => `TASK_${batch.toUpperCase()}_${n}`;

/**
 * Captures the task token of a reply as CUR_TASK and as TASK_<BATCH>_<n>, so every log line names the task it
 * touched ({{TASK_RUN_7}}) and a parked task keeps its token after the next task arrives.
 */
export const captureTask = (batch) => (raw) => {
  try {
    const r = JSON.parse(raw);
    const t = r?.task;
    if (typeof t !== 'string' || t.length < 8) return {};
    return Number.isInteger(r.n) ? { CUR_TASK: t, [taskVar(batch, r.n)]: t } : { CUR_TASK: t };
  } catch {
    return {};
  }
};

/**
 * A refusal the course or the payout API gave: { need?, why } or null. Shape not seen yet (KEEP.md: the index has no
 * refusal format), so any of these counts: a `need` field, a status "refused"/"rejected", or a 4xx reply.
 */
export function refusalOf(r) {
  let b = null;
  try {
    b = JSON.parse(r.body);
  } catch {}
  const need = b && typeof b === 'object' ? b.need : undefined;
  const st = b && typeof b === 'object' ? String(b.status ?? '') : '';
  if (need !== undefined || /^(refused|rejected|denied)$/i.test(st) || (r.status >= 400 && r.status < 500)) {
    const why = (b && (b.reason ?? b.error ?? b.message)) ?? `http ${r.status}`;
    return { need: need === undefined ? undefined : String(need), why: String(why).slice(0, 300) };
  }
  return null;
}

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
