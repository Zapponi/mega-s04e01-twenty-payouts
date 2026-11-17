// Starts the payout-runner once: Pi in print mode with the three tools from extensions/ and no others, ROLE.md as
// the system prompt. Model: MODEL (e.g. openrouter/<model id>), else Pi's default. stdin is closed, because `pi -p`
// waits for stdin when it is an open pipe.
//
// Request layer (plan.md § 0): run.mjs sets the run id, the host allowlist and the manual URL for the tools, and
// tees pi's output, masked, into logs/run-<run id>.log.
// READ_ONLY=1 (slice 1): ROLE.slice1.md as the system prompt; the request layer allows only GET to the manual URL.
// MODE=practice: ROLE.practice.md; hosts hq.mega.dev + pay-s04.mega.dev; the model's http may not GET /manual (a
// fetch opens a new attempt); writes happen only in scripts/start.mjs and scripts/settle.mjs, each with its own URLs.
// MODE=run with ALLOW_RUN=1: ROLE.md, the real batch; also verify-s04.mega.dev for the key check; the manual may be
// fetched only while no attempt is open (MANUAL_ONCE=1). Anything else refuses to start.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attemptOpenUntil, config, mask, saveState } from './lib/net.mjs';
import { state } from './lib/flow.mjs';
import { STATE_FILE } from './extensions/vars.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL = 'https://hq.mega.dev/challenges/twenty-payouts/manual';
// Only the lab points the scripts elsewhere; a stray value in the shell never redirects a real run.
if (process.env.MODE !== 'lab') for (const k of ['API_BASE', 'PAYOUTS_URL', 'VERIFY_BASE', 'VARS_FILE', 'STATE_FILE', 'JOURNAL_DIR']) delete process.env[k];
let role;
if (process.env.READ_ONLY === '1') {
  role = 'ROLE.slice1.md';
  process.env.ALLOWED_HOSTS ||= 'hq.mega.dev';
  process.env.MANUAL_URL ||= 'https://hq.mega.dev/challenges/twenty-payouts/api';
} else if (process.env.MODE === 'practice') {
  role = 'ROLE.practice.md';
  process.env.ALLOWED_HOSTS = 'hq.mega.dev,pay-s04.mega.dev';
  process.env.MANUAL_URL = MANUAL;
  process.env.DENY_URLS = MANUAL;
  delete process.env.ALLOW_RUN;
  delete process.env.WRITE_URLS;
} else if (process.env.MODE === 'run') {
  // The real batch (plan.md § 6): only with ALLOW_RUN=1, the human's yes for this run. The model's http may fetch
  // the manual, but only while no attempt is open (MANUAL_ONCE), so a restart never deals a new batch.
  if (process.env.ALLOW_RUN !== '1') {
    console.error('MODE=run needs ALLOW_RUN=1: the human\'s yes for this run (BRIEF.md "Outside actions approved"). Nothing was started.');
    process.exit(2);
  }
  // NEW_ATTEMPT=1, the human's yes to close the open attempt (its run is over: the API, "each fetch starts a new
  // run"), so the agent fetches the manual once instead of waiting for the attempt to expire (Giovanni 2026-11-17).
  if (process.env.NEW_ATTEMPT === '1') {
    const st = state();
    if (attemptOpenUntil(st) > Date.now()) {
      saveState({ ATTEMPT_CLOSED_AT: st.ATTEMPT_SEEN_AT });
      console.log(`[run] NEW_ATTEMPT=1: the attempt fetched ${st.ATTEMPT_SEEN_AT} is closed by the human; the agent fetches the manual once.`);
    } else console.log('[run] NEW_ATTEMPT=1: no attempt is open; nothing to close.');
  }
  role = 'ROLE.md';
  process.env.ALLOWED_HOSTS = 'hq.mega.dev,pay-s04.mega.dev,verify-s04.mega.dev';
  process.env.MANUAL_URL = MANUAL;
  process.env.MANUAL_ONCE = '1';
  delete process.env.DENY_URLS;
  delete process.env.WRITE_URLS;
} else if (process.env.MODE === 'lab') {
  // The lab (plan.md § 4): ROLE.md with the course URLs pointed at the local mock (LAB_URL); localhost only; the
  // lab's fake vars and its own state, logs and journal under LAB_OUT, so nothing real is read or touched.
  const lab = process.env.LAB_URL;
  const out = process.env.LAB_OUT;
  if (!lab || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(lab) || !out) {
    console.error('MODE=lab needs LAB_URL=http://localhost:<port> and LAB_OUT=<dir> (lab/run-lab.mjs sets both).');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  role = join(out, 'ROLE.md');
  writeFileSync(role, readFileSync(join(here, 'ROLE.md'), 'utf8').split('https://hq.mega.dev/challenges/twenty-payouts').join(lab));
  Object.assign(process.env, {
    ALLOWED_HOSTS: 'localhost', API_BASE: lab, PAYOUTS_URL: `${lab}/payouts`, VERIFY_BASE: `${lab}/verify`, MANUAL_URL: `${lab}/manual`, MANUAL_ONCE: '1', ALLOW_RUN: '1',
    VARS_FILE: join(here, '../../../lab/vars.lab.json'), STATE_FILE: join(out, 'state', 'vars.json'), LOG_DIR: join(out, 'logs'), JOURNAL_DIR: join(out, 'journal'),
  });
  delete process.env.DENY_URLS;
  delete process.env.WRITE_URLS;
} else {
  console.error('Run with READ_ONLY=1 (slice 1), MODE=practice, or MODE=run with ALLOW_RUN=1 (the real batch).');
  process.exit(2);
}
process.env.RUN_ID ||= new Date().toISOString().replace(/[:.]/g, '-');
const args = [
  '-p',
  '--no-session',
  '--no-builtin-tools',
  '--no-extensions',
  '--no-context-files',
  '--no-skills',
  '--no-prompt-templates',
  '--no-mcp',
  '-e', 'extensions/vars.mjs',
  '-e', 'extensions/http.mjs',
  '-e', 'extensions/code.mjs',
  '--system-prompt', role,
  ...(process.env.MODEL ? ['--model', process.env.MODEL] : []),
  'Start.',
];

// On Windows `pi` is a .cmd launcher, which Node starts only through a shell. No argument above has a space;
// MODEL is the one that comes from outside, so on Windows it holds a plain model id only (security review 2026-11-16 #9).
if (process.platform === 'win32' && process.env.MODEL && !/^[\w./:@-]+$/.test(process.env.MODEL)) {
  console.error('MODEL may hold letters, digits and . / : @ - _ only.');
  process.exit(1);
}
// Masked tee, line by line, so a value split across two chunks is still masked.
const cfg = config();
mkdirSync(cfg.logDir, { recursive: true });
const runLog = createWriteStream(join(cfg.logDir, `run-${cfg.runId}.log`), { flags: 'a' });
runLog.write(`# run ${cfg.runId} · model ${process.env.MODEL ?? '(pi default)'} · READ_ONLY=${process.env.READ_ONLY ?? ''} · role ${role} · manual ${process.env.MANUAL_URL}\n`);

// The day (MODE=run, MODE=lab): one session at a time (a lock next to the state file), and a supervisor in code: when
// the model stops while journal.mjs status still names work it can do alone (a task to settle, owner tasks to
// finish), it starts a new session, which reads the journal and goes on. MAX_SESSIONS (default 3) is the agent's
// own pick, not from a spec: enough for a stop after WAITING and one more.
const day = process.env.MODE === 'run' || process.env.MODE === 'lab';
const lock = join(dirname(STATE_FILE()), 'run.lock');
if (day) {
  mkdirSync(dirname(lock), { recursive: true });
  let holder = null;
  try {
    holder = Number(readFileSync(lock, 'utf8'));
  } catch {}
  let alive = false;
  try {
    alive = Number.isInteger(holder) && holder > 0 && holder !== process.pid && process.kill(holder, 0);
  } catch {}
  if (alive) {
    console.error(`Another session (pid ${holder}) is running this day; two at once could pay twice. Nothing was started.`);
    process.exit(1);
  }
  writeFileSync(lock, String(process.pid));
  process.on('exit', () => {
    try {
      if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
    } catch {}
  });
}

function status() {
  return new Promise((done) => {
    const c = spawn(process.execPath, [join(here, 'scripts/journal.mjs'), 'status'], { env: process.env });
    let text = '';
    c.stdout.on('data', (d) => (text += d));
    c.on('close', () => done(/next: (.*)/.exec(text)?.[1] ?? ''));
  });
}

function session() {
  const child = spawn(process.platform === 'win32' ? 'pi.cmd' : 'pi', args, {
    cwd: here,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);
  return new Promise((done) => {
    child.on('error', (e) => {
      console.error(`Could not start pi: ${e.message}. Install Pi 1.5 or newer: npm install -g @earendil-works/pi-coding-agent (https://pi.dev).`);
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

function tee(stream, out) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    const lines = (rest + d).split('\n');
    rest = lines.pop();
    for (const line of lines) {
      const m = `${mask(line)}\n`;
      out.write(m);
      runLog.write(m);
    }
  });
  stream.on('end', () => {
    if (rest) {
      const m = mask(rest);
      out.write(m);
      runLog.write(m);
    }
  });
}
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 3);
let code = await session();
for (let k = 2; day && k <= MAX_SESSIONS; k++) {
  const next = await status();
  if (/^stop:/.test(next) || !/fetch the manual|parked\.mjs|routine\.mjs|settle\.mjs \w+ (pay|answer)|start\.mjs|check-key/.test(next)) break;
  const note = `\n[supervisor] the model stopped, but journal status says: ${mask(next)}. Starting session ${k} of ${MAX_SESSIONS}.\n`;
  process.stdout.write(note);
  runLog.write(note);
  code = await session();
}
if (day) {
  const note = `\n[supervisor] last journal status: ${mask(await status())}\n`;
  process.stdout.write(note);
  runLog.write(note);
}
runLog.end(() => process.exit(code));
