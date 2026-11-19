// vars: the agent's secret store. Values live in vars.json at the top of the Host Desk (one file for every role) and
// never reach the model:
// this tool lists names and hands back a reference, {{NAME}}. The http tool fills a reference in when it
// sends a request; the code tool passes the values to your script as environment variables.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// host-desk/roles/<role>/extensions/vars.mjs → host-desk/
const DESK = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Values the request layer captures at run time (the attempt token from /manual), kept out of git
// (scripts/state/ is git-ignored) and treated like any other var: filled in by reference, masked everywhere.
export const STATE_FILE = () => process.env.STATE_FILE || join(DESK, 'roles/payout-runner/scripts/state/vars.json');

const readVars = (file) => {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'string'));
  } catch {
    return {};
  }
};

/** name → value, from vars.json (or VARS_FILE, for tests) plus the run-time state file. Missing file or bad JSON → no vars. */
export function loadVars() {
  const shared = readVars(process.env.VARS_FILE || join(DESK, 'vars.json'));
  // The shared vars.json may hold another role's ATTEMPT (the reviewer's, S04E02). The batch uses only the attempt of
  // its own manual fetch, from the state file: the shared one is kept as ATTEMPT_PREV_0, so it stays masked and
  // scoped to the course API, but {{ATTEMPT}} never means it (plan.md § 4, case B09).
  if ('ATTEMPT' in shared) {
    shared.ATTEMPT_PREV_0 = shared.ATTEMPT;
    delete shared.ATTEMPT;
  }
  return { ...shared, ...readVars(STATE_FILE()) };
}

/** Replaces every {{NAME}} with its value; an unknown name stays as written. */
export function fillVars(text, vars = loadVars()) {
  return String(text).replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (ref, name) => (name in vars ? vars[name] : ref));
}

export default function (pi) {
  pi.registerTool({
    name: 'vars',
    label: 'vars',
    description: 'Lists the stored secrets by name. Returns a reference like {{PAYOUT_KEY}}, never the value. Put the reference in an http request; it is filled in when the request is sent.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      const names = Object.keys(loadVars());
      const text = names.length ? names.map((n) => `{{${n}}}`).join('\n') : 'No vars yet. Your human adds them to vars.json.';
      return { content: [{ type: 'text', text }], details: { names } };
    },
  });
}
