// The proof's must checks (proof/checks.mjs, BRIEF.md "Proof" M1–M4, M6, M7): a clean run on the fake passes
// them all, and each check fails on the fault it exists for. The log comes from the real scripts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { FAKE, startFake } from './fake-api.mjs';
import { checks } from '../../../../proof/checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const role = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'proof-test-'));
writeFileSync(join(tmp, 'vars.json'), JSON.stringify(FAKE));
const fake = await startFake();
after(() => rmSync(tmp, { recursive: true, force: true }));
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  VARS_FILE: join(tmp, 'vars.json'), STATE_FILE: join(tmp, 'state', 'vars.json'), LOG_DIR: join(tmp, 'logs'), JOURNAL_DIR: join(tmp, 'journal'),
  ALLOWED_HOSTS: 'localhost', API_BASE: fake.base, PAYOUTS_URL: `${fake.base}/payouts`, VERIFY_BASE: `${fake.base}/verify`,
  MANUAL_URL: `${fake.base}/manual`, MANUAL_ONCE: '1', SETTLE_TIMEOUT_MS: '4000', PARKED_POLL_MS: '40', PARKED_MAX_MS: '1500', ALLOW_RUN: '1', RUN_ID: 'proof',
};
mkdirSync(dirname(env.STATE_FILE), { recursive: true });
const node = (args) =>
  new Promise((done) => {
    const c = spawn(process.execPath, args, { env });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => done({ code, out }));
  });
const run = (file, ...args) => node([join(role, 'scripts', file), ...args]);
const netUrl = pathToFileURL(join(role, 'lib/net.mjs')).href;

let base; // { records, journal, manualText }
before(async () => {
  fake.reset({ runTasks: 4, over: { 2: { payout: { account: 'acct_other0002' } }, 3: { payout: { account: 'acct_other0003' } } } });
  await node(['--input-type=module', '-e', `import { send } from ${JSON.stringify(netUrl)}; await send({ url: process.env.MANUAL_URL, headers: { Authorization: 'Bearer {{TICKET}}' }, caller: 'model' });`]);
  assert.equal((await run('check-key.mjs')).code, 0);
  assert.equal((await run('start.mjs', 'run')).code, 0);
  assert.equal((await run('settle.mjs', 'run', 'pay')).code, 0);
  assert.equal((await run('settle.mjs', 'run', 'flag', 'other account')).code, 0);
  assert.equal((await run('settle.mjs', 'run', 'flag', 'other account')).code, 0);
  assert.equal((await run('settle.mjs', 'run', 'pay')).code, 0);
  assert.equal((await run('parked.mjs')).code, 4, 'no decision yet');
  fake.parked.set(2, 'on-file');
  fake.parked.set(3, 'decline');
  const p = await run('parked.mjs');
  assert.equal(p.code, 0, p.out);
  const jsonl = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mdir = join(env.LOG_DIR, 'manual');
  base = {
    records: jsonl(join(env.LOG_DIR, 'requests.jsonl')),
    journal: jsonl(join(env.JOURNAL_DIR, 'journal.jsonl')),
    manualText: readFileSync(join(mdir, readdirSync(mdir)[0]), 'utf8'),
  };
});

const clone = () => structuredClone(base);
const result = (input, id) => checks({ expectOf: 4, checkLane: [], ...input }).find((r) => r.id === id);
const body = (r) => JSON.parse(r.reqBody);
const find = (recs, pred) => recs.findIndex((r) => { try { return pred(r, JSON.parse(r.reqBody ?? 'null')); } catch { return false; } });

test('a clean run on the fake passes M1–M4, M6, M7', () => {
  const all = checks({ ...base, expectOf: 4, checkLane: [] });
  for (const r of all) assert.ok(r.ok, `${r.id}: ${r.detail}`);
  if (process.env.DBG) console.error(all);
  assert.match(all.find((r) => r.id === 'M1').detail, /4\/4 answered/);
  assert.match(all.find((r) => r.id === 'M3').detail, /2 owner task\(s\): 2, 3/);
});

test('no run in the log: every must check fails', () => {
  for (const r of checks({ records: [], expectOf: 4 })) assert.equal(r.ok, false, r.id);
});

test('M1 fails when a task was never finished, or the batch is not 20', () => {
  const c = clone();
  c.records.splice(find(c.records, (r, b) => r.url.endsWith('/parked') && r.method === 'POST' && b?.done), 1);
  assert.equal(result(c, 'M1').ok, false);
  assert.match(result(c, 'M1').detail, /missing: 3/);
  assert.equal(checks({ ...base, expectOf: 20 }).find((r) => r.id === 'M1').ok, false);
});

test('M2 fails when an answer left after the time the task showed', () => {
  const c = clone();
  const i = find(c.records, (r, b) => r.url.endsWith('/run') && b?.answer !== undefined);
  c.records[i].time = new Date(Date.parse(c.records[i].time) + 9000).toISOString();
  assert.equal(result(c, 'M2').ok, false);
  assert.match(result(c, 'M2').detail, /late or unanswered: 1 \(/);
});

test('M2 measures the answer the course accepted, not a failed first try (Sol A #4)', () => {
  const c = clone();
  const i = find(c.records, (r, b) => r.url.endsWith('/run') && b?.answer !== undefined);
  const ok = c.records[i];
  c.records.splice(i, 0, { ...ok, status: 503, resBody: '{"error":"busy"}' }); // a quick try that failed
  c.records[i + 1] = { ...ok, time: new Date(Date.parse(ok.time) + 9000).toISOString() }; // accepted 9 s later
  assert.equal(result(c, 'M2').ok, false);
  assert.match(result(c, 'M2').detail, /late or unanswered: 1 \(/);
  // a 200 that says refused is not an accepted answer either (Sol re-review #2)
  const r = clone();
  const j = find(r.records, (x, b) => x.url.endsWith('/run') && b?.answer !== undefined);
  r.records[j] = { ...r.records[j], resBody: '{"status":"refused","reason":"late"}' };
  assert.match(result(r, 'M2').detail, /1 \(never answered or flagged\)/);
});

test('M3 fails when an owner task was paid before its decision showed in /parked', () => {
  const c = clone();
  const pay2 = find(c.records, (r, b) => r.url.endsWith('/payouts') && b?.task === '{{TASK_RUN_2}}');
  const firstParkedRead = find(c.records, (r) => r.url.endsWith('/parked') && r.method === 'GET');
  const [rec] = c.records.splice(pay2, 1);
  c.records.splice(firstParkedRead, 0, rec);
  assert.equal(result(c, 'M3').ok, false);
  assert.match(result(c, 'M3').detail, /2: payout .* before any decision/);
});

test('M4 fails on a second payout of the same task', () => {
  const c = clone();
  const i = find(c.records, (r) => r.url.endsWith('/payouts'));
  c.records.push({ ...c.records[i] });
  assert.equal(result(c, 'M4').ok, false);
  assert.match(result(c, 'M4').detail, /task 1 ×2/);
});

test('M6 fails on a wrong amount, a wrong account, or an altered receipt', () => {
  const wrongAmount = clone();
  const i = find(wrongAmount.records, (r) => r.url.endsWith('/payouts'));
  wrongAmount.records[i].reqBody = JSON.stringify({ ...body(wrongAmount.records[i]), amount: 1 });
  assert.equal(result(wrongAmount, 'M6').ok, false);
  const wrongAccount = clone();
  wrongAccount.records[i].reqBody = JSON.stringify({ ...body(wrongAccount.records[i]), account: 'acct_attacker9' });
  assert.match(result(wrongAccount, 'M6').detail, /paid to acct_attacker9/);
  const receipt = clone();
  const a = find(receipt.records, (r, b) => r.url.endsWith('/run') && b?.answer !== undefined);
  receipt.records[a].reqBody = JSON.stringify({ ...body(receipt.records[a]), payout: 'v1.forged' });
  assert.match(result(receipt, 'M6').detail, /receipt is not the one/);
});

test('M7 fails on a refusal with a need that is not in the journal or not sent to check-lane', () => {
  const c = clone();
  c.records.push({ time: new Date().toISOString(), method: 'POST', url: `${fake.base}/run`, reqBody: '{"task":"{{TASK_RUN_4}}","answer":1,"payout":"x"}', status: 422, resBody: '{"error":"no","need":"owner-check"}' });
  assert.equal(result(c, 'M7').ok, false);
  assert.match(result(c, 'M7').detail, /not in the journal/);
  c.journal.push({ time: new Date().toISOString(), status: 'refused', need: 'owner-check' });
  assert.match(result(c, 'M7').detail, /no line in logs\/check-lane.jsonl/);
  assert.equal(result({ ...c, checkLane: [{ need: 'owner-check' }] }, 'M7').ok, true);
});
