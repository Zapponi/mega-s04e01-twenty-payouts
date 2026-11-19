// settings: the house's current settings of this attempt (S04E02 API index: GET /settings, Bearer <attempt> →
// { version, commissionPct, next }). The payout rule takes commissionPct from here, never from a file or a memory
// (S04E02: attempt 1 had 18 %, a later attempt 14 %). Read before a batch opens and kept in the journal, per attempt
// (not in the state file: the request layer would mask a value kept there).
import { events, journal } from './batch.mjs';
import { refusalOf, settingsUrl, show } from './flow.mjs';
import { send } from './net.mjs';

/**
 * The settings a batch of this attempt was opened with: the last read journaled as 'settings' before that batch's
 * open ('opening'), or, before any open, the last one. A later check (parked.mjs) is journaled as 'settings_check'
 * and never becomes the baseline, so a changed version stops every later owner payout too (Sol review #22 B1).
 */
export function settingsOf(st, batch = 'run') {
  const ev = events().filter((e) => e.attempt === st.ATTEMPT_SEEN_AT);
  const opening = ev.findLast((e) => e.event === 'opening' && e.batch === batch);
  const reads = ev.filter((e) => e.event === 'settings' && (!opening || Date.parse(e.time) <= Date.parse(opening.time)));
  return reads.at(-1) ?? null;
}

/**
 * GET /settings for this attempt. { ok: true, version, commissionPct } (journaled), or { ok: false, why, need? }.
 * A reply without a string version and a commissionPct in [0, 100) is not used.
 */
export async function readSettings(st, timeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 4000), event = 'settings') {
  const r = await send({ method: 'GET', url: settingsUrl(), headers: { Authorization: 'Bearer {{ATTEMPT}}' }, signal: AbortSignal.timeout(timeoutMs) });
  const ref = r.status ? refusalOf(r) : null;
  if (ref) {
    journal({ event: 'settings_refused', attempt: st.ATTEMPT_SEEN_AT, need: ref.need, why: ref.why, http: r.status });
    return { ok: false, why: `GET /settings refused: ${ref.why}`, need: ref.need };
  }
  let b = null;
  try {
    b = JSON.parse(r.body);
  } catch {}
  const pct = b?.commissionPct;
  if (!(r.status >= 200 && r.status < 300) || typeof b?.version !== 'string' || !b.version || typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct >= 100) {
    journal({ event: 'settings_failed', attempt: st.ATTEMPT_SEEN_AT, http: r.status, why: r.refused ?? r.error });
    return { ok: false, why: `GET /settings gave no usable { version, commissionPct }: ${show(r).slice(0, 200)}` };
  }
  journal({ event, attempt: st.ATTEMPT_SEEN_AT, version: b.version, commissionPct: pct, http: r.status });
  return { ok: true, version: b.version, commissionPct: pct };
}
