// The reviewer's code rules (plan.md § 2): the http guard against the lab mock, and extensions/house.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const { startMock, LAB_VARS } = await import(join(ROOT, 'lab/reviewer/mock.mjs'));
const { SCENARIOS } = await import(join(ROOT, 'lab/reviewer/scenarios.mjs'));
const { guardedRequest, resetSession, route } = await import('../extensions/http.mjs');
const { fixedVerdicts, houseFacts, validFindings } = await import('../extensions/house.mjs');

const sc = (id, over = {}) => ({ ...SCENARIOS.find((s) => s.id === id), ...over });
let mock;
let dir;
const auth = { authorization: 'Bearer {{ATTEMPT}}' };
const text = (r) => r.content[0].text;
const get = (path) => guardedRequest({ url: `${mock.base}${path}`, headers: auth });
const post = (findings) => guardedRequest({ method: 'POST', url: `${mock.base}/review`, headers: auth, body: { findings } });
const truth = () => readFileSync(mock.truthFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reviews = () => truth().filter((e) => e.type === 'review');
const right = (fx) => fx.patch.hunks.map((h) => ({ hunk: h.id, verdict: fx.expected[h.id], reason: 'test' }));

async function useMock(scenario) {
  if (mock) await mock.close();
  dir = mkdtempSync(join(tmpdir(), 'reviewer-guard-'));
  mock = await startMock({ out: dir, scenario });
  writeFileSync(join(dir, 'hosts.json'), JSON.stringify({ ATTEMPT: [new URL(mock.base).host] }));
  Object.assign(process.env, { LAB_URL: mock.base, LAB_OUT: dir, VARS_FILE: join(ROOT, 'lab/reviewer/vars.lab.json'), HOSTS_FILE: join(dir, 'hosts.json') });
  resetSession();
}
before(() => useMock(sc('attempt1')));
beforeEach(() => resetSession());
after(async () => {
  await mock?.close();
  for (const k of ['LAB_URL', 'LAB_OUT', 'VARS_FILE', 'HOSTS_FILE']) delete process.env[k];
});

test('only the three routes on the Challenge base', async () => {
  assert.match(route('GET', `${process.env.LAB_URL}/settings`).path, /settings/);
  assert.ok(route('POST', `${process.env.LAB_URL}/practice`).error);
  assert.ok(route('DELETE', `${process.env.LAB_URL}/review`).error);
  assert.ok(route('GET', 'https://evil.example/patch').error);
  const r = await guardedRequest({ method: 'POST', url: `${mock.base}/practice`, headers: auth, body: {} });
  assert.match(text(r), /not sent/);
  assert.equal(truth().filter((e) => e.path === '/practice').length, 0);
});

test('POST /review before the settings and patch reads is not sent', async () => {
  await useMock(sc('attempt1'));
  const r = await post(right(sc('attempt1').fixture));
  assert.match(text(r), /read GET \/settings and GET \/patch/);
  await get('/patch');
  assert.match(text(await post(right(sc('attempt1').fixture))), /read GET \/settings/);
  assert.equal(reviews().length, 0);
});

test('a review missing a hunk, repeating one, or without a reason is not sent', async () => {
  await useMock(sc('attempt1'));
  await get('/settings');
  await get('/patch');
  const ok = right(sc('attempt1').fixture);
  assert.match(text(await post(ok.slice(1))), /missing h-9a8/);
  assert.match(text(await post([...ok, ok[0]])), /repeated/);
  assert.match(text(await post(ok.map((f) => ({ ...f, reason: ' ' })))), /a reason/);
  assert.match(text(await post(ok.map((f) => ({ ...f, verdict: 'maybe' })))), /"flag" or "pass"/);
  assert.equal(reviews().length, 0);
});

test('a review against the fixed commission verdict is not sent', async () => {
  await useMock(sc('attempt1'));
  await get('/settings');
  await get('/patch');
  const r = await post(right(sc('attempt1').fixture).map((f) => (f.hunk === 'h-9a8' ? { ...f, verdict: 'pass' } : f)));
  assert.match(text(r), /h-9a8 must be "flag".*18/);
  assert.equal(reviews().length, 0);
});

test('one review per attempt: the second is never sent, even in a new session', async () => {
  await useMock(sc('attempt1'));
  await get('/settings');
  await get('/patch');
  assert.match(text(await post(right(sc('attempt1').fixture))), /^200 /);
  assert.match(text(await post(right(sc('attempt1').fixture))), /already sent/);
  resetSession();
  await get('/settings');
  await get('/patch');
  assert.match(text(await post(right(sc('attempt1').fixture))), /already sent/);
  assert.equal(reviews().length, 1);
});

test('a redirect is never followed and the attempt never reaches the other host', async () => {
  await useMock(sc('patch-redirect'));
  await get('/settings');
  const r = await get('/patch');
  assert.match(text(r), /^307 .*not followed/s);
  assert.equal(truth().filter((e) => e.server === 'other').length, 0);
});

test('a secret the role may not send is refused; replies are masked', async () => {
  await useMock(sc('echo-secret'));
  const t = await guardedRequest({ url: `${mock.base}/settings`, headers: { authorization: 'Bearer {{TICKET}}' } });
  assert.match(text(t), /\{\{TICKET\}\} may not reach/);
  await get('/settings');
  const r = await get('/patch');
  assert.ok(!text(r).includes(LAB_VARS.ATTEMPT));
  assert.match(text(r), /Your attempt is \{\{ATTEMPT\}\}/);
});

test('a server that never answers ends the request with an error, not a hang', { timeout: 30_000 }, async () => {
  await useMock(sc('patch-hang'));
  await get('/settings');
  const r = await get('/patch');
  assert.match(text(r), /no answer in/);
});

test('the patch reply carries the house check: fixed verdict and facts', async () => {
  await useMock(sc('traps-a'));
  await get('/settings');
  const r = text(await get('/patch'));
  assert.match(r, /House check/);
  assert.match(r, /ta-7c: adds Math\.round/);
  assert.match(r, /ta-e2: returns check-in/);
  assert.match(r, /ta-1f: stops calling hostPayout/);
  assert.doesNotMatch(r, /ta-31: FIXED VERDICT/); // 20 → 22 matches the live 22: no fixed verdict
});

test('house.mjs: the fixed verdicts of the five fixtures', () => {
  const fx = (id) => sc(id).fixture;
  assert.deepEqual(Object.keys(fixedVerdicts(fx('attempt1').patch, fx('attempt1').settings)), ['h-9a8']);
  assert.deepEqual(Object.keys(fixedVerdicts(fx('attempt2').patch, fx('attempt2').settings)), ['h-fe0']);
  assert.deepEqual(Object.keys(fixedVerdicts(fx('traps-a').patch, fx('traps-a').settings)), []);
  assert.deepEqual(Object.keys(fixedVerdicts(fx('traps-b').patch, fx('traps-b').settings)), ['tb-02']);
  assert.deepEqual(fixedVerdicts(fx('attempt1').patch, {}), {});
  for (const id of ['attempt1', 'attempt2', 'traps-a', 'traps-b']) {
    for (const [h, v] of Object.entries(fixedVerdicts(fx(id).patch, fx(id).settings))) assert.equal(v.verdict, fx(id).expected[h], `${id} ${h}`);
  }
});

test('house.mjs: facts never land on a hunk that should pass', () => {
  for (const id of ['attempt1', 'attempt2', 'traps-a', 'traps-b']) {
    const { patch, expected } = sc(id).fixture;
    for (const h of Object.keys(houseFacts(patch))) assert.equal(expected[h], 'flag', `${id} ${h} has a fact but expects pass`);
  }
  assert.ok(houseFacts(sc('attempt1').fixture.patch)['h-533']);
});

test('house.mjs: validFindings', () => {
  const hunks = [{ id: 'a' }, { id: 'b' }];
  assert.equal(validFindings({ findings: [{ hunk: 'a', verdict: 'flag', reason: 'x' }, { hunk: 'b', verdict: 'pass', reason: 'y' }] }, hunks), null);
  assert.match(validFindings({ findings: [{ hunk: 'a', verdict: 'flag', reason: 'x' }] }, hunks), /missing b/);
  assert.match(validFindings({}, hunks), /no findings/);
  assert.match(validFindings({ findings: [] }, [{ id: undefined }]), /no usable hunk ids/);
  rmSync(dir, { recursive: true, force: true });
});

test('without LAB_URL the role reads only the real files and the course URL', async () => {
  const saved = { ...process.env };
  delete process.env.LAB_URL;
  process.env.VARS_FILE = join(ROOT, 'lab/reviewer/vars.lab.json');
  process.env.HOSTS_FILE = '/nonexistent/hosts.json';
  try {
    const { loadVars } = await import('../extensions/vars.mjs');
    const { loadHosts } = await import('../extensions/hosts.mjs');
    const { courseBase } = await import('../extensions/http.mjs');
    assert.notEqual(loadVars().ATTEMPT, LAB_VARS.ATTEMPT);
    assert.deepEqual(loadHosts(), { ATTEMPT: ['hq.mega.dev'] });
    assert.equal(courseBase(), 'https://hq.mega.dev/challenges/looks-good-to-me');
    const real = readFileSync(join(ROOT, 'host-desk/roles/reviewer/hosts.json'), 'utf8');
    assert.equal(JSON.stringify(JSON.parse(real)), JSON.stringify({ ATTEMPT: ['hq.mega.dev'] }));
  } finally {
    Object.assign(process.env, saved);
  }
});

test('settings and patch read at the same time both count (lab run 1 bug)', async () => {
  await useMock(sc('traps-a'));
  await Promise.all([get('/settings'), get('/patch')]);
  const r = await post(right(sc('traps-a').fixture));
  assert.match(text(r), /^200 /);
  assert.equal(reviews().length, 1);
});
