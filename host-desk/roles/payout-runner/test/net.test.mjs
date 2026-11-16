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
      if (req.url === '/redirect-in') {
        res.writeHead(302, { location: '/manual' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ youSent: { method: req.method, url: req.url, auth: req.headers.authorization, ua: req.headers['user-agent'], body } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}`;
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
  const r = await tools.http.execute('1', { url: `${base}/echo?t={{TICKET}}`, headers: { Authorization: 'Bearer {{TICKET}}', 'X-Key': '{{PAYOUT_KEY}}' } });
  const text = r.content[0].text;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].headers.authorization, `Bearer ${FAKE.TICKET}`, 'the real value is sent');
  assert.match(text, /\{\{TICKET\}\}/);
  noSecret(text, 'tool result');
  noSecret(logText(), 'requests.jsonl');
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
