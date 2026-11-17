// Starts the payout-runner once: Pi in print mode with the three tools from extensions/ and no others, ROLE.md as
// the system prompt. Model: MODEL (e.g. openrouter/<model id>), else Pi's default. stdin is closed, because `pi -p`
// waits for stdin when it is an open pipe.
//
// Request layer (plan.md § 0): run.mjs sets the run id, the host allowlist and the manual URL for the tools, and
// tees pi's output, masked, into logs/run-<run id>.log.
// READ_ONLY=1 (slice 1): ROLE.slice1.md as the system prompt; the request layer allows only GET to the manual URL.
// MODE=practice: ROLE.practice.md; hosts hq.mega.dev + pay-s04.mega.dev; the model's http may not GET /manual (a
// fetch opens a new attempt); writes happen only in scripts/start.mjs and scripts/settle.mjs, each with its own URLs.
// Anything else refuses to start: the full run (ROLE.md, ALLOW_RUN=1) needs its own yes.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, mask } from './lib/net.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL = 'https://hq.mega.dev/challenges/twenty-payouts/manual';
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
} else {
  console.error('Run with READ_ONLY=1 (slice 1) or MODE=practice. The full run is not wired yet (plan.md § 6).');
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
const child = spawn(process.platform === 'win32' ? 'pi.cmd' : 'pi', args, {
  cwd: here,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

// Masked tee, line by line, so a value split across two chunks is still masked.
const cfg = config();
mkdirSync(cfg.logDir, { recursive: true });
const runLog = createWriteStream(join(cfg.logDir, `run-${cfg.runId}.log`), { flags: 'a' });
runLog.write(`# run ${cfg.runId} · model ${process.env.MODEL ?? '(pi default)'} · READ_ONLY=${process.env.READ_ONLY ?? ''} · role ${role} · manual ${process.env.MANUAL_URL}\n`);
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
tee(child.stdout, process.stdout);
tee(child.stderr, process.stderr);
child.on('error', (e) => {
  console.error(`Could not start pi: ${e.message}. Install Pi 1.5 or newer: npm install -g @earendil-works/pi-coding-agent (https://pi.dev).`);
  process.exit(1);
});
child.on('close', (code) => runLog.end(() => process.exit(code ?? 1)));
