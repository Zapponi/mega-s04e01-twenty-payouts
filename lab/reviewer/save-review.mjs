// save-review: after the real reviewer run (plan.md § 3), saves the course's reply to the one POST /review as
// logs/s04e02/review-real-<stamp>.json for ./verify --slice 1 (R3). It reads the guard's reservation for the attempt
// now in vars.json (host-desk/roles/reviewer/scripts/state/review-<key>.json, masked by the guard) and the patch saved
// by fetch-attempt.mjs --into-vars, and checks the review named exactly that patch's hunks. Never prints a secret.
//   node lab/reviewer/save-review.mjs logs/s04e02/attempt-<stamp>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const attemptDir = process.argv[2];
if (!attemptDir) throw new Error('usage: node lab/reviewer/save-review.mjs logs/s04e02/attempt-<stamp>');
const vars = JSON.parse(readFileSync(join(ROOT, 'host-desk/vars.json'), 'utf8'));
const key = createHash('sha256').update(String(vars.ATTEMPT ?? '')).digest('hex').slice(0, 16);
const resFile = join(ROOT, 'host-desk/roles/reviewer/scripts/state', `review-${key}.json`);
if (!existsSync(resFile)) throw new Error('no review was sent for the attempt in vars.json');
const res = JSON.parse(readFileSync(resFile, 'utf8'));
const manual = JSON.parse(readFileSync(join(ROOT, attemptDir, 'manual.json'), 'utf8'));
const patch = JSON.parse(readFileSync(join(ROOT, attemptDir, 'patch.json'), 'utf8'));
let body = null;
try {
  body = JSON.parse(res.reply);
} catch {}
const out = {
  savedAt: new Date().toISOString(),
  attempt: '{{ATTEMPT}}',
  attemptDir,
  attemptExpiresAt: manual.attemptExpiresAt,
  sentAt: res.at,
  unexpired: Date.parse(res.at) < Date.parse(manual.attemptExpiresAt),
  patchHunks: patch.hunks.map((h) => h.id),
  sentHunks: res.hunks ?? null,
  sameHunks: JSON.stringify([...(res.hunks ?? [])].sort()) === JSON.stringify(patch.hunks.map((h) => h.id).sort()),
  status: res.status ?? null,
  uncertain: !!res.uncertain,
  body,
};
const file = join(ROOT, 'logs/s04e02', `review-real-${out.savedAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
console.log(`saved ${file.slice(ROOT.length)}: ${out.status} ${JSON.stringify(body).slice(0, 300)}`);
