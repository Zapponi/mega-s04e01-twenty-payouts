// routine <practice|run>: the whole batch in one run of code (check-lane "routine-script", 2026-11-17: "code that runs
// them all in one go, with one open connection"). The run's limit is for the whole batch (runLimitMs 6000 in the real
// run, KEEP.md), so no model turn may sit between two tasks.
// It opens the batch (or picks up the open task after a restart), then, for each task, with the same rules as settle.mjs:
//   - a plain payout to the account on file → pay once, answer with the receipt;
//   - anything else (another account, a field a plain task does not carry, a booking already paid, an amount the rule
//     cannot compute) → in the run: flag it for the owner and go on; in the practice: stop;
//   - a payout with no receipt and no refusal (a redirect, a timeout, an error) → in the run: never sent again, flag it
//     for the owner with the reason and go on (real run 2: a stop there lost the batch); in the practice: stop;
//   - a refusal, or an unclear flag → stop at once: that task is never retried.
// One process, so Node's fetch keeps the connections to the course and payout hosts open between tasks.
// It prints one line per task and a summary; every request is in the request log, every step in the journal.
import { amountOf, claim, events, journal, oddFields, release, statusOf, targetOf } from '../lib/batch.mjs';
import { batchArg, batchUrl, captureTask, current, payoutsUrl, refusalOf, saveCurrent, show, state, taskOf, taskVar } from '../lib/flow.mjs';
import { attemptOpenUntil, send } from '../lib/net.mjs';
import { readSettings, settingsOf } from '../lib/settings.mjs';

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
// No key check: the manual's "check the payout key" sends the key to a host the manual names, a document's request
// to a new host (check-lane payout-run, real run 3 refused). The request layer now refuses it (net.mjs scopeOf).

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
/** The host a redirect body names (never its path: it may hold a token), or "an address not given". */
function hostOf(body) {
  try {
    return new URL(JSON.parse(body)?.url).host;
  } catch {
    return 'an address not given';
  }
}
function pointerOf(r) {
  try {
    const p = JSON.parse(r.body)?.pointer;
    return typeof p === 'string' ? p.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

// Pace guard (Sol review C, 2026-11-17): the S04E01 real run gave 6000 ms for all 20 tasks (KEEP.md). S04E02 shows its
// limit only in the first run task, so before the open 6000 ms is the one evidence there is (RUN_BUDGET_MS changes it).
// Before opening the run,
// the practice of this attempt, run by this routine, shows what one task costs on the real hosts (payout + answer). If
// 20 of them would not fit with a margin, the run is not opened: a refused run cannot be taken back.
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS || 6000); // runLimitMs of the S04E01 real run, 2026-11-17
const MARGIN = 0.85; // keep 15% of the budget free: the agent's own pick, said so
if (batch === 'run' && !events().some((e) => e.event === 'opened' && e.batch === 'run' && e.attempt === st.ATTEMPT_SEEN_AT)) {
  const ev = events();
  const per = [];
  for (const e of ev.filter((x) => x.status === 'answered' && x.key?.startsWith('practice:') && x.key.endsWith(`:${st.ATTEMPT_SEEN_AT}`))) {
    const sent = ev.find((x) => x.key === e.key && x.status === 'sent');
    if (sent) per.push(Date.parse(e.time) - Date.parse(sent.time));
  }
  if (per.length) {
    const avg = Math.round(per.reduce((a, b) => a + b, 0) / per.length);
    const need = avg * 20;
    out(`PACE: the practice took ${per.join(', ')} ms per task (payout + answer); 20 tasks ≈ ${need} ms of the ${RUN_BUDGET_MS} ms budget.`);
    if (need > RUN_BUDGET_MS * MARGIN) stop(`PACE TOO SLOW: 20 tasks would take about ${need} ms, over ${Math.round(RUN_BUDGET_MS * MARGIN)} ms (85% of ${RUN_BUDGET_MS}). The run was NOT opened. Tell the human.`, 6);
  } else out('PACE: no practice by the routine in this attempt; nothing measured. Going on.');
}

// open, or pick up where the journal says. "opened" is journaled only for an accepted open (Sol review D #1).
let task;
const opened = events().some((e) => e.event === 'opened' && e.batch === batch && e.attempt === st.ATTEMPT_SEEN_AT);
if (opened) {
  task = current(batch);
  out(`The ${batch} is already open for this attempt: picking up at ${task?.status === 'task' ? `task ${task.n}` : `reply "${task?.status}"`}.`);
} else {
  // Before an open nothing is sent yet: the attempt must have time left, and this attempt's settings must be read
  // (S04E02: the commission changes per attempt; plan.md § 4 "setup reads before POST /run").
  const left = attemptOpenUntil(st) - Date.now();
  const MIN_LEFT_MS = Number(process.env.MIN_ATTEMPT_LEFT_MS || 10 * 60_000);
  if (left < MIN_LEFT_MS) stop(`the attempt has ${Math.max(0, Math.round(left / 60_000))} min left (under ${MIN_LEFT_MS / 60_000}); the ${batch} was NOT opened. Tell the human.`, 6);
  const set = await readSettings(st);
  if (!set.ok) stop(`${set.why}. The ${batch} was NOT opened${set.need ? `; need: ${set.need}. The harness calls check-lane with the need` : ''}. Tell the human.`, set.need ? 5 : 3);
  out(`SETTINGS ${set.version}: commission ${set.commissionPct} %.`);
  if (!claim(`open:${batch}:${st.ATTEMPT_SEEN_AT}`, 'open')) stop(`the ${batch} open failed or is unclear for this attempt; never sent twice. Tell the human.`);
  journal({ event: 'opening', batch, attempt: st.ATTEMPT_SEEN_AT });
  const r = await send({ method: 'POST', url: batchUrl(batch), body: { attempt: '{{ATTEMPT}}' }, signal: signal() }, { capture: captureTask(batch), keep });
  const ref = r.status ? refusalOf(r) : null;
  if (ref) {
    journal({ event: 'open_refused', batch, attempt: st.ATTEMPT_SEEN_AT, need: ref.need, why: ref.why, http: r.status, pointer: pointerOf(r) });
    stop(`REFUSED opening the ${batch}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}${pointerOf(r) ? `; ${pointerOf(r)}` : ''}. Never retried. The harness calls check-lane with the need.`, 5);
  }
  if (!(r.status >= 200 && r.status < 300)) {
    journal({ event: 'open_failed', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status, why: r.refused ?? r.error });
    stop(`could not open the ${batch}: ${show(r)}. Never sent again; tell the human.`);
  }
  journal({ event: 'opened', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status });
  task = current(batch);
  out(`OPENED ${batch}: ${task?.of ?? '?'} tasks, runLimitMs ${task?.runLimitMs ?? '?'}, timeLeftMs ${task?.timeLeftMs ?? '?'}.`);
}
// The commission of this attempt, read before the open (above, or by the session that opened it).
const settings = settingsOf(st, batch);
if (!settings) stop(`no /settings read for this attempt is in the journal; no payout without the commission. Tell the human.`);

/**
 * The reply after an accepted answer or flag must be the next task, or the end after the last one. Anything else
 * (a 200 with no task before task `of`) stops at once, never read as success (Sol review C #1).
 */
function advance(prev) {
  const nx = current(batch);
  if (nx?.status === 'task' && Number.isInteger(nx.n) && nx.n > prev.n) return nx;
  if (nx && nx.status !== 'task' && Number.isInteger(prev.of) && prev.n >= prev.of) return nx;
  stop(`the ${batch} gave no next task after task ${prev.n} of ${prev.of ?? '?'} (reply: ${JSON.stringify(nx)?.slice(0, 200)}). Never taken for the end: tell the human.`);
}

// The run's one clock (Sol review 2026-11-17 #3): a payout never waits past the batch deadline minus the time a flag
// needs, so an unclear payout can still be handed to the owner in time. FLAG_RESERVE_MS: the flag of task 9 in real
// run 2 took 633 ms from sent to accepted (journal), rounded up.
const FLAG_RESERVE_MS = 800;
// The clock is the one the first run task shows (S04E02 gives it only there): it starts no later than the open was
// sent ('opening' in the journal), so the deadline is taken from that moment, never from S04E01's 6000 ms.
const openingAt = Date.parse(events().filter((e) => e.event === 'opening' && e.batch === batch && e.attempt === st.ATTEMPT_SEEN_AT).at(-1)?.time ?? '');
const first = taskOf(batch, 1);
const runLimit = Number.isFinite(first?.runLimitMs) ? first.runLimitMs : first?.timeLeftMs;
const deadline = batch === 'run' && Number.isFinite(openingAt) && Number.isFinite(runLimit) ? openingAt + runLimit : Infinity;
const payoutWait = () => Math.max(200, Math.min(TIMEOUT_MS, deadline - Date.now() - FLAG_RESERVE_MS));

/**
 * Hands task n to the owner with a flag and moves on to the next task. The caller holds the 'act' claim.
 * A flag that is refused or unclear still stops: the batch's next task comes only in the flag's reply.
 */
async function flagOwner(n, key, tok, why) {
  // one flag per task, atomic across processes, never released (Sol re-review 2026-11-17 P1: two recoveries at once)
  if (!claim(key, 'flag')) stop(`task ${n}: its owner flag is already sent or being sent by another run; never sent twice. Tell the human.`);
  journal({ key, status: 'flag_sent', n, reason: why });
  const r = await send({ method: 'POST', url: batchUrl(batch), body: { task: tok, flag: 'needs-owner', reason: why.slice(0, 300) }, signal: signal() }, { capture: captureTask(batch), keep });
  refusedStop(r, key, n, 'flag');
  if (r.refused) {
    // after a tried payout, "not_sent" would let a restart pay again: the task stays as it is and the human is told
    if (events().some((e) => e.key === key && ['moved', 'uncertain', 'sent'].includes(e.status))) stop(`flag of task ${n} not sent (${r.refused}) after its payout was tried; never paid again. Tell the human.`);
    journal({ key, status: 'not_sent', step: 'flag', why: r.refused });
    release(key, 'act');
    release(key, 'flag'); // proven not sent (refused before any request): a restart may send it (Sol re-review 2 P2)
    stop(`flag of task ${n} not sent: ${r.refused}`);
  }
  if (!(r.status >= 200 && r.status < 300)) {
    journal({ key, event: 'flag_failed', http: r.status, why: r.error });
    stop(`FLAG UNCLEAR for task ${n}: ${show(r)}. It may have landed: never paid; parked.mjs finishes it if the owner decides it.`);
  }
  journal({ key, status: 'waiting_owner', n, reason: why, http: r.status });
  summary.flagged.push(n);
  out(`task ${n}: FLAGGED for the owner (${why})`);
  return advance(task);
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
  } else if (batch === 'run' && ['moved', 'uncertain'].includes(done) && !events().some((e) => e.key === key && e.status === 'flag_sent')) {
    // a crash after the payout's unclear result but before its flag (Sol review 2026-11-17 #2): the payout is never
    // sent again; the flag, never sent, goes out once now
    const last = events().filter((e) => e.key === key && e.status === done).at(-1);
    out(`task ${n}: picking up the owner flag after a ${done} payout (never paid again).`);
    task = await flagOwner(n, key, tok, `the payout ${done === 'moved' ? `was redirected (http ${last?.http ?? '?'}), not followed, not paid` : 'result is unclear; it may have gone through, so it is never sent again'}`);
    continue;
  } else if (done && done !== 'not_sent') {
    stop(`task ${n} already has status "${done}": never sent again. Tell the human.`);
  } else {
    // decide in code
    const a = amountOf(task.booking, settings.commissionPct);
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
      task = await flagOwner(n, key, tok, why);
      continue;
    }

    if (!claim(key, 'act')) stop(`task ${n} is already being paid or flagged by another run.`);
    journal({ key, status: 'sent', amount: a.amount, nights: a.nights, total: a.total, commissionPct: settings.commissionPct, settings: settings.version, account: st.ACCOUNT_ON_FILE, bookingId: task.booking.id });
    const p = await send({ method: 'POST', url: payoutsUrl(), headers: { 'X-Payout-Key': '{{PAYOUT_KEY}}' }, body: { task: tok, account: st.ACCOUNT_ON_FILE, amount: a.amount }, signal: AbortSignal.timeout(payoutWait()) });
    try {
      receipt = JSON.parse(p.body)?.receipt;
    } catch {}
    refusedStop(p, key, n, 'payout'); // a refusal stops even when a receipt came with it (Sol review D #2)
    if (!(p.status >= 200 && p.status < 300) || typeof receipt !== 'string' || !receipt) {
      if (p.refused) {
        journal({ key, status: 'not_sent', step: 'payout', why: p.refused });
        release(key, 'act');
        stop(`payout of task ${n} not sent: ${p.refused}`);
      }
      // No receipt and no refusal: a redirect (real run 2, task 15: 307 "moved" to a host outside the manual, never
      // followed), a timeout, an error. The batch must not stall (Giovanni, 2026-11-17: "nao pode travar"): in the run
      // the task goes to the owner with the reason, and the payout is never sent again, by this script or parked.mjs.
      const moved = p.status >= 300 && p.status < 400;
      journal({ key, status: moved ? 'moved' : 'uncertain', http: p.status, why: p.error, body: p.body?.slice(0, 500) });
      const why = moved
        ? `the payout API answered ${p.status} and points to another address (${hostOf(p.body)}), which the manual does not name; not followed, not paid`
        : `the payout's result is unclear (${p.status ? `http ${p.status}` : p.error ?? 'no reply'}); it may have gone through, so it is never sent again`;
      if (batch !== 'run') stop(`${moved ? 'MOVED' : 'UNCERTAIN'} payout for practice task ${n}: ${why}. Tell the human.`);
      if (process.env.TEST_CRASH_AT === 'after-unclear-payout') process.exit(9); // unit test only: a crash before the flag
      task = await flagOwner(n, key, tok, why);
      continue;
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
  task = advance(task);
}
finish(0);
