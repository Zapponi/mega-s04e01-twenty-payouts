// parked            — the run's owner tasks: reads GET /parked every ~10 s for up to ~110 s (the code tool stops a
//                     script at 120 s) and finishes each task once its decision shows there:
//                       on-file → pay the account on file, then POST /parked { task, answer, payout }
//                       new     → pay the account the task asks for (its structured payout.account only)
//                       decline → pay nothing, POST /parked { task, done: "declined" }
//                       null    → not decided yet: no write, read again later
//                     S04E02 (api-index parked.decisions): an `amount` > 0 is paid as given (on-file: to the account on
//                     file; any other decision: to the account the task asks for); `amount` 0 → done: "declined". No
//                     `amount`: the task's own amount by the payout rule, with the commission of this attempt's
//                     /settings, read again here: a changed version stops every payout (declines still finish).
// parked answer <n> — re-send only the answer of a parked task already paid (receipt from the journal).
// Contract: API index, logs/manual/manual-2026-11-16T23-01-32-060Z.txt ("parked"). The decision is journaled, with the
// time it was seen in the API, before the first write on that task (BRIEF M3). Silent while nothing changes.
import { amountOf, claim, events, journal, statusOf } from '../lib/batch.mjs';
import { parkedUrl, payoutsUrl, refusalOf, show, state, taskOf, taskVar } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';
import { readSettings, settingsOf } from '../lib/settings.mjs';

const POLL_MS = Number(process.env.PARKED_POLL_MS || 10_000);
const MAX_MS = Number(process.env.PARKED_MAX_MS || 110_000);
const TIMEOUT_MS = Number(process.env.SETTLE_TIMEOUT_MS || 4000);
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const t0 = Date.now();
const st = state();
const keyOf = (n) => `run:${n}:${st.ATTEMPT_SEEN_AT}`;
process.env.WRITE_URLS = [parkedUrl(), payoutsUrl()].join(',');
const say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${s}`);

if (!st.ATTEMPT) {
  console.log('No attempt in the state file: nothing can be parked.');
  process.exit(1);
}

/** n of every task this agent flagged in this attempt. */
const flagged = () => [...new Set(events().filter((e) => ['waiting_owner', 'flag_sent'].includes(e.status) && e.key?.endsWith(`:${st.ATTEMPT_SEEN_AT}`)).map((e) => Number(e.key.split(':')[1])))];
const pending = () => flagged().filter((n) => ['waiting_owner', 'flag_sent'].includes(statusOf(keyOf(n))) && !stopped(n));

function refused(r, n, step) {
  const ref = refusalOf(r);
  if (!ref) return false;
  journal({ key: keyOf(n), status: 'refused', step, need: ref.need, why: ref.why, http: r.status });
  say(`REFUSED task ${n} at ${step}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}. Stopped: never retried or worked around. Report it; the harness calls check-lane with the need.`);
  return true;
}

async function finish(n, body, okStatus, extra = {}) {
  const r = await send({ method: 'POST', url: parkedUrl(), body: { task: `{{${taskVar('run', n)}}}`, ...body }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (refused(r, n, okStatus === 'declined' ? 'decline' : 'answer')) return;
  if (r.status >= 200 && r.status < 300) {
    journal({ key: keyOf(n), status: okStatus, ...extra, http: r.status });
    say(`${okStatus.toUpperCase()} task ${n}${extra.amount !== undefined ? `: ${extra.amount} EUR to ${extra.account}` : ''}. Reply: ${show(r)}`);
    return;
  }
  if (okStatus === 'declined') {
    journal({ key: keyOf(n), status: 'uncertain', step: 'decline', http: r.status, why: r.refused ?? r.error });
    say(`UNCERTAIN decline of task ${n}: ${show(r)}. Not sent again on its own; tell the human.`);
    return;
  }
  journal({ key: keyOf(n), event: 'answer_failed', http: r.status, why: r.refused ?? r.error });
  say(`PAID but the ANSWER failed for task ${n}: ${show(r)}. Do not pay again. You may retry only the answer: parked answer ${n}.`);
}

/** A task this script will not touch again on its own: journaled once, left for the human. */
const stopped = (n) => events().some((e) => e.key === keyOf(n) && e.event === 'stopped');
function stop(n, why) {
  journal({ key: keyOf(n), event: 'stopped', why });
  say(`STOPPED task ${n}: ${why}. No write; tell the human.`);
}

/** The owner's amount as /parked shows it: undefined (none), a whole number ≥ 0, or { bad } for anything else. */
function ownerAmount(entry) {
  const v = entry?.amount;
  if (v === undefined || v === null) return undefined;
  return Number.isInteger(v) && v >= 0 ? v : { bad: JSON.stringify(v) };
}

// The settings the batch was paid with, and a fresh read now (only when a payout may follow): a different version
// stops every payout here, so no owner task is paid with a commission the run did not use (plan.md § 4).
let settingsNow;
async function currentSettings() {
  if (settingsNow) return settingsNow;
  const before = settingsOf(st);
  if (!before) return (settingsNow = { ok: false, why: 'no /settings read for this attempt is in the journal' });
  const now = await readSettings(st, TIMEOUT_MS, 'settings_check');
  if (!now.ok) return (settingsNow = now);
  if (now.version !== before.version || now.commissionPct !== before.commissionPct) {
    journal({ event: 'settings_changed', attempt: st.ATTEMPT_SEEN_AT, before: before.version, now: now.version, beforePct: before.commissionPct, nowPct: now.commissionPct });
    return (settingsNow = { ok: false, why: `/settings changed from ${before.version} (${before.commissionPct} %) to ${now.version} (${now.commissionPct} %) since the batch` });
  }
  return (settingsNow = now);
}

/** Acts on one decision that shows in /parked. Returns nothing; every outcome is journaled and printed. */
// A payout history that may be repaid once on the human's own yes: one send that came back as a redirect (3xx
// "moved": the API said it handles it elsewhere and gave no receipt), never 'uncertain' (a timeout may have landed).
const repayable = (mine) => {
  const pays = mine.filter((e) => ['sent', 'moved', 'uncertain', 'paid'].includes(e.status));
  return pays.some((e) => e.status === 'moved') && !pays.some((e) => ['uncertain', 'paid'].includes(e.status)) && pays.filter((e) => e.status === 'sent').length === 1;
};

/** One decision for task n from its /parked entries: { decision, entry }, { why } (conflict), or null (not decided yet). */
function oneDecision(entries) {
  // null is "not decided yet" (index); a text "null", "pending" or "" is read the same way, never as a decision
  const undecided = (d) => d === null || d === undefined || (typeof d === 'string' && /^(null|pending|)$/i.test(d.trim()));
  const decisions = [...new Set(entries.map((e) => e.decision).filter((d) => !undecided(d)))];
  if (decisions.length === 0) return null;
  if (decisions.length > 1) return { why: `/parked shows ${decisions.join(' and ')} at once` };
  const same = entries.filter((e) => e.decision === decisions[0]);
  const amounts = new Set(same.map((e) => JSON.stringify(e.amount ?? null)));
  if (amounts.size > 1) return { why: `/parked shows amounts ${[...amounts].join(' and ')} at once` };
  const accounts = new Set(same.map((e) => JSON.stringify(e.account ?? null)));
  if (accounts.size > 1) return { why: `/parked shows accounts ${[...accounts].join(' and ')} at once` };
  return { decision: decisions[0], entry: same[0] };
}

/**
 * Acts on one decision that shows in /parked. Every owner payout goes through here, the human's repay too (Sol
 * whole-diff re-review A #1, #2): one gate, so a check added for one path holds for all. Returns nothing; every
 * outcome is journaled and printed.
 */
async function act(n, decision, entry, seenAt, { repay = false } = {}) {
  const key = keyOf(n);
  const own = ownerAmount(entry);
  const prior = events().filter((e) => e.key === key && e.event === 'decision');
  if (prior.length && prior.at(-1).decision !== decision) return stop(n, `/parked now says "${decision}", it said "${prior.at(-1).decision}" before`);
  if (prior.length && prior.at(-1).amount !== (typeof own === 'number' ? own : undefined)) return stop(n, `/parked now shows amount ${JSON.stringify(entry.amount)}, it showed ${JSON.stringify(prior.at(-1).amount)} before`);
  if (!prior.length) journal({ key, event: 'decision', n, decision, ...(typeof own === 'number' ? { amount: own } : {}), seenAt });
  const task = taskOf('run', n);
  if (!task || !st[taskVar('run', n)]) return stop(n, 'its task or token was not kept at the flag');
  if (own && typeof own === 'object') return stop(n, `the owner's amount ${own.bad} is not a whole number of euros`);
  if (decision === 'decline' && own > 0) return stop(n, `/parked says decline with amount ${own}`);
  if (decision === 'decline' || own === 0) {
    if (!claim(key, 'owner-finish')) return say(`task ${n} is already being finished by another run: nothing sent.`);
    return finish(n, { done: 'declined' }, 'declined');
  }
  let account;
  if (decision === 'on-file') account = st.ACCOUNT_ON_FILE;
  else if (decision === 'new') {
    account = task.payout?.account;
    if (entry.account !== undefined && entry.account !== account) return stop(n, `/parked names account ${JSON.stringify(entry.account)}, the task asks for ${JSON.stringify(account)}`);
  } else return stop(n, `unknown decision ${JSON.stringify(decision)}`);
  if (typeof account !== 'string' || !ACCOUNT.test(account)) return stop(n, `no structured account to pay (${JSON.stringify(account)})`);
  const set = await currentSettings();
  if (!set.ok) return stop(n, `${set.why}; no payout`);
  // the owner's amount is paid as given (api-index: "`amount` > 0: pay it"); without one, the task's own amount
  const a = own > 0 ? { ok: true, amount: own, owner: true } : amountOf(task.booking, set.commissionPct);
  if (!a.ok) return stop(n, a.why);
  // A booking and amount already sent under another task number is never paid twice, even after an owner's "yes":
  // the human hears of it instead (Sol re-review #1).
  const again = events().find((e) => e.status === 'sent' && e.key !== key && e.key?.endsWith(`:${st.ATTEMPT_SEEN_AT}`) && e.bookingId === task.booking?.id && e.amount === a.amount);
  if (again) return stop(n, `booking ${task.booking?.id} for ${a.amount} EUR was already sent as ${again.key.split(':').slice(0, 2).join(' ')}`);
  // A payout already tried for this task (routine flagged it after a redirect or an unclear result) is never sent
  // again, even after an owner's "yes": it may have landed, or its address moved. Decline still finishes it.
  const mine = events().filter((e) => e.key === key);
  const tried = mine.findLast((e) => ['uncertain', 'moved'].includes(e.status)) ?? mine.find((e) => e.status === 'sent');
  if (tried && !(repay && repayable(mine))) return stop(n, `a payout was already tried for this task (${tried.status}${tried.http ? `, http ${tried.http}` : ''}); never sent again. Only "decline" can finish it here`);
  if (!claim(key, repay ? 'owner-repay' : 'owner-pay')) return say(`task ${n} is already being paid by another run: nothing sent.`);
  journal({ key, status: 'sent', ...(repay ? { repay: true } : {}), amount: a.amount, nights: a.nights, total: a.total, ...(a.owner ? { ownerAmount: true } : { commissionPct: set.commissionPct, settings: set.version }), account, decision, bookingId: task.booking?.id });
  const p = await send({
    method: 'POST',
    url: payoutsUrl(),
    headers: { 'X-Payout-Key': '{{PAYOUT_KEY}}' },
    body: { task: `{{${taskVar('run', n)}}}`, account, amount: a.amount },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let receipt;
  try {
    receipt = JSON.parse(p.body)?.receipt;
  } catch {}
  if (refused(p, n, 'payout')) return; // a refusal stops even when a receipt came with it (Sol review D #2)
  if (!(p.status >= 200 && p.status < 300) || typeof receipt !== 'string' || !receipt) {
    journal({ key, status: 'uncertain', step: 'payout', http: p.status, why: p.refused ?? p.error, body: p.body?.slice(0, 500) });
    say(`UNCERTAIN payout for task ${n}: ${show(p)}. It may or may not have gone through. Never sent again; tell the human.`);
    return;
  }
  journal({ key, status: 'paid', amount: a.amount, account, receipt });
  await finish(n, { answer: a.amount, payout: receipt }, 'answered', { amount: a.amount, account, receipt });
}

if (process.argv[2] === 'answer') {
  const n = Number(process.argv[3]);
  const key = keyOf(n);
  const paid = events().filter((e) => e.key === key && e.status === 'paid').at(-1);
  if (!Number.isInteger(n) || !paid || statusOf(key) !== 'paid') {
    console.log(`Nothing to re-answer for parked task ${process.argv[3]} (status ${statusOf(key)}).`);
    process.exit(1);
  }
  await finish(n, { answer: paid.amount, payout: paid.receipt }, 'answered', { amount: paid.amount, account: paid.account, receipt: paid.receipt });
  process.exit(statusOf(key) === 'answered' ? 0 : 3);
}

// parked repay <n> — the human's own yes (REPAY_OK=1) to pay ONE task again whose only payout came back as a redirect
// (3xx "moved", journaled 'moved': the API said it handles the payout elsewhere and gave no receipt). The redirect is
// never followed: the one send goes to the official payout URL, to the account the owner's decision names, then the
// task is finished through /parked. Never for 'uncertain' (a timeout or an error may have landed), never twice
// (claimed), never without the owner's decision in the journal (real batch 2026-11-19, task 12, Giovanni: "eu aceitei
// pagar a 12").
if (process.argv[2] === 'repay') {
  const n = Number(process.argv[3]);
  const key = keyOf(n);
  const no = (why) => {
    console.log(`NOT REPAID, task ${process.argv[3]}: ${why}. Nothing was sent.`);
    process.exit(1);
  };
  if (process.env.REPAY_OK !== '1') no('REPAY_OK is not 1 (the human\'s yes for this one task)');
  if (!Number.isInteger(n) || !taskOf('run', n) || !st[taskVar('run', n)]) no('its task or token was not kept at the flag');
  const mine = events().filter((e) => e.key === key);
  if (['answered', 'declined'].includes(statusOf(key))) no(`it is already ${statusOf(key)}`);
  if (!repayable(mine)) no(`its payout history is not one redirect (${mine.filter((e) => e.status).map((e) => e.status).join(', ') || 'none'})`);
  // the decision comes from /parked now, never from the journal alone (a later change wins), and then takes the
  // same path as every owner payout: same account, amount, duplicate and settings checks
  const r = await send({ method: 'GET', url: parkedUrl(), headers: { Authorization: 'Bearer {{ATTEMPT}}' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let list = null;
  try {
    list = JSON.parse(r.body)?.parked;
  } catch {}
  if (!(r.status >= 200 && r.status < 300) || !Array.isArray(list)) no(`could not read /parked now: ${show(r).slice(0, 200)}`);
  const one = oneDecision(list.filter((e) => Number(e?.n) === n));
  if (!one) no('/parked shows no decision for it now');
  if (one.why) no(one.why);
  if (!['on-file', 'new'].includes(one.decision) || !(ownerAmount(one.entry) === undefined || ownerAmount(one.entry) > 0)) no(`/parked says ${one.decision}${one.entry.amount !== undefined ? ` with amount ${JSON.stringify(one.entry.amount)}` : ''}, not a payout`);
  await act(n, one.decision, one.entry, new Date().toISOString(), { repay: true });
  process.exit(statusOf(key) === 'answered' ? 0 : 3);
}

const others = new Set();
while (pending().length) {
  const r = await send({ method: 'GET', url: parkedUrl(), headers: { Authorization: 'Bearer {{ATTEMPT}}' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const seenAt = new Date().toISOString();
  let list = null;
  try {
    list = JSON.parse(r.body)?.parked;
  } catch {}
  const ref = r.status ? refusalOf(r) : null;
  if (ref) {
    journal({ event: 'parked_refused', need: ref.need, why: ref.why, http: r.status });
    say(`REFUSED reading /parked: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}. Stop and report it; the harness calls check-lane with the need.`);
    process.exit(5);
  }
  if (!(r.status >= 200 && r.status < 300) || !Array.isArray(list)) {
    say(`Could not read /parked: ${show(r)}. Nothing was written.`);
  } else {
    const mine = new Set(pending());
    const byN = new Map();
    for (const e of list) {
      const n = Number(e?.n);
      if (!mine.has(n)) {
        if (Number.isInteger(n) && !flagged().includes(n) && !others.has(n)) {
          others.add(n);
          say(`/parked lists task ${n}, which this agent did not flag in this attempt: left alone.`);
        }
        continue;
      }
      if (!byN.has(n)) byN.set(n, []);
      byN.get(n).push(e);
    }
    for (const [n, entries] of byN) {
      const one = oneDecision(entries);
      if (!one) continue; // null: not decided yet
      if (one.why) {
        stop(n, one.why);
        continue;
      }
      await act(n, one.decision, one.entry, seenAt);
    }
  }
  const still = pending();
  if (!still.length) break;
  if (Date.now() - t0 + POLL_MS > MAX_MS) {
    say(`WAITING for the owner: task(s) ${still.join(', ')} (no decision yet). Nothing was written on them. Run parked again.`);
    process.exit(4);
  }
  await new Promise((done) => setTimeout(done, POLL_MS));
}

const summary = flagged().map((n) => `${n}: ${statusOf(keyOf(n))}`);
say(`Parked tasks: ${summary.join('; ') || 'none'}. None waiting.`);
const bad = flagged().filter((n) => !['answered', 'declined'].includes(statusOf(keyOf(n))));
process.exit(bad.length ? 3 : 0);
