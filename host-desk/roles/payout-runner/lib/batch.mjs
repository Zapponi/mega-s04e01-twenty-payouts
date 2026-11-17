// batch: the deterministic core the settle script runs (plan.md v2 § 3, hybrid architecture, decision 2026-11-16).
// Pure rules from the manual (logs/manual/manual-2026-11-16T23-04-18-324Z.txt):
//   "Payouts go only to the account on file; any other account is the owner's call."
//   "Amounts are whole euros."  "Nights = the check-out date minus the check-in date."
//   "A stay total is nights × nightly rate + cleaning fee."
// and the append-only journal that keeps a task from being paid twice.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DAY = 86_400_000;
const isoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** { ok: true, nights, amount } or { ok: false, why }. Never guesses a missing or odd field. */
export function amountOf(booking) {
  if (!booking || typeof booking !== 'object') return { ok: false, why: 'no booking in the task' };
  const { checkIn, checkOut, nightlyRate, cleaningFee, currency } = booking;
  if (!isoDate(checkIn) || !isoDate(checkOut)) return { ok: false, why: 'checkIn/checkOut missing or not YYYY-MM-DD' };
  if (currency !== 'EUR') return { ok: false, why: `currency is ${JSON.stringify(currency)}, not EUR` };
  if (!Number.isInteger(nightlyRate) || nightlyRate < 0) return { ok: false, why: 'nightlyRate missing or not a whole number' };
  if (!Number.isInteger(cleaningFee) || cleaningFee < 0) return { ok: false, why: 'cleaningFee missing or not a whole number' };
  const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY;
  if (!Number.isInteger(nights) || nights < 1) return { ok: false, why: `nights = ${nights}, not a whole number of at least 1` };
  return { ok: true, nights, amount: nights * nightlyRate + cleaningFee };
}

/** 'on-file' | 'owner' | { why } — where this task's money may go without the owner. */
export function targetOf(task, accountOnFile) {
  const account = task?.payout?.account;
  if (typeof account !== 'string' || !account) return { why: 'no payout.account in the task' };
  if (typeof accountOnFile !== 'string' || !accountOnFile) return { why: 'no account on file known for this attempt' };
  return account === accountOnFile ? 'on-file' : 'owner';
}

export function journalFile(env = process.env) {
  const dir = env.JOURNAL_DIR ? resolve(env.JOURNAL_DIR) : join(ROOT, 'journal');
  return join(dir, `${env.JOURNAL_NAME || 'journal'}.jsonl`);
}

export function journal(event, env = process.env) {
  const file = journalFile(env);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}

export function events(env = process.env) {
  const file = journalFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The last status the journal holds for a task key (batch + n), or null. */
export function statusOf(key, env = process.env) {
  const mine = events(env).filter((e) => e.key === key && e.status);
  return mine.length ? mine.at(-1).status : null;
}
