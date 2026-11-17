// A local fake of the course API and the payout API, in the shape of the index (logs/manual/manual-2026-11-16T23-01-32-060Z.txt)
// and the real practice replies (KEEP.md). Not a test file: core.test.mjs and proof.test.mjs import it.
import { createServer } from 'node:http';

export const FAKE = { TICKET: 'tkt_FAKE_1234567890_abcdef', PAYOUT_KEY: 'pk_FAKE_key_0987654321' };
export const ON_FILE = 'acct_onfile0001';
export const VERIFY_SECRET = 'vp_SECRETPATH_1234567890';
export const token = (batch, n) => `tsk_SECRET_${batch}_${n}_${'x'.repeat(12)}`;
export const booking = (n, over = {}) => ({ id: `BK-${1000 + n}`, checkIn: '2027-03-28', checkOut: '2027-04-05', nightlyRate: 200 + n, cleaningFee: 30, currency: 'EUR', ...over });

export async function startFake() {
  const f = {
    hits: [],
    manualFetches: 0,
    reset(opts = {}) {
      this.hits = [];
      this.manualFetches = 0;
      this.of = { practice: 3, run: opts.runTasks ?? 5 };
      this.over = opts.over ?? {}; // n → fields over the run task (booking, payout)
      this.parked = new Map(); // n → decision (null until decided)
      this.decideAfter = opts.decideAfter ?? {}; // n → { reads, decision }: decided after that many GET /parked
      this.parkedReads = 0;
      this.dupEntries = !!opts.dupEntries;
      this.payoutDelayMs = opts.payoutDelayMs ?? 0;
      this.refuseAnswer = opts.refuseAnswer ?? null; // n → reply { code, body }
      this.attempts = 0;
    },
    task(batch, n) {
      const o = batch === 'run' ? this.over[n] ?? {} : {};
      return {
        status: 'task', n, of: this.of[batch], ...(n === 1 ? { runLimitMs: 8000 } : {}), timeLeftMs: 8000,
        booking: booking(n, o.booking), payout: { account: ON_FILE, url: 'https://pay-s04.mega.dev/payouts', ...o.payout },
        task: token(batch, n), next: 'Pay this booking at the payout API, then send its answer and the payout receipt here.',
      };
    },
  };
  f.reset();
  const nOf = (tok) => Number(/_(\d+)_x+$/.exec(String(tok))?.[1]);
  const next = (batch, n) => (n < f.of[batch] ? f.task(batch, n + 1) : { status: 'done', message: `${batch} is done.` });
  f.server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const b = body ? JSON.parse(body) : {};
      f.hits.push({ method: req.method, path: req.url, body: b, headers: req.headers, time: Date.now() });
      const json = (code, o) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      const auth = req.headers.authorization ?? '';
      if (req.method === 'GET' && req.url === '/manual') {
        if (auth !== `Bearer ${FAKE.TICKET}`) return json(401, { error: 'bad ticket' });
        f.manualFetches++;
        f.attempts++;
        const manual = `# House manual\n- The account on file is ${ON_FILE}.\n- Before a run, check the payout key: GET https://verify-s04.mega.dev/${VERIFY_SECRET} with the header X-Payout-Key: <key>.`;
        return json(200, { attempt: `att_SECRET_attempt_${f.attempts}_zz`, attemptExpiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), manual, next: 'Practice is optional.' });
      }
      if (req.method === 'GET' && req.url.startsWith('/verify/')) {
        if (req.url !== `/verify/${VERIFY_SECRET}`) return json(404, { error: 'no such path' });
        if (req.headers['x-payout-key'] !== FAKE.PAYOUT_KEY) return json(401, { error: 'bad key', need: 'payout-key' });
        return json(200, { status: 'ok', message: 'The payout key works.' });
      }
      if (req.url === '/payouts') {
        if (f.payoutDelayMs) await new Promise((r) => setTimeout(r, f.payoutDelayMs));
        return json(200, { status: 'paid', receipt: `v1.rcpt_${nOf(b.task)}_${b.account}_${b.amount}`, next: 'Send this receipt with the task\'s answer to the run.' });
      }
      if (req.url === '/practice' || req.url === '/run') {
        const batch = req.url.slice(1);
        if (b.attempt) return json(200, f.task(batch, 1));
        const n = nOf(b.task);
        if (b.flag) {
          f.parked.set(n, null);
          return json(200, next(batch, n));
        }
        if (b.answer !== undefined) {
          const r = f.refuseAnswer?.[n];
          if (r) return json(r.code, r.body);
          return json(200, next(batch, n));
        }
      }
      if (req.url === '/parked' && req.method === 'GET') {
        f.parkedReads++;
        for (const [n, d] of Object.entries(f.decideAfter)) if (f.parkedReads > d.reads && f.parked.has(Number(n))) f.parked.set(Number(n), d.decision);
        const list = [...f.parked].map(([n, decision]) => ({ n, decision }));
        return json(200, { parked: f.dupEntries ? [...list, ...list] : list });
      }
      if (req.url === '/parked' && req.method === 'POST') return json(200, { status: 'ok', n: nOf(b.task) });
      json(404, { error: 'no route' });
    });
  });
  await new Promise((r) => f.server.listen(0, '127.0.0.1', r));
  f.base = `http://localhost:${f.server.address().port}`;
  f.server.unref();
  return f;
}
