// start <practice|run>: opens the batch with this attempt and prints the first task (masked).
// The run opens only with ALLOW_RUN=1 (the human's yes for the real batch). No batch opens twice in one attempt: a
// second POST { attempt } reopens practice at task 1 (KEEP.md), which would deal tasks already paid again.
import { journal, events } from '../lib/batch.mjs';
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
process.env.WRITE_URLS = batchUrl(batch);
const r = await send({ method: 'POST', url: batchUrl(batch), body: { attempt: '{{ATTEMPT}}' } }, { capture: captureTask(batch) });
if (r.status) {
  journal({ event: 'opened', batch, attempt: st.ATTEMPT_SEEN_AT, http: r.status });
  saveCurrent(batch, r.body);
}
const ref = r.status ? refusalOf(r) : null;
if (ref) {
  journal({ event: 'open_refused', batch, need: ref.need, why: ref.why, http: r.status });
  console.log(`REFUSED opening the ${batch}: ${ref.why}${ref.need ? `; need: ${ref.need}` : ''}. Stop and report it; the harness calls check-lane with the need.`);
  process.exit(5);
}
console.log(show(r));
