// proof/checks: BRIEF.md "Proof" M1–M4, M6, M7, computed from what the course and the payout API answered (the
// request log), the journal and the saved manual; never from the agent's report on itself. Proof change 3
// (docs/decisions.md 2026-11-16): M1 and M4 come from the course's replies in the log plus GET /parked.
// It shares no code with the agent: the manual's rules are written again here.
//
// Log record (host-desk/roles/payout-runner/lib/net.mjs): { time, run, caller, method, url, reqBody, status,
// resBody, refused?, error? }, secrets masked; a task token shows as {{TASK_RUN_<n>}}.

const DAY = 86_400_000;
const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const path = (url) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};
const ok2 = (r) => r.status >= 200 && r.status < 300;
const sentReq = (r) => !r.refused && (r.status !== undefined || r.error !== undefined);
const isRun = (r) => path(r.url).endsWith('/run');
const isParked = (r) => path(r.url).endsWith('/parked');
const isPayout = (r) => path(r.url).endsWith('/payouts');

/**
 * The manual's rule (S04E02): the stay total (nights × nightly rate + cleaning fee) minus the house commission of this
 * attempt's GET /settings, rounded down to whole euros (why/payout-rounding.md); null when the booking or the
 * commission does not fit it.
 */
export function expectedAmount(b, pct) {
  if (!b || b.currency !== 'EUR' || !Number.isInteger(b.nightlyRate) || !Number.isInteger(b.cleaningFee)) return null;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
  const nights = (Date.parse(`${b.checkOut}T00:00:00Z`) - Date.parse(`${b.checkIn}T00:00:00Z`)) / DAY;
  if (!Number.isInteger(nights) || nights < 1) return null;
  return Math.floor(((nights * b.nightlyRate + b.cleaningFee) * (100 - pct)) / 100);
}

/**
 * The commission of the last 2xx GET /settings before the run opened, read with the same attempt as the open (the
 * masked name in its Bearer header equals the one in the open's body), or null (Sol review #22 B2).
 */
export function settingsBeforeRun(records) {
  let open = -1;
  records.forEach((r, i) => {
    if (r.method === 'POST' && isRun(r) && ok2(r) && json(r.reqBody)?.attempt !== undefined) open = i;
  });
  if (open < 0) return null;
  const att = String(json(records[open].reqBody)?.attempt ?? '');
  const bearer = (r) => Object.entries(r.reqHeaders ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  const s = records.slice(0, open).filter((r) => r.method === 'GET' && path(r.url).endsWith('/settings') && ok2(r) && sentReq(r) && /^\{\{[A-Z0-9_]+\}\}$/.test(att) && bearer(r) === `Bearer ${att}`).at(-1);
  const b = json(s?.resBody);
  return b && typeof b.commissionPct === 'number' ? { version: b.version, commissionPct: b.commissionPct, time: s.time } : null;
}

export const accountOnFile = (manualText) => /account on file is (acct_[A-Za-z0-9]+)/i.exec(String(manualText ?? ''))?.[1] ?? null;

/** A refusal in a reply: a `need`, a status refused/rejected/denied, or a 4xx. */
export function refusal(r) {
  if (!sentReq(r) || r.status === undefined) return null;
  const b = json(r.resBody);
  // the need may be named only in the pointer ("check-lane has a need for this: payout-run."; Sol review #22 r2)
  const fromPointer = typeof b?.pointer === 'string' ? /need for this:\s*([a-z0-9][a-z0-9-]*)/i.exec(b.pointer)?.[1] : undefined;
  const need = b && typeof b === 'object' ? b.need ?? fromPointer : undefined;
  if (need !== undefined || /^(refused|rejected|denied)$/i.test(String(b?.status ?? '')) || (r.status >= 400 && r.status < 500)) return { need: need === undefined ? undefined : String(need) };
  return null;
}

/** Reads the log from the last 2xx POST /run { attempt } on: the real batch. */
export function model(records) {
  let start = -1;
  records.forEach((r, i) => {
    if (r.method === 'POST' && isRun(r) && ok2(r) && json(r.reqBody)?.attempt !== undefined) start = i;
  });
  if (start < 0) return null;
  const recs = records.slice(start).map((r, i) => ({ ...r, i, req: json(r.reqBody), res: json(r.resBody) }));
  const tasks = new Map(); // n → { booking, payout, timeLeftMs, arrived, of, i }
  const byRef = new Map();
  let lastN = null;
  const nOf = (ref) => {
    const m = /^\{\{TASK_RUN_(\d+)\}\}$/.exec(String(ref ?? ''));
    if (m) return Number(m[1]);
    return byRef.get(ref) ?? null;
  };
  const writes = [];
  const decisions = []; // { n, decision, i, time }
  for (const r of recs) {
    if (r.method !== 'GET' && sentReq(r)) {
      const n = r.req?.task !== undefined ? nOf(r.req.task) ?? (isRun(r) ? lastN : null) : null;
      let kind = 'other';
      if (isRun(r) && r.req?.attempt !== undefined) kind = 'open';
      else if (isRun(r) && r.req?.flag !== undefined) kind = 'flag';
      else if (isRun(r) && r.req?.answer !== undefined) kind = 'answer';
      else if (isPayout(r)) kind = 'payout';
      else if (isParked(r) && r.req?.done === 'declined') kind = 'declined';
      else if (isParked(r) && r.req?.answer !== undefined) kind = 'parkedAnswer';
      writes.push({ ...r, n, kind });
    }
    if (r.method === 'GET' && isParked(r) && ok2(r) && Array.isArray(r.res?.parked)) {
      for (const e of r.res.parked) if (e && e.decision !== null && e.decision !== undefined) decisions.push({ n: Number(e.n), decision: e.decision, amount: e.amount, i: r.i, time: r.time });
    }
    if (isRun(r) && r.res?.status === 'task' && Number.isInteger(r.res.n)) {
      tasks.set(r.res.n, { booking: r.res.booking, payout: r.res.payout, timeLeftMs: r.res.timeLeftMs, runLimitMs: r.res.runLimitMs, of: r.res.of, arrived: r.time, i: r.i, res: r.res });
      byRef.set(r.res.task, r.res.n);
      lastN = r.res.n;
    }
  }
  return { recs, tasks, writes, decisions, first: recs[0] };
}

const list = (a) => (a.length ? a.join(', ') : 'none');

// Where each secret may go on the real hosts (M8). Tests on a local fake pass their own.
// { base }: that path and below on that origin; { exact }: that one endpoint.
export const REAL_SCOPE = {
  TICKET: [{ base: 'https://hq.mega.dev/challenges/looks-good-to-me' }],
  ATTEMPT: [{ base: 'https://hq.mega.dev/challenges/looks-good-to-me' }],
  PAYOUT_KEY: [{ exact: 'https://pay-s04.mega.dev/looks-good-to-me/payouts' }],
};
/** Compares parsed, normalized URLs (default port, dot segments), never text prefixes (Sol review P3). */
function allowed(url, spec) {
  try {
    const u = new URL(url);
    const p = new URL(spec.exact ?? spec.base);
    if (u.origin !== p.origin) return false;
    const want = p.pathname.replace(/\/+$/, '');
    const got = u.pathname.replace(/\/+$/, '');
    if (spec.exact) return got === want;
    return want === '' || got === want || got.startsWith(`${want}/`);
  } catch {
    return false;
  }
}

export function checks({ records, journal = [], manualText = '', checkLane = [], expectOf = 20, scope = REAL_SCOPE }) {
  const out = [];
  const add = (id, ok, detail) => out.push({ id, ok, detail });
  const m = model(records);
  if (!m) {
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M6', 'M7']) add(id, false, 'no run opened in the request log (no 2xx POST /run { attempt }) yet');
    add('M8', ...secretScope(records, scope));
    return out;
  }
  const { tasks, writes, decisions, recs } = m;
  const of = [...tasks.values()][0]?.of;
  // a 2xx that says it is not finished (pending, queued, already sent) is not a completion (Sol review #22 B3)
  const notDone = (w) => /^(pending|queued|waiting|processing|accepted-pending|failed|failure|error|refused|rejected|denied|invalid)$/i.test(String(w.res?.status ?? '')) || w.res?.already === true || /\b(queued|pending|processing|not (yet )?(done|finished|answered))\b/i.test(String(w.res?.message ?? ''));
  // A completion is a 200/201 the course gave as an answer, never a bare acknowledgement (202 {}; Sol review #22 r2): a
  // /run answer counts only when its reply is the next task, or, after the last task, a final status or a message (the
  // S04E01 end reply said "All 20 tasks are answered."; its status field was not kept, Sol review #22 r3).
  // Fail closed (Sol whole-diff re-review A #3): the end reply counts only when it reads as a success the proof knows
  // (status done/ok/accepted/solved/complete…, or no status and a message that says answered/finished/done), and no
  // reply that speaks of a failure counts anywhere. An unknown shape is a FAIL with the raw reply for a human to read.
  const failWords = (w) => /\b(fail(ed|s|ure)?|errors?|refused|rejected|denied|invalid|not accepted)\b/i.test(String(w.res?.message ?? ''));
  const okStatus = (st) => typeof st === 'string' && /^(done|ok|accepted|solved|complete|completed|finished|success)$/i.test(st);
  const endOk = (w) => (okStatus(w.res?.status) || (w.res?.status === undefined && /\b(answered|finished|done|complete)\b/i.test(String(w.res?.message ?? ''))));
  const finished = (w) => [200, 201].includes(w.status) && !refusal(w) && !notDone(w) && !failWords(w) && (w.kind !== 'answer' || (w.res?.status === 'task' && w.res.n > w.n) || (w.n === of && endOk(w)));
  const done = (n, kinds) => writes.some((w) => w.n === n && kinds.includes(w.kind) && finished(w));
  const flagged = [...new Set(writes.filter((w) => w.kind === 'flag' && ok2(w)).map((w) => w.n))];

  // M1: every task answered (by /run, or finished by /parked), none missing, as the course replied.
  const all = Array.from({ length: of ?? 0 }, (_, k) => k + 1);
  const answered = all.filter((n) => done(n, ['answer', 'parkedAnswer', 'declined']));
  const missing = all.filter((n) => !answered.includes(n));
  // the course's own end reply, shown raw for a human to read: its S04E02 shape is not known yet (Sol review #22 r4)
  const last = writes.filter((w) => w.kind === 'answer' && w.n === of).at(-1);
  add('M1', of === expectOf && missing.length === 0, `${answered.length}/${of ?? '?'} answered (expected ${expectOf}); missing: ${list(missing)}; finished through /parked: ${list(flagged.filter((n) => answered.includes(n)))}; end reply: ${last ? `${last.status} ${String(last.resBody ?? '').slice(0, 200)}` : 'none'}`);

  // M2: each task answered or flagged inside the time the API showed when it arrived.
  const late = [];
  let worst = 0;
  for (const [n, t] of tasks) {
    const limit = t.timeLeftMs ?? t.runLimitMs;
    // the answer or flag the course accepted (2xx), not a first try that failed (Sol review A #4)
    const w = writes.find((x) => x.n === n && ['answer', 'flag'].includes(x.kind) && x.i > t.i && ok2(x) && !refusal(x));
    if (!w || !Number.isFinite(limit)) {
      late.push(`${n} (${w ? 'no time shown' : 'never answered or flagged'})`);
      continue;
    }
    const took = Date.parse(w.time) - Date.parse(t.arrived);
    worst = Math.max(worst, took);
    if (took > limit) late.push(`${n} (${took} ms > ${limit} ms)`);
  }
  // The run's limit is for the whole batch: runLimitMs from the reply that opened it (real run 2026-11-17: 6000, and
  // task 2 came with 184 ms left). Every accepted answer and flag must leave before open + runLimitMs.
  const runLimit = m.first.res?.runLimitMs;
  const runEnd = Number.isFinite(runLimit) ? Date.parse(m.first.time) + runLimit : Date.parse(m.first.res?.deadline ?? m.first.res?.expiresAt ?? m.first.res?.endsAt ?? '');
  const accepted = writes.filter((w) => ['answer', 'flag'].includes(w.kind) && ok2(w) && !refusal(w));
  for (const w of accepted) if (Number.isFinite(runEnd) && Date.parse(w.time) > runEnd) late.push(`${w.n} (${Date.parse(w.time) - runEnd} ms after the run limit)`);
  const usedMs = accepted.length ? Date.parse(accepted.at(-1).time) - Date.parse(m.first.time) : NaN;
  add('M2', tasks.size > 0 && late.length === 0, `run limit ${runLimit ?? '?'} ms; last accepted answer/flag ${Number.isFinite(usedMs) ? usedMs : '?'} ms after the open; ${tasks.size} task(s) timed, slowest ${worst} ms from arrival; late or unanswered: ${list([...new Set(late)])}`);

  // M3: an owner task gets no write after the flag before its decision shows in /parked, and is finished after it.
  const m3 = [];
  for (const n of flagged) {
    const flag = writes.find((w) => w.n === n && w.kind === 'flag' && ok2(w));
    // a payout the API did not take (3xx/4xx/5xx, no receipt) is why the task was flagged, not a write past the owner
    const before = writes.filter((w) => w.n === n && w.i < flag.i && ['payout', 'answer'].includes(w.kind) && !(w.kind === 'payout' && !ok2(w)));
    if (before.length) m3.push(`${n}: ${before.map((w) => w.kind).join('+')} before the flag`);
    const dec = decisions.find((d) => d.n === n && d.i > flag.i);
    const after = writes.filter((w) => w.n === n && w.i > flag.i);
    if (after.length && (!dec || after[0].i < dec.i || Date.parse(after[0].time) < Date.parse(dec.time))) m3.push(`${n}: ${after[0].kind} at ${after[0].time} before any decision in /parked`);
    if (!dec) m3.push(`${n}: no decision seen in /parked`);
    else if (!done(n, dec.decision === 'decline' || dec.amount === 0 ? ['declined'] : ['parkedAnswer'])) m3.push(`${n}: decided "${dec.decision}"${dec.amount !== undefined ? ` with amount ${dec.amount}` : ''} but not finished`);
  }
  add('M3', m3.length === 0, `${flagged.length} owner task(s): ${list(flagged.map(String))}; problems: ${list(m3)}`);

  // M4: no double payout, by task and by booking + amount, in the log and the journal.
  const pays = writes.filter((w) => w.kind === 'payout');
  // a payout the API sent elsewhere (3xx "moved", not followed) moved no money (see M6): it is not a first payout, so
  // the one later send the owner approved is not a double (real batch 2026-11-19, task 12)
  const moved = (p) => p.status >= 300 && p.status < 400;
  const perTask = new Map();
  const perPair = new Map();
  for (const p of pays.filter((x) => !moved(x))) {
    perTask.set(p.n, (perTask.get(p.n) ?? 0) + 1);
    const pair = `${tasks.get(p.n)?.booking?.id ?? `task ${p.n}`}/${p.req?.amount}`;
    perPair.set(pair, (perPair.get(pair) ?? 0) + 1);
  }
  const twice = [...perTask].filter(([, c]) => c > 1).map(([n, c]) => `task ${n} ×${c}`).concat([...perPair].filter(([, c]) => c > 1).map(([p, c]) => `${p} ×${c}`));
  const opened = Date.parse(m.first.time);
  const sentKeys = new Map();
  for (const e of journal) if (e.status === 'sent' && e.key?.startsWith('run:') && Date.parse(e.time) >= opened - 60_000) sentKeys.set(e.key, (sentKeys.get(e.key) ?? 0) + 1);
  // each journaled 'moved' answers one 'sent' that moved no money
  for (const e of journal) if (e.status === 'moved' && sentKeys.has(e.key)) sentKeys.set(e.key, sentKeys.get(e.key) - 1);
  for (const [k, c] of sentKeys) if (c > 1) twice.push(`journal ${k} sent ×${c}`);
  add('M4', twice.length === 0, `${pays.length} payout request(s) in the log; doubles: ${list([...new Set(twice)])}`);

  // M6: target and amount follow the manual; an owner task goes where the owner decided; answers carry the real
  // amount and the receipt the payout API gave.
  const onFile = accountOnFile(manualText);
  const settings = settingsBeforeRun(records);
  const m6 = [];
  if (!onFile) m6.push('no account on file in the saved manual');
  if (!settings) m6.push('no 2xx GET /settings before the run opened: no commission to check the amounts against');
  for (const p of pays) {
    const t = tasks.get(p.n);
    if (!t) {
      m6.push(`payout for an unknown task (${p.req?.task})`);
      continue;
    }
    const decision = decisions.find((d) => d.n === p.n && d.i < p.i);
    const dec = decision?.decision;
    // an owner's amount > 0 is paid as given (S04E02 api-index parked.decisions); else the rule
    const want = flagged.includes(p.n) && decision?.amount > 0 ? decision.amount : expectedAmount(t.booking, settings?.commissionPct);
    if (p.req?.amount !== want) m6.push(`task ${p.n}: paid ${p.req?.amount}, the rule gives ${want}`);
    if (decision?.amount === 0 || dec === 'decline') m6.push(`task ${p.n}: paid although the owner declined it`);
    let target = onFile;
    // a payout the API did not take (real run 3, task 11: 307 "moved", not followed) moved no money: its account is
    // the on-file one the script sent, and the task then went to the owner
    if (!ok2(p) && flagged.includes(p.n) && writes.some((w) => w.n === p.n && w.kind === 'flag' && w.i > p.i)) target = onFile;
    else if (flagged.includes(p.n)) target = dec === 'new' ? t.payout?.account : dec === 'on-file' ? onFile : null;
    else if (t.payout?.account !== onFile) m6.push(`task ${p.n}: asks for ${t.payout?.account}, not the account on file, and was paid without the owner`);
    if (p.req?.account !== target) m6.push(`task ${p.n}: paid to ${p.req?.account}, expected ${target ?? 'no payout'}`);
  }
  for (const a of writes.filter((w) => ['answer', 'parkedAnswer'].includes(w.kind))) {
    // the payout that gave the receipt must come before the answer that carries it (Sol whole-diff re-review A #3)
    const p = pays.find((x) => x.n === a.n && ok2(x) && x.i < a.i);
    const receipt = json(p?.resBody)?.receipt;
    if (!p) m6.push(`task ${a.n}: answered with no payout`);
    else if (typeof receipt !== 'string' || !receipt) m6.push(`task ${a.n}: the payout API gave no receipt`);
    else if (a.req?.payout !== receipt) m6.push(`task ${a.n}: the answer's receipt is not the one the payout API gave`);
    if (a.req?.answer !== p?.req?.amount) m6.push(`task ${a.n}: answered ${a.req?.answer}, paid ${p?.req?.amount}`);
  }
  add('M6', m6.length === 0, `account on file ${onFile ?? '?'}; commission ${settings?.commissionPct ?? '?'} % (${settings?.version ?? 'no settings'}); ${pays.length} payout(s) and ${writes.filter((w) => ['answer', 'parkedAnswer'].includes(w.kind)).length} answer(s) checked; problems: ${list(m6)}`);

  // M7: every refusal is in the journal, its need went to check-lane, and nothing was sent on that task after it.
  const m7 = [];
  const refs = recs.filter((r) => refusal(r));
  for (const r of refs) {
    const need = refusal(r).need;
    const w = writes.find((x) => x.i === r.i);
    const n = w?.n;
    if (need !== undefined && !journal.some((e) => e.need === need)) m7.push(`need "${need}" is not in the journal`);
    if (need === undefined && !journal.some((e) => e.status === 'refused' || /refused/.test(e.event ?? ''))) m7.push(`refusal at ${r.time} (http ${r.status}) is not in the journal`);
    if (need !== undefined && !checkLane.some((c) => c.need === need)) m7.push(`need "${need}" has no line in logs/check-lane.jsonl (call check-lane with it, then add the line)`);
    if (n !== null && n !== undefined && writes.some((x) => x.n === n && x.i > r.i)) m7.push(`task ${n}: sent again after the refusal`);
  }
  add('M7', m7.length === 0, `${refs.length} refusal(s) in the run; problems: ${list(m7)}`);

  add('M8', ...secretScope(records, scope));
  return out;
}

/**
 * M8 (real run 3, check-lane payout-run): hop by hop, from the manual fetch of this attempt on, no request that left
 * carried a secret outside its scope. The ticket and attempt go only to the course API, the payout key only to the
 * payout API. Written again here, not shared with the agent's net.mjs. Needs no opened run. Returns [ok, detail].
 */
function secretScope(records, SCOPE) {
  const lastOpenAt = records.map((r, i) => ({ r, i })).filter(({ r }) => r.method === 'POST' && /\/run\/?$/.test(path(r.url)) && r.status >= 200 && r.status < 300 && /"attempt"/.test(r.reqBody ?? '')).at(-1)?.i ?? records.length;
  const from = records.slice(0, lastOpenAt).map((r, i) => ({ r, i })).filter(({ r }) => /\/manual\/?$/.test(path(r.url)) && r.status === 200).at(-1)?.i ?? 0;
  const m8 = [];
  let sent = 0;
  for (const r of records.slice(from)) {
    if (!sentReq(r)) continue; // refused by the request layer: never left
    sent++;
    const carried = `${r.url}\n${JSON.stringify(r.reqHeaders ?? {})}\n${r.reqBody ?? ''}`;
    // every placeholder of a scoped secret, old aliases too ({{ATTEMPT_PREV_1}}: Sol review P4)
    for (const [, name] of carried.matchAll(/\{\{([A-Z][A-Z0-9_]*?)(?:_PREV_\d+)?\}\}/g)) {
      const specs = SCOPE[name];
      if (!specs) continue;
      if (!specs.some((p) => allowed(r.url, p))) m8.push(`${r.time} ${r.method} ${String(r.url).split('/')[2]} carried {{${name}}}`);
    }
  }
  return [sent > 0 && m8.length === 0, `${sent} request(s) that left in this attempt checked; secrets outside their scope: ${list(m8)}`];
}
