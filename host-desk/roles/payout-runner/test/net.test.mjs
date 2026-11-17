// Request layer tests (plan.md § 0). No model, no outside host: a local server echoes what it gets.
// Run: node --test host-desk/roles/payout-runner/test/
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'net-test-'));
const FAKE = { TICKET: 'tkt_FAKE_1234567890_abcdef', PAYOUT_KEY: 'pk_FAKE/key+with=chars 42' };
writeFileSync(join(tmp, 'vars.json'), JSON.stringify(FAKE));
process.env.VARS_FILE = join(tmp, 'vars.json');
process.env.LOG_DIR = join(tmp, 'logs');
process.env.STATE_FILE = join(tmp, 'state', 'vars.json');
process.env.RUN_ID = 'test';

const { send, mask } = await import('../lib/net.mjs');
const tools = {};
const fakePi = { registerTool: (t) => (tools[t.name] = t) };
(await import('../extensions/http.mjs')).default(fakePi);
(await import('../extensions/code.mjs')).default(fakePi);

let server;
let base;
let hits = [];
before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/redirect-out') {
        res.writeHead(302, { location: 'https://evil.example/steal' });
        return res.end();
      }
      if (req.url.startsWith('/payouts?')) {
        // Sol P1: the key, sent in a query to the payout endpoint, bounced to the course API encoded char by char
        const enc = [...FAKE.PAYOUT_KEY].map((c, i) => `%${c.charCodeAt(0).toString(16)[i % 2 ? 'toUpperCase' : 'toLowerCase']()}`).join('');
        res.writeHead(302, { location: `/run?k=${enc}` });
        return res.end();
      }
      if (req.url === '/redirect-in') {
        res.writeHead(302, { location: '/manual' });
        return res.end();
      }
      if (req.url.startsWith('/attempt-manual')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ attempt: `att_FAKE_${req.url.split('=')[1]}_zzzz`, manual: 'Use Bearer <attempt> on /parked.' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ youSent: { method: req.method, url: req.url, auth: req.headers.authorization, ua: req.headers['user-agent'], body } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}`;
  // the secret scope (net.mjs scopeOf): the fake stands in for the course API; the payout key only to /payouts
  process.env.API_BASE = base;
  process.env.PAYOUTS_URL = `${base}/payouts`;
});
after(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  hits = [];
  process.env.ALLOWED_HOSTS = 'localhost';
  process.env.MANUAL_URL = `${base}/manual`;
  delete process.env.READ_ONLY;
});

const logText = () => readFileSync(join(process.env.LOG_DIR, 'requests.jsonl'), 'utf8');
const noSecret = (text, where) => {
  for (const v of Object.values(FAKE)) {
    assert.ok(!text.includes(v), `${where} holds a secret value`);
    assert.ok(!text.includes(encodeURIComponent(v)), `${where} holds a URL-encoded secret value`);
  }
};

test('an echoed secret comes back masked, to the model and in the log', async () => {
  // the payout key may go only to /payouts now (scopeOf), so the echo carries the ticket only
  const r = await tools.http.execute('1', { url: `${base}/echo?t={{TICKET}}`, headers: { Authorization: 'Bearer {{TICKET}}' } });
  const text = r.content[0].text;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].headers.authorization, `Bearer ${FAKE.TICKET}`, 'the real value is sent');
  assert.match(text, /\{\{TICKET\}\}/);
  noSecret(text, 'tool result');
  noSecret(logText(), 'requests.jsonl');
});

test('secret scope: char-by-char encoding, mixed hex case and a redirect hop never carry the key out (Sol P1/P2)', async () => {
  const { scopeRefusal } = await import('../lib/net.mjs');
  const cfg = { apiBase: base, payoutsUrl: `${base}/payouts` };
  const enc = [...FAKE.PAYOUT_KEY].map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).join('');
  assert.match(scopeRefusal(`${base}/run?k=${enc}`, `${base}/run?k=${enc}`, FAKE, cfg) ?? '', /PAYOUT_KEY/);
  assert.match(scopeRefusal(`${base}/payouts/collect`, `x ${FAKE.PAYOUT_KEY}`, FAKE, cfg) ?? '', /PAYOUT_KEY/, 'below /payouts is out');
  assert.equal(scopeRefusal(`${base}/payouts`, `x ${FAKE.PAYOUT_KEY}`, FAKE, cfg), null, 'the endpoint itself is in');
  assert.equal(scopeRefusal(`${base}/payouts/`, `x ${FAKE.PAYOUT_KEY}`, FAKE, cfg), null, 'a trailing slash is the same endpoint');
  // through send: the first hop is in scope, the redirect hop is refused and never reaches /run
  hits = [];
  const r = await send({ url: `${base}/payouts?k={{PAYOUT_KEY}}` });
  assert.match(r.refused ?? '', /secret \{\{PAYOUT_KEY\}\}/);
  assert.equal(hits.filter((h) => h.url.startsWith('/run')).length, 0, 'the redirect hop never left');
  noSecret(logText(), 'requests.jsonl');
  assert.equal(mask(`k=${enc}`, FAKE), 'k={{PAYOUT_KEY}}', 'masking sees the char-encoded value too');
});

test('mask covers raw and URL-encoded values', () => {
  const s = `a ${FAKE.PAYOUT_KEY} b ${encodeURIComponent(FAKE.PAYOUT_KEY)} c`;
  assert.equal(mask(s, FAKE), 'a {{PAYOUT_KEY}} b {{PAYOUT_KEY}} c');
});

test('a POST under READ_ONLY is refused and never sent', async () => {
  process.env.READ_ONLY = '1';
  const r = await send({ method: 'POST', url: `${base}/manual`, body: { x: 1 }, caller: 'script' });
  assert.ok(r.refused, 'refused');
  assert.equal(hits.length, 0, 'nothing reached the server');
  assert.match(logText(), /READ_ONLY/);
});

test('READ_ONLY allows GET to the manual URL only', async () => {
  process.env.READ_ONLY = '1';
  const ok = await send({ url: `${base}/manual` });
  assert.equal(ok.status, 200);
  const other = await send({ url: `${base}/tasks` });
  assert.ok(other.refused);
  assert.equal(hits.length, 1);
});

test('the manual reply is saved, masked, under logs/manual/', async () => {
  process.env.READ_ONLY = '1';
  await send({ url: `${base}/manual`, headers: { Authorization: 'Bearer {{TICKET}}' } });
  const dir = join(process.env.LOG_DIR, 'manual');
  const files = readdirSync(dir);
  assert.ok(files.length >= 1);
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  assert.match(text, /\{\{TICKET\}\}/);
  noSecret(text, 'saved manual');
});

test('a host outside the allowlist is refused and never sent', async () => {
  const r = await send({ url: `http://127.0.0.1:${server.address().port}/echo` });
  assert.match(r.refused, /ALLOWED_HOSTS/);
  assert.equal(hits.length, 0);
  process.env.ALLOWED_HOSTS = '';
  const r2 = await send({ url: `${base}/echo` });
  assert.ok(r2.refused, 'an empty allowlist refuses everything');
  assert.equal(hits.length, 0);
});

test('https is required outside localhost', async () => {
  process.env.ALLOWED_HOSTS = 'hq.mega.dev';
  const r = await send({ url: 'http://hq.mega.dev/challenges/twenty-payouts/api' });
  assert.match(r.refused, /https/);
});

test('a redirect to a host outside the allowlist is refused', async () => {
  const r = await send({ url: `${base}/redirect-out` });
  assert.match(r.refused, /ALLOWED_HOSTS/);
  assert.equal(hits.length, 1, 'only the first hop was sent');
});

test('under READ_ONLY a redirect may land only on the manual URL', async () => {
  process.env.READ_ONLY = '1';
  process.env.MANUAL_URL = `${base}/redirect-in`;
  const r = await send({ url: `${base}/redirect-in` });
  assert.ok(r.refused, 'the hop to /manual is not the manual URL');
  assert.equal(hits.length, 1);
});

test('the model http tool sends GET only, in every slice', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    const r = await tools.http.execute('1', { method, url: `${base}/echo`, body: { pay: 1 } });
    assert.match(r.content[0].text, /^refused, not sent/);
  }
  assert.equal(hits.length, 0);
});

test('a User-Agent is always sent', async () => {
  await send({ url: `${base}/echo` });
  assert.match(hits[0].headers['user-agent'], /payout-runner/);
});

test('code tool output is masked before the model sees it', async () => {
  const scripts = join(here, '..', 'scripts');
  const name = `_test-echo-${process.pid}.mjs`;
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, name), 'console.log("t=" + process.env.TICKET); console.error("k=" + process.env.PAYOUT_KEY); console.log("ro=" + (process.env.ALLOWED_HOSTS ?? ""));');
  const { ALLOWED } = await import('../extensions/code.mjs');
  ALLOWED.add(name);
  try {
    const r = await tools.code.execute('1', { file: name });
    const text = r.content[0].text;
    assert.match(text, /t=\{\{TICKET\}\}/);
    assert.match(text, /k=\{\{PAYOUT_KEY\}\}/);
    assert.match(text, /ro=localhost/, 'the request layer settings reach the script');
    noSecret(text, 'code result');
  } finally {
    rmSync(join(scripts, name), { force: true });
  }
});

test('the code tool runs only the day\'s scripts: open-practice.mjs (real host) is refused', async () => {
  const r = await tools.code.execute('1', { file: 'open-practice.mjs', args: ['--again'] });
  assert.match(r.content[0].text, /No such file in scripts\/: open-practice\.mjs/);
  assert.equal(r.details.failed, true);
});

test('a manual URL with a query is still the manual: closed by DENY_URLS and MANUAL_ONCE', async () => {
  const { refusal } = await import('../lib/net.mjs');
  const cfg = { allowedHosts: ['hq.mega.dev'], denyUrls: ['https://hq.mega.dev/m/manual'], writeUrls: [], manualUrl: 'https://hq.mega.dev/m/manual' };
  assert.match(refusal({ method: 'GET', url: 'https://hq.mega.dev/m/manual?x=1', caller: 'model' }, cfg), /DENY_URLS/);
  const once = { ...cfg, denyUrls: [], manualOnce: true, attemptOpenUntil: Date.now() + 60_000 };
  assert.match(refusal({ method: 'GET', url: 'https://hq.mega.dev/m/manual/?a=b', caller: 'model' }, once), /already fetched/);
});

test('a redirect after a write is not followed: the write is not sent twice', async () => {
  const { send: s } = await import('../lib/net.mjs');
  hits = [];
  const r = await s({ method: 'POST', url: `${base}/redirect-in`, body: { a: 1 } }, { cfg: { allowedHosts: ['localhost'], denyUrls: [], writeUrls: [`${base}/redirect-in`], logDir: join(tmp, 'logs'), runId: 'test' } });
  assert.equal(hits.length, 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /not followed/);
  assert.equal(r.refused, undefined, 'unclear, never "not sent"');
});

test('the attempt token from the manual is captured, masked, and usable as {{ATTEMPT}}', async () => {
  process.env.READ_ONLY = '1';
  process.env.MANUAL_URL = `${base}/attempt-manual?n=1`;
  const r1 = await tools.http.execute('1', { url: `${base}/attempt-manual?n=1` });
  assert.match(r1.content[0].text, /\{\{ATTEMPT\}\}/);
  assert.ok(!r1.content[0].text.includes('att_FAKE_1_zzzz'), 'tool result holds the attempt');
  process.env.MANUAL_URL = `${base}/attempt-manual?n=2`;
  await send({ url: `${base}/attempt-manual?n=2` });
  delete process.env.READ_ONLY;
  await send({ url: `${base}/echo`, headers: { Authorization: 'Bearer {{ATTEMPT}}' } });
  assert.equal(hits.at(-1).headers.authorization, 'Bearer att_FAKE_2_zzzz', 'the newest attempt is filled in');
  const log = logText();
  assert.ok(!log.includes('att_FAKE_1_zzzz') && !log.includes('att_FAKE_2_zzzz'), 'the log holds an attempt token');
  const state = JSON.parse(readFileSync(process.env.STATE_FILE, 'utf8'));
  assert.equal(state.ATTEMPT_PREV_1, 'att_FAKE_1_zzzz', 'the earlier attempt is kept for masking');
  const files = readdirSync(join(process.env.LOG_DIR, 'manual')).map((f) => readFileSync(join(process.env.LOG_DIR, 'manual', f), 'utf8')).join('');
  assert.ok(!files.includes('att_FAKE_'), 'a saved manual holds an attempt token');
});

test('a URL in DENY_URLS is refused even as a GET (a manual fetch opens a new attempt)', async () => {
  process.env.DENY_URLS = `${base}/manual`;
  const r = await tools.http.execute('1', { url: `${base}/manual` });
  delete process.env.DENY_URLS;
  assert.match(r.content[0].text, /^refused, not sent/);
  assert.equal(hits.length, 0);
});

test('a script write goes out only to a URL in WRITE_URLS', async () => {
  delete process.env.WRITE_URLS;
  const r = await send({ method: 'POST', url: `${base}/practice`, body: { a: 1 } });
  assert.match(r.refused, /WRITE_URLS/);
  assert.equal(hits.length, 0);
  process.env.WRITE_URLS = `${base}/practice`;
  const ok = await send({ method: 'POST', url: `${base}/practice`, body: { a: 1 } });
  assert.equal(ok.status, 200);
  const other = await send({ method: 'POST', url: `${base}/run`, body: { a: 1 } });
  assert.match(other.refused, /WRITE_URLS/);
  assert.equal(hits.length, 1);
  delete process.env.WRITE_URLS;
});

test('secrets a script names in a reply are saved and masked before the log', async () => {
  process.env.WRITE_URLS = `${base}/echo`;
  const r = await send(
    { method: 'POST', url: `${base}/echo`, body: { task: 'tsk_SECRET_abcdef' } },
    { capture: (raw) => ({ TASK_1: JSON.parse(raw).youSent.body.match(/tsk_[A-Z_a-z]+/)[0] }) },
  );
  delete process.env.WRITE_URLS;
  assert.ok(!r.body.includes('tsk_SECRET_abcdef'), 'reply holds the token');
  assert.ok(!logText().includes('tsk_SECRET_abcdef'), 'log holds the token');
  assert.match(r.body, /\{\{TASK_1\}\}/);
});
