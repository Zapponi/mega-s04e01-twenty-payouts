// open-practice: opens the practice batch once, to see the real task shape (plan.md v2 § 2). It answers nothing and
// pays nothing. Contract (API index, logs/manual/manual-2026-11-16T23-01-32-060Z.txt):
//   "practice": { "method": "POST", "url": ".../practice", "start": { "attempt": "<attempt>" }, ... }
// Every string under a key named like task/token in the reply is a secret (it authorizes an answer): it is saved as
// PRACTICE_TASK_<n> in the state file and masked before anything is logged or printed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, saveState, send } from '../lib/net.mjs';
import { STATE_FILE } from '../extensions/vars.mjs';

const URL_PRACTICE = 'https://hq.mega.dev/challenges/looks-good-to-me/practice';
process.env.ALLOWED_HOSTS = 'hq.mega.dev';
process.env.WRITE_URLS = URL_PRACTICE; // this script may write to this one URL only
process.env.RUN_ID ||= `open-practice-${new Date().toISOString().replace(/[:.]/g, '-')}`;

let state = {};
try {
  state = JSON.parse(readFileSync(STATE_FILE(), 'utf8'));
} catch {}
if (!state.ATTEMPT) {
  console.log('No attempt in the state file: fetch the manual first.');
  process.exit(1);
}
if (state.PRACTICE_OPENED_AT && !process.argv.includes('--again')) {
  console.log(`Practice was already opened at ${state.PRACTICE_OPENED_AT}; not opening it twice.`);
  process.exit(1);
}

function tokens(raw) {
  const out = {};
  let n = 0;
  const walk = (v, key = '') => {
    if (typeof v === 'string') {
      if (/task|token/i.test(key) && v.length >= 8) out[`PRACTICE_TASK_${++n}`] = v;
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(JSON.parse(raw));
  return out;
}

const r = await send({ method: 'POST', url: URL_PRACTICE, body: { attempt: '{{ATTEMPT}}' } }, { capture: tokens });
if (r.status) saveState({ PRACTICE_OPENED_AT: new Date().toISOString() });
const cfg = config();
const dir = join(cfg.logDir, 'practice');
mkdirSync(dir, { recursive: true });
const file = join(dir, `practice-${cfg.runId}.txt`);
writeFileSync(file, `status: ${r.status ?? ''} ${r.refused ?? r.error ?? ''}\n\n${r.body}`);
console.log(`status ${r.status ?? '-'} ${r.refused ? `refused: ${r.refused}` : ''}${r.error ? `error: ${r.error}` : ''}`);
console.log(`saved (masked): ${file}`);
