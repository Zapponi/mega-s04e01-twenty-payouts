// journal status — where this attempt stands, from the journal and the state file only (no request):
// the attempt and until when it is open, the key check, each batch (opened, answered, waiting for the owner,
// uncertain, refused, declined), the current task, and the next step. Step 0 of ROLE.md: a restart reads this and
// never fetches the manual again while the attempt is open.
import { events } from '../lib/batch.mjs';
import { current, state, taskOf } from '../lib/flow.mjs';
import { attemptOpenUntil } from '../lib/net.mjs';

if ((process.argv[2] ?? 'status') !== 'status') {
  console.log('Usage: journal.mjs status');
  process.exit(2);
}
const st = state();
const until = attemptOpenUntil(st);
const open = until > Date.now();
const att = st.ATTEMPT_SEEN_AT;
const ev = events().filter((e) => (e.key ? e.key.endsWith(`:${att}`) : e.attempt === att));
const lines = [];
lines.push(open ? `attempt: open, fetched ${att}, open until ${new Date(until).toISOString()} (${Math.round((until - Date.now()) / 60000)} min left). Do not fetch the manual again.` : `attempt: none open${att ? ` (last fetched ${att}, closed)` : ''}. Fetch the manual once.`);
const key = ev.filter((e) => e.event === 'key_checked').at(-1);
lines.push(`key check: ${key ? (key.ok ? `ok (${key.time})` : `FAILED (http ${key.http ?? '-'}, ${key.why ?? ''})`) : 'not done in this attempt'}`);

let next = open ? null : 'fetch the manual (GET /manual, Bearer {{TICKET}}), once';
let stopNote = null;
if (!next && !key?.ok) next = 'check-key.mjs';
for (const batch of ['practice', 'run']) {
  const opened = ev.some((e) => e.event === 'opened' && e.batch === batch);
  const last = new Map();
  for (const e of ev) if (e.key?.startsWith(`${batch}:`) && e.status) last.set(Number(e.key.split(':')[1]), e.status);
  const by = (s) => [...last].filter(([, v]) => v === s).map(([n]) => n).sort((a, b) => a - b);
  const cur = opened && open ? current(batch) : null;
  const curTxt = cur?.status === 'task' ? `current task ${cur.n} of ${cur.of} (status ${last.get(cur.n) ?? 'open'}, timeLeftMs at arrival ${cur.timeLeftMs})` : cur ? `last reply status "${cur.status}"` : 'no reply kept';
  lines.push(`${batch}: ${opened ? 'opened' : 'not opened'}; answered [${by('answered')}]; waiting_owner [${by('waiting_owner')}]; declined [${by('declined')}]; uncertain [${by('uncertain')}]; sent-unconfirmed [${by('sent')}]; paid-not-answered [${by('paid')}]; refused [${by('refused')}]; ${curTxt}`);
  if (next) continue;
  const s = cur?.status === 'task' ? last.get(cur.n) : undefined;
  const runOpened = ev.some((e) => e.event === 'opened' && e.batch === 'run');
  if (!opened && batch === 'practice' && runOpened) continue; // practice is optional; once the run is open it is skipped
  if (!opened) next = `start.mjs ${batch}`;
  else if (cur?.status === 'task' && (!s || s === 'not_sent')) next = `settle.mjs ${batch} pay (or flag) for task ${cur.n}`;
  else if (s === 'paid') next = `settle.mjs ${batch} answer for task ${cur.n}`;
  else if (['sent', 'uncertain', 'refused', 'flag_sent'].includes(s)) {
    // that task is never retried; the rest of the day goes on
    const then = batch === 'practice' ? 'go on to the run' : by('waiting_owner').length ? 'parked.mjs' : 'the final summary';
    next = `report task ${cur.n} of ${batch} (${s}; never retry it), then ${then}`;
    if (batch === 'practice') {
      lines.push(`${batch} stopped at task ${cur.n}`);
      next = null;
      stopNote = `report task ${cur.n} of practice (${s}; never retry it)`;
    }
  } else if (batch === 'run' && by('waiting_owner').length) next = 'parked.mjs';
  // The batch gave no next task, yet fewer tasks were handled than it has: never take that for the end.
  const of = taskOf(batch, 1)?.of;
  if (opened && cur && cur.status !== 'task' && Number.isInteger(of) && last.size < of) {
    const note = `stop: the ${batch} gave no next task after task ${Math.max(0, ...last.keys())} (${last.size}/${of} handled; last reply status "${cur.status}"); tell the human`;
    lines.push(`${batch}: INCOMPLETE, ${last.size}/${of} tasks handled`);
    if (batch === 'practice') stopNote = stopNote ?? note;
    else next = next ? `${next}; then ${note}` : note;
  }
}
if (stopNote) next = next ? `${stopNote}; ${next}` : stopNote;
lines.push(`next: ${next ?? 'nothing left: write the final summary'}`);
console.log(lines.join('\n'));
