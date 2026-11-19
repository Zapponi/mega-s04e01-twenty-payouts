// code: runs one of your scripts from the scripts/ folder with Node, in that folder, and returns what it
// printed. The values in vars.json reach the script as environment variables (PAYOUT_KEY, …), the rest of the
// environment does not; the model sees only the script's output.
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVars } from './vars.mjs';

const mask = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => (v && v.length >= 4 ? s.split(v).join(`{{${k}}}`).split(encodeURIComponent(v)).join(`{{${k}}}`) : s), String(text));

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

/** The script to run, or null: inside scripts/, there, and no link that leads out of scripts/. */
function script(name) {
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
      if (!file) {
        return { content: [{ type: 'text', text: mask(`No such file in scripts/: ${p.file}`, loadVars()) }], details: { failed: true } };
      }
      const node = nodeBin();
      if (!node) {
        return { content: [{ type: 'text', text: 'Cannot run scripts: no Node binary (HOST_NODE). Start the role with run.mjs. Nothing was run.' }], details: { failed: true } };
      }
      const out = await new Promise((done) => {
        const child = spawn(node, [file, ...(p.args ?? [])], {
          cwd: SCRIPTS,
          env: { ...basics(), ...loadVars() },
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
          timeout: TIMEOUT_MS,
        });
        let text = '';
        child.stdout.on('data', (d) => (text += d));
        child.stderr.on('data', (d) => (text += d));
        // masked before the model sees it: a script that prints a secret by mistake shows {{NAME}} (Sol whole-diff B #2)
        const vars = loadVars();
        child.on('error', (e) => done(`could not run: ${mask(e.message, vars)}`));
        child.on('close', (code) => {
          const shown = mask(text, vars);
          done(`exit ${code}\n${shown.length > MAX_OUT ? `${shown.slice(0, MAX_OUT)}\n…(cut)` : shown}`);
        });
      });
      return { content: [{ type: 'text', text: out }], details: {} };
    },
  });
}
