// lab/run-lab: one lab run (plan.md § 4, lab/EXPECTED.md). Starts the mock, starts the agent against it, kills the
// agent after task 7's answer and starts it again at once, waits for the end, and leaves everything under
// lab/out/<stamp>/ for ./verify --lab.
//   node lab/run-lab.mjs --agent model   (paid: run.mjs MODE=lab with MODEL, e.g. openrouter/anthropic/claude-haiku-5.5)
//   node lab/run-lab.mjs --agent dry     (free: lab/dry-agent.mjs, no model)
// Options: --decide-ms <ms> (default 300000: the owner decides 5 min after a flag), --kill-after <n> (default 7, 0 = no
// kill), --timeout-ms <ms> (default 1500000).
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const agent = arg('--agent', 'dry');
const decideMs = Number(arg('--decide-ms', 300_000));
const killAfter = Number(arg('--kill-after', 7));
const timeoutMs = Number(arg('--timeout-ms', 1_500_000));
if (!['dry', 'model'].includes(agent)) {
  console.error('--agent dry | model');
  process.exit(2);
}
if (agent === 'model' && !process.env.MODEL) {
  console.error('--agent model needs MODEL (e.g. openrouter/anthropic/claude-haiku-5.5). Every model run is paid: announce it first.');
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = arg('--out', join(here, 'out', `${stamp}-${agent}`));
mkdirSync(join(out, 'agent'), { recursive: true });
const mock = await startMock({ out, decideMs });
console.log(`lab run ${out}\nmock ${mock.base} · agent ${agent} · owner decides ${decideMs / 1000} s after a flag · kill after task ${killAfter || 'none'}`);

const t0 = Date.now();
function startAgent(k) {
  const file = agent === 'model' ? join(here, '../host-desk/roles/payout-runner/run.mjs') : join(here, 'dry-agent.mjs');
  const env = { ...process.env, MODE: 'lab', LAB_URL: mock.base, LAB_OUT: out, RUN_ID: `lab-${stamp}-s${k}` };
  const child = spawn(process.execPath, [file], { env, cwd: dirname(file), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(join(out, 'agent', `session-${k}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.done = new Promise((r) => child.on('close', (code, signal) => r({ code, signal })));
  console.log(`session ${k} started (pid ${child.pid})`);
  return child;
}
const truth = () => (existsSync(mock.truthFile) ? readFileSync(mock.truthFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const killGroup = (c) => {
  try {
    process.kill(-c.pid, 'SIGKILL');
  } catch {}
};

const sessions = [];
let child = startAgent(1);
sessions.push(child);
let killed = false;
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  killGroup(child);
}, timeoutMs);
if (killAfter) {
  const watch = setInterval(() => {
    if (truth().some((e) => e.ev === 'answer' && e.batch === 'run' && e.n === killAfter)) {
      clearInterval(watch);
      killed = true;
      killGroup(child);
      writeFileSync(join(out, 'kill.json'), JSON.stringify({ afterN: killAfter, at: new Date().toISOString() }));
      console.log(`killed session 1 after task ${killAfter}'s answer`);
    }
  }, 50);
  child.done.then(() => clearInterval(watch));
}
const first = await child.done;
if (killed && !timedOut) {
  child = startAgent(2);
  sessions.push(child);
  await child.done;
}
clearTimeout(timer);
const ends = await Promise.all(sessions.map((s) => s.done));
writeFileSync(join(out, 'done.json'), JSON.stringify({ agent, model: process.env.MODEL ?? null, decideMs, killAfter, killed, timedOut, sessions: ends, first, seconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
await mock.close();
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s; sessions ${JSON.stringify(ends)}${timedOut ? ' (TIMED OUT)' : ''}\nnext: ./verify --lab ${out.slice(join(here, '..').length + 1)}`);
