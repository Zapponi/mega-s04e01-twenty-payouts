// code: runs one of your scripts from the scripts/ folder with Node, in that folder, and returns what it
// printed. The values in vars.json reach the script as environment variables (PAYOUT_KEY, …), the rest of the
// environment does not; the model sees only the script's output.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVars } from './vars.mjs';
import { config, mask } from '../lib/net.mjs';

/** One line per code call in <LOG_DIR>/code.jsonl (masked): what the model ran and what it saw (lab run 2026-11-19: the
 * model reported outputs nobody could check). */
function logCall(record) {
  try {
    const dir = config().logDir;
    mkdirSync(dir, { recursive: true });
    // the whole line is masked, every field (Sol whole-diff re-review B #3)
    appendFileSync(join(dir, 'code.jsonl'), `${mask(JSON.stringify({ time: new Date().toISOString(), run: process.env.RUN_ID ?? '', ...record }))}\n`);
  } catch {}
}

const SCRIPTS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts');
// The Node that runs a script: never process.execPath alone. In a compiled Pi (Pi 1.5.2 from nix is one binary)
// process.execPath is the pi binary itself, and "pi <file> <args>" starts a whole new agent session with every
// built-in tool and the default model: lab run 2026-11-19, 55 hidden Opus sessions ran in place of the scripts.
// run.mjs (plain Node) passes its own path as HOST_NODE; anything not named node is refused.
export function nodeBin(env = process.env, execPath = process.execPath) {
  const c = env.HOST_NODE || execPath;
  const isNode = (f) => /^node(\.exe)?$/i.test(nodePath.basename(f));
  if (typeof c !== 'string' || !nodePath.isAbsolute(c) || !isNode(c)) return null;
  // the file a link named node points to must be named node too (a link to pi is refused; Sol whole-diff B #2)
  try {
    return isNode(realpathSync(c)) ? c : null;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 120_000;
const MAX_OUT = 20_000;

// Peer QA 11-12: a script gets the OS basics Node and git need, plus vars.json, never the rest of the environment, so
// the model key (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, …) never reaches a script. The proxy settings stay so a script
// works behind a company proxy; of git's own settings only the commit name and email stay.
const BASICS = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|USER|USERNAME|LOGNAME|SHELL|TERM|LANG|LC_[A-Z]+|TZ|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|NO_PROXY|NODE_USE_ENV_PROXY|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL))$/i;
const basics = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => BASICS.test(k)));
// The request layer's settings (plan.md § 0) reach every script, so a script's requests pass the same checks.
const NET = /^(READ_ONLY|ALLOWED_HOSTS|MANUAL_URL|MANUAL_ONCE|API_BASE|PAYOUTS_URL|VERIFY_BASE|DENY_URLS|LOG_DIR|RUN_ID|VARS_FILE|STATE_FILE|JOURNAL_DIR|ALLOW_RUN)$/;
const net = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => NET.test(k)));

/**
 * Where `name` points inside `root` (scripts/), or null. Only a plain relative path counts: no absolute, UNC
 * (\\host\share\…, //host/share/…) or other-drive (C:\…, C:x) path, nothing that climbs out with "..".
 * `path` is node:path; a check of the Windows forms on any OS passes path.win32.
 */
export function inside(name, root = SCRIPTS, path = nodePath) {
  if (typeof name !== 'string' || name === '' || path.isAbsolute(name) || /^[a-z]:/i.test(name)) return null;
  const file = path.resolve(root, name);
  const rel = path.relative(root, file);
  if (rel === '' || path.isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..') return null;
  return file;
}

// Only the day's scripts. Others in scripts/ (open-practice.mjs, § 2) talk to the real host with their own
// settings and are run by a person, never by the model (Sol review B #1).
export const ALLOWED = new Set(['journal.mjs', 'routine.mjs', 'start.mjs', 'settle.mjs', 'parked.mjs']);

/** The script to run, or null: one of ALLOWED, inside scripts/, there, and no link that leads out of scripts/. */
function script(name) {
  if (!ALLOWED.has(String(name ?? '').replace(/^\.\//, ''))) return null;
  const file = inside(name);
  if (!file || !existsSync(file)) return null;
  try {
    return realpathSync(file).startsWith(realpathSync(SCRIPTS) + sep) ? file : null;
  } catch {
    return null;
  }
}

export default function (pi) {
  pi.registerTool({
    name: 'code',
    label: 'code',
    description: 'Runs a JavaScript file from the scripts/ folder with Node and returns its output.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['file'],
      properties: {
        file: { type: 'string', description: 'A file inside scripts/, e.g. "run.mjs".' },
        args: { type: 'array', items: { type: 'string' } },
      },
    },
    async execute(_id, p, signal) {
      const file = script(p.file);
      const t0 = Date.now();
      if (!file) {
        logCall({ file: String(p.file).slice(0, 100), args: (p.args ?? []).map((a) => mask(String(a)).slice(0, 200)), refused: 'no such file' });
        return { content: [{ type: 'text', text: mask(`No such file in scripts/: ${p.file}`) }], details: { failed: true } };
      }
      const node = nodeBin();
      if (!node) {
        return { content: [{ type: 'text', text: 'Cannot run scripts: no Node binary (HOST_NODE). Start the role with run.mjs. Nothing was run.' }], details: { failed: true } };
      }
      const out = await new Promise((done) => {
        const child = spawn(node, [file, ...(p.args ?? [])], {
          cwd: SCRIPTS,
          // another role's attempt (ATTEMPT_PREV_*) never reaches a script (Sol whole-diff B #2)
          env: { ...basics(), ...net(), ...Object.fromEntries(Object.entries(loadVars()).filter(([k]) => !k.startsWith('ATTEMPT_PREV_'))) },
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
          timeout: TIMEOUT_MS,
        });
        let text = '';
        child.stdout.on('data', (d) => (text += d));
        child.stderr.on('data', (d) => (text += d));
        child.on('error', (e) => {
          logCall({ file: p.file, args: (p.args ?? []).map((a) => mask(String(a)).slice(0, 200)), error: mask(e.message), aborted: !!signal?.aborted, ms: Date.now() - t0 });
          done(`could not run: ${mask(e.message)}`);
        });
        // Masked before the model sees it (plan.md § 0): a script that prints a secret by mistake shows {{NAME}}.
        child.on('close', (code, sig) => {
          const shown = mask(text);
          logCall({ file: p.file, args: (p.args ?? []).map((a) => mask(String(a)).slice(0, 200)), exit: code, signal: sig, aborted: !!signal?.aborted, ms: Date.now() - t0, out: shown.slice(0, MAX_OUT) });
          done(`exit ${code}\n${shown.length > MAX_OUT ? `${shown.slice(0, MAX_OUT)}\n…(cut)` : shown}`);
        });
      });
      return { content: [{ type: 'text', text: out }], details: {} };
    },
  });
}
