// fetch-attempt: opens one new S04E02 attempt (GET /manual with the ticket) and saves what the reviewer would read:
// the manual, GET /settings and GET /patch, under logs/s04e02/attempt-<stamp>/, with the ticket and the attempt
// masked as {{TICKET}} / {{ATTEMPT}}. Every request goes to logs/s04e02/requests.log, masked.
//   node lab/reviewer/fetch-attempt.mjs              read only: the attempt value is not kept anywhere
//   node lab/reviewer/fetch-attempt.mjs --into-vars  also puts the attempt into host-desk/vars.json as ATTEMPT (plan.md § 3)
// Approved: BRIEF.md "Outside actions approved", new attempts (2026-11-18). Never prints a secret value.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'https://hq.mega.dev/challenges/looks-good-to-me';
const VARS = join(ROOT, 'host-desk/vars.json');
const LOGDIR = join(ROOT, 'logs/s04e02');
const UA = { 'user-agent': 'host-desk-reviewer/1.0' };

const vars = JSON.parse(readFileSync(VARS, 'utf8'));
if (!vars.TICKET) throw new Error('vars.json has no TICKET');
const mask = (text, secrets) => Object.entries(secrets).reduce((s, [k, v]) => (v ? s.split(v).join(`{{${k}}}`) : s), String(text));
const short = (v) => `${v.slice(0, 4)}…${v.slice(-4)}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(LOGDIR, `attempt-${stamp}`);
mkdirSync(dir, { recursive: true, mode: 0o700 });

async function get(path, bearer, name, secrets) {
  const t = new Date().toISOString();
  const r = await fetch(`${BASE}/${path}`, { headers: { ...UA, authorization: `Bearer ${bearer}` }, redirect: 'manual' });
  const text = await r.text();
  appendFileSync(join(LOGDIR, 'requests.log'), `${t} GET /${path} Bearer ${short(bearer)} -> ${r.status} (${dir.slice(ROOT.length + 1)})\n`);
  writeFileSync(join(dir, `${name}.json`), mask(text, secrets), { mode: 0o600 });
  if (r.status !== 200) throw new Error(`GET /${path} -> ${r.status}: ${mask(text, secrets).slice(0, 300)}`);
  return JSON.parse(text);
}

const manual = await get('manual', vars.TICKET, 'manual', { TICKET: vars.TICKET });
const secrets = { TICKET: vars.TICKET, ATTEMPT: manual.attempt };
writeFileSync(join(dir, 'manual.json'), mask(JSON.stringify(manual, null, 1), secrets), { mode: 0o600 });
const settings = await get('settings', manual.attempt, 'settings', secrets);
const patch = await get('patch', manual.attempt, 'patch', secrets);
if (process.argv.includes('--into-vars')) {
  writeFileSync(VARS, `${JSON.stringify({ ...vars, ATTEMPT: manual.attempt }, null, 2)}\n`, { mode: 0o600 });
}
console.log(`saved ${dir.slice(ROOT.length + 1)}/ (manual, settings, patch)`);
console.log(`attempt ${short(manual.attempt)} expires ${manual.attemptExpiresAt}${process.argv.includes('--into-vars') ? ' · in vars.json as ATTEMPT' : ' · not kept'}`);
console.log(`settings ${settings.version} commissionPct ${settings.commissionPct}`);
for (const h of patch.hunks ?? []) console.log(`hunk ${h.id} ${h.file}: ${h.message}`);
