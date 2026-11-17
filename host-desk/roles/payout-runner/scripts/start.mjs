// start <practice|run>: opens the batch with this attempt and prints the first task (masked).
// The run opens only with ALLOW_RUN=1 (the human's yes for the real batch). No batch opens twice in one attempt: a
// second POST { attempt } reopens practice at task 1 (KEEP.md), which would deal tasks already paid again.
import { claim, journal, events } from '../lib/batch.mjs';
import { batchArg, batchUrl, captureTask, refusalOf, saveCurrent, show, state } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

const batch = batchArg(process.argv[2]);
const st = state();
if (!st.ATTEMPT) {
  console.log('No attempt yet: fetch the manual first (GET /manual with Bearer {{TICKET}}).');
  process.exit(1);
}
if (batch === 'run' && process.env.ALLOW_RUN !== '1') {
  console.log('The real run is not allowed in this session (ALLOW_RUN is not 1). Stop and tell the human.');
  process.exit(1);
}
if (events().some((e) => e.event === 'opened' && e.batch === batch && e.attempt === st.ATTEMPT_SEEN_AT)) {
  console.log(`The ${batch} is already open for this attempt; never open it twice. Run journal.mjs status and continue with settle${batch === 'run' ? ' or parked' : ''}.`);
  process.exit(1);
}
// Claimed and journaled before the send: an open whose reply is lost may have landed, and is never sent again
// (Sol review A #2).
if (!claim(`open:${batch}:${st.ATTEMPT_SEEN_AT}`, 'open')) {
  console.log(`The ${batch} was already opened (or its open is unclear) for this attempt; never open it twice. Run journal.mjs status; if it shows no task, tell the human.`);
  process.exit(1);
}
journal({ event: 'opening', batch, attempt: st.ATTEMPT_SEEN_AT });
process.env.WRITE_URLS = batchUrl(batch);
const r = await send(
  { method: 'POST', url: batchUrl(batch), body: { attempt: '{{ATTEMPT}}' }, signal: AbortSignal.timeout(Number(process.env.SETTLE_TIMEOUT_MS || 4000)) },
  { capture: captureTask(batch), keep: (text) => saveCurrent(batch, text) },
);
journal(r.status >= 200 && r.status < 300 && !refusalOf(r) ? { event: 'opened', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status } : { event: 'open_failed', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status, why: r.refused ?? r.error }); // 'opened' only for an accepted open (Sol review D #1)
const ref = r.status ? refusalOf(r) : null;
if (ref) {
  journal({ event: 'open_refused', batch, need: ref.need, why: ref.why, http: r.status });
  console.log(`REFUSED opening the ${batch}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}. Stop and report it; the harness calls check-lane with the need.`);
  process.exit(5);
}
console.log(show(r));
