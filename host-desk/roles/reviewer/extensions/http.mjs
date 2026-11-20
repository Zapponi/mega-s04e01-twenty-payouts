// http: one HTTP request, guarded in code (plan.md § 2; BRIEF.md R2). The course's version filled {{NAME}} only for a
// host that secret may reach (hosts.json) and checked redirects hop by hop; this one keeps that and adds what the
// prompt cannot hold:
//   - three routes only, on the Challenge base: GET /settings, GET /patch, POST /review (ROLE.md "Limits", "Output");
//   - no redirect is followed: a 3xx comes back as it is, so no secret and no write travels on a hop;
//   - POST /review only after this session read /settings and /patch of the same attempt with 200 (the given
//     reviewer judged without /settings: KEEP.md);
//   - the review body must name each hunk of that /patch once, with flag|pass and a reason, and may not contradict a
//     fixed verdict of extensions/house.mjs (a commissionPct change against the live /settings);
//   - one POST /review per attempt: reserved on disk before it leaves, never sent twice (api-index: a second one reads
//     back { already: true });
//   - every reply is masked: a secret value never reaches the model;
//   - each request has a time limit, so a server that never answers cannot hold the session.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedVerdicts, houseFacts, validFindings } from './house.mjs';
import { loadHosts, mayReach } from './hosts.mjs';
import { fillVars, loadVars } from './vars.mjs';

const MAX_BODY = 20_000;
const TIMEOUT_MS = 20_000;
const COURSE = 'https://hq.mega.dev/challenges/looks-good-to-me';
const ROLE = dirname(dirname(fileURLToPath(import.meta.url)));
const REF = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const refsIn = (text) => [...String(text).matchAll(REF)].map((m) => m[1]);
const ROUTES = [['GET', '/settings'], ['GET', '/patch'], ['POST', '/review']];

/** The Challenge base: the mock in lab mode (run.mjs sets LAB_URL and deletes it otherwise), else the course. */
export const courseBase = () => (process.env.LAB_URL || COURSE).replace(/\/+$/, '');
/** Where a sent review is reserved: the lab scenario folder, or scripts/state/ (git-ignored). */
const stateDir = () => (process.env.LAB_URL && process.env.LAB_OUT ? process.env.LAB_OUT : join(ROLE, 'scripts', 'state'));

/** The route of `url` + `method`, or why it is not allowed. */
export function route(method, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { error: `not a URL: ${url}` };
  }
  const base = new URL(courseBase());
  const basePath = base.pathname.replace(/\/+$/, '');
  if (u.origin !== base.origin || !u.pathname.startsWith(`${basePath}/`)) return { error: `only the Challenge API at ${base.origin}${basePath} may be called` };
  const path = u.pathname.slice(basePath.length).replace(/\/+$/, '');
  const ok = ROUTES.some(([m, p]) => m === method && p === path);
  return ok ? { path } : { error: `${method} ${path || '/'} is not allowed: only GET /settings, GET /patch and POST /review` };
}

/** One session (one Pi process): what this session read, per attempt. */
export function newSession() {
  return { reads: new Map() };
}
let session = newSession();
export const resetSession = () => (session = newSession());

const attemptKey = (vars) => createHash('sha256').update(String(vars.ATTEMPT ?? '')).digest('hex').slice(0, 16);
const mask = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => (v && v.length >= 4 ? s.split(v).join(`{{${k}}}`).split(encodeURIComponent(v)).join(`{{${k}}}`) : s), String(text));

/** Runs one request through the guard. Exported for the tests; the tool below calls it. */
export async function guardedRequest(p, signal) {
  const vars = loadVars();
  const hosts = loadHosts();
  // every text that leaves this function, and every file it writes, goes through the mask: no field-by-field list to
  // forget (Sol whole-diff re-review B #1)
  const fail = (text) => ({ content: [{ type: 'text', text: mask(`not sent: ${text}`, vars) }], details: { failed: true } });
  const keep = (file, obj, opts) => writeFileSync(file, mask(JSON.stringify(obj), vars), opts);
  const method = (p.method ?? 'GET').toUpperCase();
  const r = route(method, p.url);
  if (r.error) return fail(r.error);
  const headers = { ...p.headers };
  const body = p.body === undefined || p.body === null ? undefined : typeof p.body === 'string' ? p.body : JSON.stringify(p.body);
  if (body !== undefined && typeof p.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  const refs = [...refsIn(p.url), ...Object.values(headers).flatMap(refsIn), ...(body ? refsIn(body) : [])].filter((n) => n in vars);
  const blocked = refs.filter((n) => !mayReach(n, p.url, hosts));
  if (blocked.length) return fail(`{{${blocked[0]}}} may not reach ${new URL(p.url).host} (hosts.json)`);
  const key = attemptKey(vars);
  const seen = session.reads.get(key) ?? {};

  let reservation = null;
  let sentHunks = null;
  if (r.path === '/review') {
    if (seen.settings?.status !== 200 || seen.patch?.status !== 200) return fail(`read GET /settings and GET /patch of this attempt (both 200) before POST /review; this session has settings ${seen.settings?.status ?? 'not read'}, patch ${seen.patch?.status ?? 'not read'}`);
    let parsed;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      return fail('the review body is not JSON');
    }
    const invalid = validFindings(parsed, seen.patch.body.hunks);
    if (invalid) return fail(invalid);
    const fixed = fixedVerdicts(seen.patch.body, seen.settings.body);
    const against = parsed.findings.filter((f) => fixed[f.hunk] && fixed[f.hunk].verdict !== f.verdict);
    if (against.length) return fail(`hunk ${against[0].hunk} must be "${fixed[against[0].hunk].verdict}": it ${fixed[against[0].hunk].why}`);
    mkdirSync(stateDir(), { recursive: true });
    reservation = join(stateDir(), `review-${key}.json`);
    try {
      sentHunks = parsed.findings.map((f) => f.hunk);
      keep(reservation, { reservedAt: new Date().toISOString(), hunks: sentHunks }, { flag: 'wx' });
    } catch {
      return fail('a review for this attempt was already sent; the course takes one POST /review per attempt');
    }
  }

  const filled = Object.fromEntries(Object.entries({ 'user-agent': 'host-desk-reviewer/2.0', ...headers }).map(([k, v]) => [k, fillVars(v, vars)]));
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  let res;
  let text;
  try {
    res = await fetch(fillVars(p.url, vars), { method, headers: filled, body: body === undefined ? undefined : fillVars(body, vars), redirect: 'manual', signal: sig });
    text = await res.text();
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000} s` : (e?.cause?.message ?? e?.message ?? String(e));
    if (reservation) keep(reservation, { uncertain: true, why, at: new Date().toISOString(), hunks: sentHunks });
    return { content: [{ type: 'text', text: `request failed: ${mask(why, vars)}${reservation ? ' — the review may or may not have arrived; it is never sent again for this attempt' : ''}` }], details: { failed: true } };
  }
  if (reservation) keep(reservation, { status: res.status, at: new Date().toISOString(), hunks: sentHunks, reply: text.slice(0, 2000) });

  // Merge into the state as it is now, not as it was when this request started: the model often reads /settings
  // and /patch at the same time, and a stale copy would erase the other read (lab run 1, 2026-11-19).
  if (method === 'GET') {
    let read = { status: res.status };
    if (res.status === 200) {
      try {
        read = { status: 200, body: JSON.parse(text) };
      } catch {
        read = { status: 'not JSON' };
      }
    }
    session.reads.set(key, { ...session.reads.get(key), [r.path.slice(1)]: read });
  }
  let out = mask(text, vars);
  if (out.length > MAX_BODY) out = `${out.slice(0, MAX_BODY)}\n…(cut)`;
  const location = res.headers.get('location');
  let extra = location ? `\n(redirect to ${mask(location, vars)} not followed: only the Challenge API may be called)` : '';
  if (r.path === '/patch' && res.status === 200) {
    const now = session.reads.get(key);
    const fixed = now?.settings?.body ? fixedVerdicts(now.patch.body, now.settings.body) : {};
    const facts = houseFacts(now?.patch?.body);
    const lines = (now?.patch?.body?.hunks ?? []).map((h) => {
      const f = fixed[h.id] ? [`FIXED VERDICT ${fixed[h.id].verdict}: ${fixed[h.id].why}`] : [];
      const all = [...f, ...(facts[h.id] ?? [])];
      return `- ${h.id}: ${all.length ? all.join('; ') : 'no house fact found by code; judge it from the base files, the house notes and the settings'}`;
    });
    extra += `\n\nHouse check (code, not the patch's words)${now?.settings?.body ? '' : ' — read GET /settings first: no fixed verdict without it'}:\n${lines.join('\n')}`;
  }
  // the House check prints hunk ids from the patch: masked like the body (Sol whole-diff B #1)
  return { content: [{ type: 'text', text: mask(`${res.status} ${p.url}\n${out}${extra}`, vars) }], details: { status: res.status } };
}

export default function (pi) {
  pi.registerTool({
    name: 'http',
    label: 'http',
    description: 'Sends one request to the Challenge API: GET /settings, GET /patch or POST /review only. {{NAME}} references from vars are filled in for the hosts in hosts.json. Redirects are not followed. POST /review needs the settings and the patch read first, every hunk once, and goes once per attempt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        method: { type: 'string', description: 'GET (default) or POST.' },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { description: 'A string, or a JSON value (sent as JSON).' },
      },
    },
    execute: (_id, p, signal) => guardedRequest(p, signal),
  });
}
