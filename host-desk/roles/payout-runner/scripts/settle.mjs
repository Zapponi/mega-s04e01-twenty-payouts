// settle <practice|run> pay            — the current task: check amount and account, pay once, answer with the receipt.
// settle <practice|run> flag "<reason>" — the current task goes to the owner (run only): no payout, no answer.
// settle <practice|run> answer         — re-send only the answer of a task already paid (receipt from the journal).
// Every rule is checked here, not by the model. Anything off → no action, the reason is printed, the agent decides.
// A payout whose result is unclear is journaled "uncertain" and never sent again by this script.
// A refusal (a `need`, a status "refused", a 4xx) is journaled "refused" with its need; the task is never retried.
import { amountOf, journal, oddFields, statusOf, events, targetOf } from '../lib/batch.mjs';
import { batchArg, batchUrl, captureTask, current, payoutsUrl, refusalOf, saveCurrent, show, state } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

const TIMEOUT_MS = Number(process.env.SETTLE_TIMEOUT_MS || 4000);
const batch = batchArg(process.argv[2]);
const action = process.argv[3];
const st = state();
const task = current(batch);
if (!task || task.status !== 'task') {
  console.log(`No open task for ${batch}. Last reply: ${JSON.stringify(task)}`);
  process.exit(1);
}
const key = `${batch}:${task.n}:${st.ATTEMPT_SEEN_AT}`;
const left = () => `timeLeftMs at the task: ${task.timeLeftMs ?? '?'}`;
process.env.WRITE_URLS = [batchUrl(batch), payoutsUrl()].join(',');

function refused(r, step) {
  const ref = refusalOf(r);
  if (!ref) return false;
  journal({ key, status: 'refused', step, need: ref.need, why: ref.why, http: r.status });
  console.log(`REFUSED task ${task.n} at ${step}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}. Stop this task: do not retry or work around it. Report it; the harness calls check-lane with the need.`);
  process.exit(5);
}

async function answer(receipt, amount) {
  const r = await send(
    { method: 'POST', url: batchUrl(batch), body: { task: '{{CUR_TASK}}', answer: amount, payout: receipt }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    { capture: captureTask(batch) },
  );
  refused(r, 'answer');
  if (r.status && r.status < 300) {
    journal({ key, status: 'answered', amount, receipt, http: r.status });
    saveCurrent(batch, r.body);
    console.log(`ANSWERED task ${task.n}: ${amount} EUR, receipt kept. Next: ${show(r)}`);
    process.exit(0);
  }
  journal({ key, event: 'answer_failed', http: r.status, why: r.refused ?? r.error, body: r.body?.slice(0, 500) });
  console.log(`PAID but the ANSWER failed for task ${task.n}: ${show(r)}. Do not pay again. You may retry only the answer: settle ${batch} answer.`);
  process.exit(3);
}

const done = statusOf(key);
if (action === 'answer') {
  const paid = events().filter((e) => e.key === key && e.status === 'paid').at(-1);
  if (!paid || done !== 'paid') {
    console.log(`Nothing to re-answer for task ${task.n} (status ${done}).`);
    process.exit(1);
  }
  await answer(paid.receipt, paid.amount);
}
// "not_sent": the request layer refused it before anything left, so the task may be tried again.
if (done && done !== 'not_sent') {
  console.log(`Task ${task.n} already has status "${done}" in the journal: no second payout or flag. ${['uncertain', 'sent', 'flag_sent'].includes(done) ? 'Tell the human.' : ''}`);
  process.exit(1);
}

if (action === 'flag') {
  const reason = String(process.argv[4] ?? '').slice(0, 300);
  if (batch !== 'run') {
    console.log('Practice has no flag route (API index). Do not pay it; stop and tell the human.');
    process.exit(1);
  }
  if (!reason) {
    console.log('Give a short reason: settle run flag "<reason>".');
    process.exit(2);
  }
  // Journaled before the send: a flag whose reply is lost may have landed, and then the task must never be paid.
  journal({ key, status: 'flag_sent', n: task.n, reason });
  const r = await send(
    { method: 'POST', url: batchUrl(batch), body: { task: '{{CUR_TASK}}', flag: 'needs-owner', reason }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    { capture: captureTask(batch) },
  );
  refused(r, 'flag');
  if (r.status && r.status < 300) {
    journal({ key, status: 'waiting_owner', n: task.n, reason, http: r.status });
    saveCurrent(batch, r.body);
    console.log(`FLAGGED task ${task.n} for the owner. Next: ${show(r)}`);
    process.exit(0);
  }
  if (r.refused) {
    journal({ key, status: 'not_sent', step: 'flag', why: r.refused });
    console.log(`FLAG not sent for task ${task.n}: ${show(r)}. Nothing left this machine.`);
    process.exit(3);
  }
  journal({ key, event: 'flag_failed', http: r.status, why: r.error });
  console.log(`FLAG UNCLEAR for task ${task.n}: ${show(r)}. It may have landed: never pay this task; tell the human.`);
  process.exit(3);
}

if (action !== 'pay') {
  console.log('Second argument: pay, flag "<reason>" or answer.');
  process.exit(2);
}
const a = amountOf(task.booking);
if (!a.ok) {
  console.log(`NOT PAID, task ${task.n}: ${a.why}. Nothing was sent. Decide: flag it for the owner (run) or stop and tell the human.`);
  process.exit(1);
}
const odd = oddFields(task);
if (odd.length) {
  console.log(`NOT PAID, task ${task.n}: it carries ${odd.join(', ')}, which a plain payout does not: the owner's call. Nothing was sent. In the run: settle run flag "<reason>".`);
  process.exit(1);
}
const target = targetOf(task, st.ACCOUNT_ON_FILE);
if (target !== 'on-file') {
  const why = target === 'owner' ? 'the payout account is not the account on file: the owner\'s call (manual)' : target.why;
  console.log(`NOT PAID, task ${task.n}: ${why}. Nothing was sent. In the run: settle run flag "<reason>".`);
  process.exit(1);
}
journal({ key, status: 'sent', amount: a.amount, nights: a.nights, account: st.ACCOUNT_ON_FILE });
const p = await send({
  method: 'POST',
  url: payoutsUrl(),
  headers: { 'X-Payout-Key': '{{PAYOUT_KEY}}' },
  body: { task: '{{CUR_TASK}}', account: st.ACCOUNT_ON_FILE, amount: a.amount },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
let receipt;
try {
  receipt = JSON.parse(p.body)?.receipt;
} catch {}
if (!(p.status >= 200 && p.status < 300) || typeof receipt !== 'string' || !receipt) {
  refused(p, 'payout');
  if (p.refused) {
    journal({ key, status: 'not_sent', step: 'payout', why: p.refused });
    console.log(`NOT SENT, task ${task.n}: ${show(p)}. Nothing left this machine; fix the cause, then settle may try again.`);
    process.exit(3);
  }
  journal({ key, status: 'uncertain', http: p.status, why: p.refused ?? p.error, body: p.body?.slice(0, 500) });
  console.log(`UNCERTAIN payout for task ${task.n}: ${show(p)}. It may or may not have gone through. Never send it again; tell the human. ${left()}`);
  process.exit(3);
}
journal({ key, status: 'paid', amount: a.amount, receipt });
await answer(receipt, a.amount);
