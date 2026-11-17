// check-key: the manual's pre-run step, "Before a run, check the payout key: GET https://verify-s04.mega.dev/<path>
// with the header X-Payout-Key" (logs/manual/manual-2026-11-16T23-04-18-324Z.txt). The path is this attempt's
// VERIFY_PATH, which the request layer took from the manual into the state file; it is a secret, so it is sent by
// reference and shows as {{VERIFY_PATH}} everywhere. Exit 0 only on a 2xx reply.
import { journal } from '../lib/batch.mjs';
import { refusalOf, show, state, verifyUrl } from '../lib/flow.mjs';
import { send } from '../lib/net.mjs';

const st = state();
if (!st.VERIFY_PATH) {
  console.log('No VERIFY_PATH in the state file: fetch the manual of this attempt first. Nothing was sent.');
  process.exit(1);
}
const r = await send({
  method: 'GET',
  url: verifyUrl(),
  headers: { 'X-Payout-Key': '{{PAYOUT_KEY}}' },
  signal: AbortSignal.timeout(Number(process.env.SETTLE_TIMEOUT_MS || 4000)),
});
const ref = r.status ? refusalOf(r) : null;
journal({ event: 'key_checked', attempt: st.ATTEMPT_SEEN_AT, http: r.status, ok: r.status >= 200 && r.status < 300 && !ref, need: ref?.need, why: ref?.why ?? r.refused ?? r.error });
if (r.status >= 200 && r.status < 300 && !ref) {
  console.log(`KEY OK: ${show(r)}`);
  process.exit(0);
}
console.log(`KEY CHECK FAILED: ${show(r)}${ref?.need ? ` (need: ${ref.need})` : ''}. Do not start the run; stop and tell the human.`);
process.exit(1);
