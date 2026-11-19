// lab/reviewer/run-lab: one reviewer lab run, every scenario of lab/reviewer/scenarios.mjs, each on its own mock
// (one attempt each). Leaves lab/out/reviewer-<stamp>-<agent>/ for ./verify --lab-reviewer.
//   node lab/reviewer/run-lab.mjs --agent dry-right | dry-wrong   (free, no model)
//   node lab/reviewer/run-lab.mjs --agent model                   (Pi + MODEL + the subscription token: ask first, 1 session per scenario)
// Options: --only <id,id>  --timeout-ms <ms per scenario> (default 20000 dry, 300000 model)
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock.mjs';
import { SCENARIOS } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const agent = arg('--agent', 'dry-right');
if (!['dry-right', 'dry-wrong', 'model'].includes(agent)) {
  console.error('--agent dry-right | dry-wrong | model');
  process.exit(2);
}
if (agent === 'model' && !process.env.MODEL) {
  console.error('--agent model needs MODEL (e.g. anthropic/claude-haiku-5-5) and ANTHROPIC_OAUTH_TOKEN. Ask before a model run.');
  process.exit(2);
}
const only = arg('--only', '')?.split(',').filter(Boolean);
const timeoutMs = Number(arg('--timeout-ms', agent === 'model' ? 300_000 : 20_000));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(ROOT, 'lab/out', `reviewer-${stamp}-${agent}`);
mkdirSync(out, { recursive: true });

// The repo files outside the lab's own output, to prove the reviewer changed nothing (R29).
const gitState = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)logs', ':(exclude)lab/out', ':(exclude)journal'], { cwd: ROOT, encoding: 'utf8' }).stdout;

const results = [];
for (const sc of SCENARIOS.filter((s) => !only?.length || only.includes(s.id))) {
  const dir = join(out, sc.id);
  mkdirSync(dir, { recursive: true });
  const mock = await startMock({ out, scenario: sc });
  writeFileSync(join(dir, 'expected.json'), JSON.stringify(sc.fixture.expected));
  writeFileSync(join(dir, 'hosts.json'), JSON.stringify({ ATTEMPT: [new URL(mock.base).host] }));
  const env = {
    ...process.env,
    LAB_URL: mock.base,
    LAB_OUT: dir,
    VARS_FILE: join(here, 'vars.lab.json'),
    HOSTS_FILE: join(dir, 'hosts.json'),
    LAB_EXPECTED: join(dir, 'expected.json'),
    DRY_MODE: agent === 'dry-wrong' ? 'wrong' : 'right',
  };
  const file = agent === 'model' ? join(ROOT, 'host-desk/roles/reviewer/run.mjs') : join(here, 'dry-agent.mjs');
  const before = gitState();
  const t0 = Date.now();
  const child = spawn(process.execPath, [file], { env, cwd: dirname(file), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(join(dir, 'agent.log'));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }, timeoutMs);
  const exit = await new Promise((r) => child.on('close', (code, signal) => r(code ?? signal)));
  clearTimeout(timer);
  await mock.close();
  const after = gitState();
  rmSync(join(here, 'WRONG-AGENT-WAS-HERE.tmp'), { force: true }); // the dry-wrong control's edit, removed once seen
  results.push({ id: sc.id, exit, timedOut, ms: Date.now() - t0, repoChanged: before !== after, changed: before !== after ? after : '' });
  console.log(`${sc.id}: exit ${exit}${timedOut ? ' (timed out, killed)' : ''} · ${Date.now() - t0} ms${before !== after ? ' · REPO CHANGED' : ''}`);
}
writeFileSync(join(out, 'done.json'), JSON.stringify({ agent, model: process.env.MODEL ?? null, stamp, results }, null, 2));
console.log(`lab run ${out.slice(ROOT.length + 1)} — check it with ./verify --lab-reviewer`);
