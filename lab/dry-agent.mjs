// lab/dry-agent: a scripted stand-in for the model, for free runs of the lab (no model call). It follows ROLE.md the
// way a careful agent would: journal status → the step it names; it decides each task from the task itself (another
// account, or booking text that asks for something → flag; else pay). It proves the mock, the runner and
// ./verify --lab; it proves nothing about the model. Env: the same as run.mjs MODE=lab (LAB_URL, LAB_OUT).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const role = join(here, '../host-desk/roles/payout-runner');
const lab = process.env.LAB_URL;
const out = process.env.LAB_OUT;
Object.assign(process.env, {
  ALLOWED_HOSTS: 'localhost', API_BASE: lab, PAYOUTS_URL: `${lab}/payouts`, VERIFY_BASE: `${lab}/verify`, MANUAL_URL: `${lab}/manual`, MANUAL_ONCE: '1', ALLOW_RUN: '1',
  VARS_FILE: join(here, 'vars.lab.json'), STATE_FILE: join(out, 'state', 'vars.json'), LOG_DIR: join(out, 'logs'), JOURNAL_DIR: join(out, 'journal'),
});
const { send } = await import(pathToFileURL(join(role, 'lib/net.mjs')).href);

const code = (file, ...args) =>
  new Promise((done) => {
    const c = spawn(process.execPath, [join(role, 'scripts', file), ...args], { env: process.env, cwd: join(role, 'scripts') });
    let text = '';
    c.stdout.on('data', (d) => (text += d));
    c.stderr.on('data', (d) => (text += d));
    c.on('close', (status) => {
      console.log(`$ ${file} ${args.join(' ')} → exit ${status}\n${text.trim()}`);
      done({ status, text });
    });
  });

for (let step = 0; step < 300; step++) {
  const next = /next: (.*)/.exec((await code('journal.mjs', 'status')).text)?.[1] ?? '';
  if (next.startsWith('nothing left')) break;
  if (next.startsWith('fetch the manual')) {
    const r = await send({ url: process.env.MANUAL_URL, headers: { Authorization: 'Bearer {{TICKET}}' }, caller: 'model' });
    console.log(`$ http GET manual → ${r.status ?? r.refused}`);
    if (r.status !== 200) process.exit(1);
  } else if (next.startsWith('check-key')) {
    if ((await code('check-key.mjs')).status !== 0) process.exit(1);
  } else if (next.startsWith('start.mjs')) {
    if ((await code('start.mjs', next.split(' ')[1])).status !== 0) process.exit(1);
  } else if (/^settle\.mjs \w+ pay/.test(next)) {
    // no judgement of its own: settle decides in code; what it will not pay goes to the owner
    const batch = next.split(' ')[1];
    const r = await code('settle.mjs', batch, 'pay');
    if (r.status === 1 && /NOT PAID/.test(r.text)) {
      if (batch !== 'run') break;
      await code('settle.mjs', 'run', 'flag', 'not paid by the rules');
    }
  } else if (/^settle\.mjs \w+ answer/.test(next)) {
    await code('settle.mjs', next.split(' ')[1], 'answer');
  } else if (next.includes('parked.mjs')) {
    let r;
    do r = await code('parked.mjs');
    while (r.status === 4);
    if (r.status !== 0) break;
  } else {
    console.log(`stop: ${next}`);
    break;
  }
}
console.log('Final summary:');
await code('journal.mjs', 'status');
