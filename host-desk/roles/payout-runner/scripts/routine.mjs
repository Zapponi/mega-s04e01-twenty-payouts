// routine <practice|run>: the whole batch in one run of code (check-lane "routine-script", 2026-11-17: "code that runs
// them all in one go, with one open connection"). The run's limit is for the whole batch (runLimitMs 6000 in the real
// run, KEEP.md), so no model turn may sit between two tasks.
// It opens the batch (or picks up the open task after a restart), then, for each task, with the same rules as settle.mjs:
//   - a plain payout to the account on file → pay once, answer with the receipt;
//   - anything else (another account, a field a plain task does not carry, a booking already paid, an amount the rule
//     cannot compute) → in the run: flag it for the owner and go on; in the practice: stop;
//   - a refusal, an unclear payout or flag → stop at once: that task is never retried.
// One process, so Node's fetch keeps the connections to the course and payout hosts open between tasks.
// It prints one line per task and a summary; every request is in the request log, every step in the journal.
import { amountOf, claim, events, journal, oddFields, release, statusOf, targetOf } from '../lib/batch.mjs';
import { batchArg, batchUrl, captureTask, current, payoutsUrl, refusalOf, saveCurrent, show, state, taskVar } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

const TIMEOUT_MS = Number(process.env.SETTLE_TIMEOUT_MS || 4000);
const batch = batchArg(process.argv[2]);
const st = state();
const t0 = Date.now();
const ms = () => `${Date.now() - t0} ms`;
const out = (s) => console.log(`[${ms()}] ${s}`);
const keep = (text) => saveCurrent(batch, text);
const signal = () => AbortSignal.timeout(TIMEOUT_MS);
process.env.WRITE_URLS = [batchUrl(batch), payoutsUrl()].join(',');

if (!st.ATTEMPT) {
  console.log('No attempt yet: fetch the manual first (GET /manual with Bearer {{TICKET}}). Nothing was sent.');
  process.exit(1);
}
if (batch === 'run' && process.env.ALLOW_RUN !== '1') {
  console.log('The real run is not allowed in this session (ALLOW_RUN is not 1). Stop and tell the human. Nothing was sent.');
  process.exit(1);
}
if (batch === 'run' && !events().some((e) => e.event === 'key_checked' && e.ok && e.attempt === st.ATTEMPT_SEEN_AT)) {
  console.log('The payout key was not checked for this attempt (manual: "Before a run, check the payout key"). Run check-key.mjs first. Nothing was sent.');
  process.exit(1);
}

const summary = { answered: [], flagged: [], stopped: null };
function finish(code) {
  out(`SUMMARY ${batch}: answered [${summary.answered.join(',')}]; flagged for the owner [${summary.flagged.join(',')}]${summary.stopped ? `; STOPPED: ${summary.stopped}` : ''}. Last reply: ${JSON.stringify(current(batch))?.slice(0, 300)}`);
  if (summary.flagged.length && batch === 'run') out('Owner tasks wait: next, parked.mjs (call it again while it prints WAITING).');
  process.exit(code);
}
function stop(why, code = 3) {
  summary.stopped = why;
  out(`STOP: ${why}`);
  finish(code);
}
function refusedStop(r, key, n, step) {
  const ref = refusalOf(r);
  if (!ref) return;
  journal({ key, status: 'refused', step, need: ref.need, why: ref.why, http: r.status, pointer: pointerOf(r) });
  stop(`REFUSED task ${n} at ${step}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}${pointerOf(r) ? `; ${pointerOf(r)}` : ''}. Never retried. The harness calls check-lane with the need.`, 5);
}
function pointerOf(r) {
  try {
    const p = JSON.parse(r.body)?.pointer;
    return typeof p === 'string' ? p.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

// open, or pick up where the journal says
let task;
const opened = events().some((e) => e.event === 'opened' && e.batch === batch && e.attempt === st.ATTEMPT_SEEN_AT);
if (opened) {
  task = current(batch);
  out(`The ${batch} is already open for this attempt: picking up at ${task?.status === 'task' ? `task ${task.n}` : `reply "${task?.status}"`}.`);
} else {
  if (!claim(`open:${batch}:${st.ATTEMPT_SEEN_AT}`, 'open')) stop(`the ${batch} open is unclear for this attempt; never sent twice. Tell the human.`);
  journal({ event: 'opening', batch, attempt: st.ATTEMPT_SEEN_AT });
  const r = await send({ method: 'POST', url: batchUrl(batch), body: { attempt: '{{ATTEMPT}}' }, signal: signal() }, { capture: captureTask(batch), keep });
  journal({ event: 'opened', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status, unclear: r.status ? undefined : (r.refused ?? r.error) });
  const ref = r.status ? refusalOf(r) : null;
  if (ref) {
    journal({ event: 'open_refused', batch, need: ref.need, why: ref.why, http: r.status });
    stop(`REFUSED opening the ${batch}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}`, 5);
  }
  if (!(r.status >= 200 && r.status < 300)) stop(`could not open the ${batch}: ${show(r)}`);
  task = current(batch);
  out(`OPENED ${batch}: ${task?.of ?? '?'} tasks, runLimitMs ${task?.runLimitMs ?? '?'}, timeLeftMs ${task?.timeLeftMs ?? '?'}.`);
}

while (task?.status === 'task') {
  const n = task.n;
  const key = `${batch}:${n}:${st.ATTEMPT_SEEN_AT}`;
  const tok = st[taskVar(batch, n)] || state()[taskVar(batch, n)] ? `{{${taskVar(batch, n)}}}` : '{{CUR_TASK}}';
  const done = statusOf(key);
  let receipt;
  let amount;

  if (done === 'paid') {
    const paid = events().filter((e) => e.key === key && e.status === 'paid').at(-1);
    receipt = paid.receipt;
    amount = paid.amount;
  } else if (done && done !== 'not_sent') {
    stop(`task ${n} already has status "${done}": never sent again. Tell the human.`);
  } else {
    // decide in code
    const a = amountOf(task.booking);
    const odd = oddFields(task);
    const target = a.ok ? targetOf(task, st.ACCOUNT_ON_FILE) : null;
    const again = a.ok && events().find((e) => e.status === 'sent' && e.key !== key && e.key?.endsWith(`:${st.ATTEMPT_SEEN_AT}`) && e.bookingId === task.booking?.id && e.amount === a.amount);
    let why = null;
    if (!a.ok) why = a.why;
    else if (odd.length) why = `it carries ${odd.join(', ')}, which a plain payout does not`;
    else if (target !== 'on-file') why = target === 'owner' ? `payout account ${task.payout?.account} is not the account on file` : target.why;
    else if (again) why = `booking ${task.booking.id} for ${a.amount} EUR was already sent as task ${again.key.split(':')[1]}`;

    if (why) {
      if (batch !== 'run') stop(`practice task ${n} is not a plain payout (${why}); practice has no owner route. Nothing was sent.`, 1);
      if (!claim(key, 'act')) stop(`task ${n} is already being paid or flagged by another run.`);
      journal({ key, status: 'flag_sent', n, reason: why });
      const r = await send({ method: 'POST', url: batchUrl(batch), body: { task: tok, flag: 'needs-owner', reason: why.slice(0, 300) }, signal: signal() }, { capture: captureTask(batch), keep });
      refusedStop(r, key, n, 'flag');
      if (r.refused) {
        journal({ key, status: 'not_sent', step: 'flag', why: r.refused });
        release(key, 'act');
        stop(`flag of task ${n} not sent: ${r.refused}`);
      }
      if (!(r.status >= 200 && r.status < 300)) {
        journal({ key, event: 'flag_failed', http: r.status, why: r.error });
        stop(`FLAG UNCLEAR for task ${n}: ${show(r)}. It may have landed: never paid; parked.mjs finishes it if the owner decides it.`);
      }
      journal({ key, status: 'waiting_owner', n, reason: why, http: r.status });
      summary.flagged.push(n);
      out(`task ${n}: FLAGGED for the owner (${why})`);
      task = current(batch);
      continue;
    }

    if (!claim(key, 'act')) stop(`task ${n} is already being paid or flagged by another run.`);
    journal({ key, status: 'sent', amount: a.amount, nights: a.nights, account: st.ACCOUNT_ON_FILE, bookingId: task.booking.id });
    const p = await send({ method: 'POST', url: payoutsUrl(), headers: { 'X-Payout-Key': '{{PAYOUT_KEY}}' }, body: { task: tok, account: st.ACCOUNT_ON_FILE, amount: a.amount }, signal: signal() });
    try {
      receipt = JSON.parse(p.body)?.receipt;
    } catch {}
    if (!(p.status >= 200 && p.status < 300) || typeof receipt !== 'string' || !receipt) {
      refusedStop(p, key, n, 'payout');
      if (p.refused) {
        journal({ key, status: 'not_sent', step: 'payout', why: p.refused });
        release(key, 'act');
        stop(`payout of task ${n} not sent: ${p.refused}`);
      }
      journal({ key, status: 'uncertain', http: p.status, why: p.error, body: p.body?.slice(0, 500) });
      stop(`UNCERTAIN payout for task ${n}: ${show(p)}. Never sent again; tell the human.`);
    }
    amount = a.amount;
    journal({ key, status: 'paid', amount, receipt });
  }

  const r = await send({ method: 'POST', url: batchUrl(batch), body: { task: tok, answer: amount, payout: receipt }, signal: signal() }, { capture: captureTask(batch), keep });
  refusedStop(r, key, n, 'answer');
  if (!(r.status >= 200 && r.status < 300)) {
    journal({ key, event: 'answer_failed', http: r.status, why: r.refused ?? r.error, body: r.body?.slice(0, 500) });
    stop(`PAID but the ANSWER failed for task ${n}: ${show(r)}. Never paid again; only the answer may be retried (routine.mjs ${batch} picks it up).`);
  }
  journal({ key, status: 'answered', amount, receipt, http: r.status });
  summary.answered.push(n);
  out(`task ${n}: ANSWERED ${amount} EUR`);
  task = current(batch);
}
finish(0);
