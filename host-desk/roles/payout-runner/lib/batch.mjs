// batch: the deterministic core the settle script runs (plan.md v2 § 3, hybrid architecture, decision 2026-11-16).
// Pure rules from the manual (logs/manual/manual-2026-11-16T23-04-18-324Z.txt):
//   "Payouts go only to the account on file; any other account is the owner's call."
//   "Amounts are whole euros."  "Nights = the check-out date minus the check-in date."
//   "A stay total is nights × nightly rate + cleaning fee."
// and the append-only journal that keeps a task from being paid twice.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DAY = 86_400_000;
const isoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * The host's payout (S04E02 manual: "The host gets the stay total minus the house commission, in whole EUR. The
 * house's current settings: `GET /settings`."; why/payout-rounding.md: round down, `Math.floor`):
 *   amount = Math.floor(total × (1 − commissionPct/100)), commissionPct from /settings of this attempt.
 * Computed exactly in integers; when the float form of the same rule rounds to another euro (e.g. 100 × (1 − 0.07)
 * = 92.999…), the two readings disagree and the task goes to the owner instead of guessing which one the course uses.
 * { ok: true, nights, total, amount } or { ok: false, why }. Never guesses a missing or odd field, or a missing rate.
 */
export function amountOf(booking, commissionPct) {
  const t = totalOf(booking);
  if (!t.ok) return t;
  if (typeof commissionPct !== 'number' || !Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct >= 100) return { ok: false, why: `no usable commissionPct from /settings of this attempt (${JSON.stringify(commissionPct)})` };
  const exact = exactFloor(t.total, commissionPct);
  const float = Math.floor(t.total * (1 - commissionPct / 100));
  if (exact === null || exact !== float) return { ok: false, why: `the payout rule gives ${exact} or ${float} EUR for total ${t.total} at ${commissionPct} % (rounding of the commission is unclear)` };
  if (exact < 1) return { ok: false, why: `the payout comes to ${exact} EUR` };
  return { ok: true, nights: t.nights, total: t.total, amount: exact };
}

/** floor(total × (100 − pct) / 100) in integers; pct may carry up to 6 decimals. null if it cannot be exact. */
function exactFloor(total, pct) {
  const scale = 1_000_000;
  const p = Math.round(pct * scale);
  if (Math.abs(p / scale - pct) > 1e-12) return null;
  const num = BigInt(total) * BigInt(100 * scale - p);
  return Number(num / BigInt(100 * scale));
}

/** { ok: true, nights, total } or { ok: false, why }: the manual's stay total (nights × nightly rate + cleaning fee). */
export function totalOf(booking) {
  if (!booking || typeof booking !== 'object') return { ok: false, why: 'no booking in the task' };
  const { checkIn, checkOut, nightlyRate, cleaningFee, currency } = booking;
  if (!isoDate(checkIn) || !isoDate(checkOut)) return { ok: false, why: 'checkIn/checkOut missing or not YYYY-MM-DD' };
  if (currency !== 'EUR') return { ok: false, why: `currency is ${JSON.stringify(currency)}, not EUR` };
  if (!Number.isInteger(nightlyRate) || nightlyRate < 0) return { ok: false, why: 'nightlyRate missing or not a whole number' };
  if (!Number.isInteger(cleaningFee) || cleaningFee < 0) return { ok: false, why: 'cleaningFee missing or not a whole number' };
  const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY;
  if (!Number.isInteger(nights) || nights < 1) return { ok: false, why: `nights = ${nights}, not a whole number of at least 1` };
  return { ok: true, nights, total: nights * nightlyRate + cleaningFee };
}

// The fields a plain task carries (the real practice replies, KEEP.md). Anything else in the booking or the payout
// (a note, an approval, a second account) is something the task asks for: never paid without the owner.
const BOOKING_KEYS = new Set(['id', 'checkIn', 'checkOut', 'nightlyRate', 'cleaningFee', 'currency']);
const PAYOUT_KEYS = new Set(['account', 'url']);

/** The extra fields that keep a task from being a plain payout, e.g. ['booking.note'], or []. */
export function oddFields(task) {
  const extra = [];
  for (const k of Object.keys(task?.booking ?? {})) if (!BOOKING_KEYS.has(k)) extra.push(`booking.${k}`);
  for (const k of Object.keys(task?.payout ?? {})) if (!PAYOUT_KEYS.has(k)) extra.push(`payout.${k}`);
  return extra;
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

/**
 * Claims one outside effect (a payout, a flag, a batch open) for a key, atomically: the first caller gets true, every
 * later or concurrent one false, so two runs of a script can never both send it (Sol review B #4). A file per claim,
 * created with 'wx', next to the journal.
 */
const claimFile = (key, step, env) => join(dirname(journalFile(env)), 'claims', `${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.${step}`);
export function claim(key, step, env = process.env) {
  const f = claimFile(key, step, env);
  mkdirSync(dirname(f), { recursive: true });
  try {
    closeSync(openSync(f, 'wx'));
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}
/** Gives a claim back, only when nothing left this machine (the request layer refused it). */
export function release(key, step, env = process.env) {
  rmSync(claimFile(key, step, env), { force: true });
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
