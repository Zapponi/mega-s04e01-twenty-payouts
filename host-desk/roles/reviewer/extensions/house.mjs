// house: the reviewer rules that are code, not prompt (plan.md § 2; check-lane routine-script: "judges only what the
// script cannot decide"). Pure functions, no network.
//   fixedVerdicts(patch, settings)  hunk id → { verdict, why } where the answer is exact: a commissionPct change in
//                                   config/house.json against the live /settings value. The guard refuses a review
//                                   that contradicts one.
//   houseFacts(patch)               hunk id → [fact]: the house-note patterns, as facts for the model only. A text
//                                   match is too weak to block the real send, so these are never enforced.
//   validFindings(body, hunks)      null, or why the review body breaks ROLE.md "Output".

const added = (diff) => String(diff ?? '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
const removed = (diff) => String(diff ?? '').split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
const pct = (lines) => lines.map((l) => /"commissionPct"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(l)?.[1]).filter((v) => v !== undefined).map(Number);

export function fixedVerdicts(patch, settings) {
  const out = {};
  const live = Number(settings?.commissionPct);
  if (!Number.isFinite(live)) return out;
  for (const h of patch?.hunks ?? []) {
    if (!/(^|\/)config\/house\.json$/.test(String(h.file))) continue;
    const to = pct(added(h.diff));
    if (to.length === 1 && to[0] !== live) {
      out[h.id] = { verdict: 'flag', why: `sets commissionPct to ${to[0]}; the house's current settings (${settings.version ?? 'GET /settings'}) say ${live}` };
    }
  }
  return out;
}

const PATTERNS = [
  [(a) => a.some((l) => /Math\.(round|ceil)\s*\(/.test(l)), 'adds Math.round or Math.ceil; why/payout-rounding.md says payouts round down (Math.floor)'],
  [(a, r) => r.some((l) => /Math\.floor\s*\(/.test(l)) && !a.some((l) => /Math\.floor\s*\(/.test(l)), 'removes Math.floor; why/payout-rounding.md says payouts round down'],
  [(a) => a.some((l) => /DAY_MS\s*\+\s*1\b|\/\s*DAY_MS\s*\)?\s*\+\s*1\b/.test(l)), 'adds one to a day count; why/nights.md says the check-out day is never a night'],
  [(a) => a.some((l) => /checkIn\b/.test(l)) && a.some((l) => /return\s+\w+\.checkIn\b/.test(l)), 'returns check-in as a date; why/payout-date.md says payouts go out on the check-out day'],
  [(a) => a.some((l) => /\.filter\(.*checkOut\s*(<|<=|>|>=)/.test(l)), 'filters tasks by check-out date; why/payout-date.md says the batch pays every task it gets on the day it runs'],
  [(a, r) => r.some((l) => /hostPayout\s*\(/.test(l)) && !a.some((l) => /hostPayout\s*\(/.test(l)), 'stops calling hostPayout; the manual says the host gets the stay total minus the house commission'],
  [(a, r) => r.some((l) => /commissionPct/.test(l)) && a.some((l) => /\b\d+\s*\/\s*100\b/.test(l)) && !a.some((l) => /commissionPct/.test(l)),'puts a fixed number where the commission goes; the manual says the current settings come from GET /settings'],
];

export function houseFacts(patch) {
  const out = {};
  for (const h of patch?.hunks ?? []) {
    const a = added(h.diff);
    const r = removed(h.diff);
    const facts = PATTERNS.filter(([test]) => test(a, r)).map(([, fact]) => fact);
    if (/(^|\/)why\//.test(String(h.file))) facts.push('changes a house note in why/; the notes are the house rules the change is judged by');
    if (facts.length) out[h.id] = facts;
  }
  return out;
}

export function validFindings(body, hunks) {
  const f = body?.findings;
  if (!Array.isArray(f)) return 'the body has no findings array';
  const ids = (hunks ?? []).map((h) => h.id);
  if (!ids.length || ids.some((id) => !id)) return 'the patch has no usable hunk ids';
  const seen = f.map((x) => x?.hunk);
  const missing = ids.filter((id) => !seen.includes(id));
  const extra = seen.filter((id) => !ids.includes(id));
  const dup = seen.filter((id, i) => seen.indexOf(id) !== i);
  if (missing.length || extra.length || dup.length) return `findings must name each hunk once: missing ${missing.join(', ') || 'none'}, unknown ${extra.join(', ') || 'none'}, repeated ${dup.join(', ') || 'none'}`;
  const bad = f.find((x) => !['flag', 'pass'].includes(x.verdict) || typeof x.reason !== 'string' || x.reason.trim() === '');
  if (bad) return `the finding for ${bad.hunk} needs verdict "flag" or "pass" and a reason`;
  const keys = f.find((x) => Object.keys(x).some((k) => !['hunk', 'verdict', 'reason'].includes(k)));
  return keys ? `the finding for ${keys.hunk} has fields other than hunk, verdict, reason` : null;
}
