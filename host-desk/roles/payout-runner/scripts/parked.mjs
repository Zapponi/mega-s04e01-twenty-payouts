// parked            — the run's owner tasks: reads GET /parked every ~10 s for up to ~110 s (the code tool stops a
//                     script at 120 s) and finishes each task once its decision shows there:
//                       on-file → pay the account on file, then POST /parked { task, answer, payout }
//                       new     → pay the account the task asks for (its structured payout.account only)
//                       decline → pay nothing, POST /parked { task, done: "declined" }
//                       null    → not decided yet: no write, read again later
// parked answer <n> — re-send only the answer of a parked task already paid (receipt from the journal).
// Contract: API index, logs/manual/manual-2026-11-16T23-01-32-060Z.txt ("parked"). The decision is journaled, with the
// time it was seen in the API, before the first write on that task (BRIEF M3). Silent while nothing changes.
import { amountOf, events, journal, statusOf } from '../lib/batch.mjs';
import { parkedUrl, payoutsUrl, refusalOf, show, state, taskOf, taskVar } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

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
const flagged = () => [...new Set(events().filter((e) => e.status === 'waiting_owner' && e.key?.endsWith(`:${st.ATTEMPT_SEEN_AT}`)).map((e) => Number(e.key.split(':')[1])))];
const pending = () => flagged().filter((n) => statusOf(keyOf(n)) === 'waiting_owner' && !stopped(n));

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

/** Acts on one decision that shows in /parked. Returns nothing; every outcome is journaled and printed. */
async function act(n, decision, entry, seenAt) {
  const key = keyOf(n);
  const prior = events().filter((e) => e.key === key && e.event === 'decision');
  if (prior.length && prior.at(-1).decision !== decision) return stop(n, `/parked now says "${decision}", it said "${prior.at(-1).decision}" before`);
  if (!prior.length) journal({ key, event: 'decision', n, decision, seenAt });
  const task = taskOf('run', n);
  if (!task || !st[taskVar('run', n)]) return stop(n, 'its task or token was not kept at the flag');
  if (decision === 'decline') return finish(n, { done: 'declined' }, 'declined');
  let account;
  if (decision === 'on-file') account = st.ACCOUNT_ON_FILE;
  else if (decision === 'new') {
    account = task.payout?.account;
    if (entry.account !== undefined && entry.account !== account) return stop(n, `/parked names account ${JSON.stringify(entry.account)}, the task asks for ${JSON.stringify(account)}`);
  } else return stop(n, `unknown decision ${JSON.stringify(decision)}`);
  if (typeof account !== 'string' || !ACCOUNT.test(account)) return stop(n, `no structured account to pay (${JSON.stringify(account)})`);
  const a = amountOf(task.booking);
  if (!a.ok) return stop(n, a.why);
  journal({ key, status: 'sent', amount: a.amount, nights: a.nights, account, decision });
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
  if (!(p.status >= 200 && p.status < 300) || typeof receipt !== 'string' || !receipt) {
    if (refused(p, n, 'payout')) return;
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
      const decisions = [...new Set(entries.map((e) => e.decision).filter((d) => d !== null && d !== undefined))];
      if (decisions.length === 0) continue; // null: not decided yet
      if (decisions.length > 1) {
        stop(n, `/parked shows ${decisions.join(' and ')} at once`);
        continue;
      }
      await act(n, decisions[0], entries.find((e) => e.decision === decisions[0]), seenAt);
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
