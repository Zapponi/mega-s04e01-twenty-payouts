// start <practice|run>: opens the batch with this attempt and prints the first task (masked).
// The run opens only with ALLOW_RUN=1 (the human's yes for the real batch) and never twice.
import { journal, events } from '../lib/batch.mjs';
import { batchArg, batchUrl, captureTask, saveCurrent, show, state } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

const batch = batchArg(process.argv[2]);
const st = state();
if (!st.ATTEMPT) {
  console.log('No attempt yet: fetch the manual first (GET /manual with Bearer {{TICKET}}).');
  process.exit(1);
}
if (batch === 'run') {
  if (process.env.ALLOW_RUN !== '1') {
    console.log('The real run is not allowed in this session (ALLOW_RUN is not 1). Stop and tell the human.');
    process.exit(1);
  }
  if (events().some((e) => e.event === 'opened' && e.batch === 'run' && e.attempt === st.ATTEMPT_SEEN_AT)) {
    console.log('The run is already open for this attempt; continue with settle, never open it twice.');
    process.exit(1);
  }
}
process.env.WRITE_URLS = batchUrl(batch);
const r = await send({ method: 'POST', url: batchUrl(batch), body: { attempt: '{{ATTEMPT}}' } }, { capture: captureTask });
if (r.status) {
  journal({ event: 'opened', batch, attempt: st.ATTEMPT_SEEN_AT, status: undefined, http: r.status });
  saveCurrent(batch, r.body);
}
console.log(show(r));
