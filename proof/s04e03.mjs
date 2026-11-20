// S04E03 proof (BRIEF.md "Proof"): the team checks T1–T6 on the board, S1 (no secret on the board or in the Host Desk
// history), S3 (checklist rules 1–5). The board comes from GET /board with the attempt of the Host Desk's vars.json, or
// from a saved file (--board <file>). A live read is saved to logs/s04e03/board-<time>.json as evidence.
// It never reads an agent's report; it reads vars.json only to search for leaked values, and never prints a value.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST_DESK = process.env.HOST_DESK || resolve(process.env.HOME, 'Projects/zapponi/host-desk');
const COURSE = 'https://hq.mega.dev/challenges/three-small-changes';
const ms = (t) => (t ? Date.parse(t) : NaN);

function secrets() {
  try {
    return Object.entries(JSON.parse(readFileSync(join(HOST_DESK, 'vars.json'), 'utf8'))).filter(([, v]) => typeof v === 'string' && v.length >= 8);
  } catch {
    return [];
  }
}

async function board(argv) {
  const i = argv.indexOf('--board');
  if (i > 0) return { b: JSON.parse(readFileSync(resolve(argv[i + 1]), 'utf8')), from: argv[i + 1] };
  const attempt = secrets().find(([k]) => k === 'ATTEMPT')?.[1];
  if (!attempt) throw new Error('no ATTEMPT in the Host Desk vars.json');
  const r = await fetch(`${COURSE}/board`, { headers: { authorization: `Bearer ${attempt}`, 'user-agent': 'host-desk-verify/1' }, redirect: 'manual' });
  if (!r.ok) throw new Error(`GET /board answered ${r.status}`);
  const text = await r.text();
  const dir = join(ROOT, 'logs/s04e03');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `board-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  let masked = text;
  for (const [k, v] of secrets()) masked = masked.split(v).join(`{{${k}}}`);
  writeFileSync(f, masked);
  return { b: JSON.parse(text), from: f, raw: text };
}

export async function run(argv) {
  const results = [];
  const check = (id, ok, detail) => results.push({ id, ok, detail });
  let b, from, raw;
  try {
    ({ b, from, raw } = await board(argv));
  } catch (e) {
    console.log(`FAIL board: ${e.message}`);
    return 1;
  }
  const jobs = b.plan?.jobs ?? [];
  const results_ = b.results ?? [];
  const state = new Map((b.jobs ?? []).map((j) => [j.id, j]));
  // T1: plan shape (api-index "plan")
  const merges = jobs.filter((j) => j.request === 'merge');
  check('T1', !!b.plan && jobs.length >= 1 && jobs.length <= 12 && ['r1', 'r2', 'r3'].every((r) => jobs.some((j) => j.request === r)) && merges.length === 1, `plan ${b.plan ? `at ${b.plan.at}` : 'missing'}: ${jobs.length} jobs, merge jobs ${merges.length}, requests served ${['r1', 'r2', 'r3'].filter((r) => jobs.some((j) => j.request === r)).join(',') || 'none'}`);
  // T2: plan before every claim and result
  const planAt = ms(b.plan?.at);
  const later = [...[...state.values()].map((s) => [s.id, ms(s.claimedAt)]), ...results_.map((r) => [r.job, ms(r.at)])].filter(([, t]) => Number.isFinite(t));
  const early = later.filter(([, t]) => !(t > planAt));
  check('T2', !!b.plan && early.length === 0, early.length ? `older than the plan: ${early.map(([id]) => id).join(', ')}` : `${later.length} claims/results, all after the plan`);
  // T3: no file in two jobs
  const files = jobs.flatMap((j) => j.files ?? []);
  check('T3', new Set(files).size === files.length, `${files.length} paths, ${new Set(files).size} distinct`);
  // T4: each result's paths inside its job's files
  const outside = results_.flatMap((r) => {
    const j = jobs.find((x) => x.id === r.job);
    return (r.paths ?? []).filter((p) => !(j?.files ?? []).includes(p)).map((p) => `${r.job}:${p}`);
  });
  check('T4', results_.length > 0 && outside.length === 0, outside.length ? `outside the plan: ${outside.join(', ')}` : `${results_.length} results, every path inside its plan`);
  // T5: every job posted; the merge job last
  const missing = jobs.filter((j) => !results_.some((r) => r.job === j.id)).map((j) => j.id);
  const last = [...results_].sort((a, c) => ms(a.at) - ms(c.at)).at(-1);
  check('T5', jobs.length > 0 && !missing.length && last?.job === merges[0]?.id, missing.length ? `no result from ${missing.join(', ')}` : `all ${jobs.length} posted; last: ${last?.job}`);
  // T6: ranOn = the job's model
  const wrong = results_.filter((r) => { const j = jobs.find((x) => x.id === r.job); return j && r.ranOn && !String(r.ranOn).endsWith(String(j.model).split('/').pop()); }).map((r) => `${r.job} ran ${r.ranOn}`);
  check('T6', results_.length > 0 && !wrong.length, wrong.length ? wrong.join('; ') : 'every ranOn matches its job model');
  // S1: no secret value on the board or in the Host Desk history (all branches) or the evidence file
  let leaks = [];
  const hist = (() => { try { return execFileSync('git', ['-C', HOST_DESK, 'log', '--all', '-p'], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return ''; } })();
  for (const [k, v] of secrets()) {
    if ((raw ?? JSON.stringify(b)).includes(v)) leaks.push(`${k} on the board`);
    if (hist.includes(v)) leaks.push(`${k} in the Host Desk git history`);
  }
  check('S1', leaks.length === 0, leaks.length ? leaks.join('; ') : `no vars value on the board or in the Host Desk history (${secrets().length} values searched)`);
  // S3: checklist rules 1–5
  const cl = existsSync(join(HOST_DESK, 'factory/CHECKLIST.md')) ? readFileSync(join(HOST_DESK, 'factory/CHECKLIST.md'), 'utf8') : '';
  const rules = [1, 2, 3, 4, 5].filter((n) => new RegExp(`^${n}\\. `, 'm').test(cl));
  check('S3', rules.length === 5, `factory/CHECKLIST.md rules present: ${rules.join(',') || 'none'}`);

  console.log(`S04E03 proof · board from ${from}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.detail}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} FAIL` : 'all PASS (the batch checks B1–B6 run with ./verify on the batch logs)');
  return bad ? 1 : 0;
}
