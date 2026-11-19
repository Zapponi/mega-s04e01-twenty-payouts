// net: the one request layer (plan.md § 0). Every request to any host, from the model's http tool or from a script,
// goes through send(). Nothing else in this role calls fetch.
//
// - Host allowlist: ALLOWED_HOSTS (comma list, e.g. "hq.mega.dev" or "localhost"). Empty → every request is refused.
//   Hosts other than localhost / 127.0.0.1 must use https.
// - READ_ONLY=1: only GET, and only to MANUAL_URL (slice 1).
// - caller "model": GET only, in every slice. Writes happen only in checked scripts (caller "script").
// - Redirects are followed by hand, and every hop passes the same checks.
// - Every request, reply and refusal is appended to <LOG_DIR>/requests.jsonl, each vars value replaced by {{NAME}}.
// - A 200 reply to MANUAL_URL is saved, masked, under <LOG_DIR>/manual/.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillVars, loadVars, STATE_FILE } from '../extensions/vars.mjs';

// host-desk/roles/payout-runner/lib/net.mjs → repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const USER_AGENT = 'payout-runner/1.0 (MEGA.dev host-desk)';
const MAX_HOPS = 5;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// An attempt lasts 3 h after the manual fetch (manual 2026-11-16: attemptExpiresAt = fetch + 3 h), used only when
// the reply gave no attemptExpiresAt.
const ATTEMPT_TTL_MS = 3 * 3_600_000;

/** Until when the attempt in the state file is open (ms), or 0 when there is none. */
export function attemptOpenUntil(st = readState()) {
  if (!st.ATTEMPT) return 0;
  // closed by the human (run.mjs NEW_ATTEMPT=1): holds the ATTEMPT_SEEN_AT of the attempt it closed
  if (st.ATTEMPT_CLOSED_AT && st.ATTEMPT_CLOSED_AT === st.ATTEMPT_SEEN_AT) return 0;
  const until = Date.parse(st.ATTEMPT_EXPIRES_AT ?? '') || Date.parse(st.ATTEMPT_SEEN_AT ?? '') + ATTEMPT_TTL_MS;
  return Number.isFinite(until) ? until : 0;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

export function config(env = process.env) {
  return {
    allowedHosts: String(env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    readOnly: env.READ_ONLY === '1',
    manualUrl: env.MANUAL_URL ?? '',
    // MANUAL_ONCE=1 (the run): a manual fetch is refused while the attempt in the state file is open, so a restart
    // never deals a new batch ("Each fetch starts a new attempt", API index).
    manualOnce: env.MANUAL_ONCE === '1',
    attemptOpenUntil: env.MANUAL_ONCE === '1' ? attemptOpenUntil() : 0,
    // Writes (any method but GET) are allowed only to these exact URLs, set per run or per script.
    denyUrls: String(env.DENY_URLS ?? '').split(',').map((w) => w.trim()).filter(Boolean),
    writeUrls: String(env.WRITE_URLS ?? '').split(',').map((w) => w.trim()).filter(Boolean),
    logDir: env.LOG_DIR ? resolve(env.LOG_DIR) : join(ROOT, 'logs'),
    runId: env.RUN_ID ?? '',
    // Where each secret may go (check-lane payout-run, 2026-11-17: "A document's request never sends a secret to a new
    // host"). Fixed here and in run.mjs, never from a manual or a reply: only the human changes it.
    apiBase: env.API_BASE || 'https://hq.mega.dev/challenges/looks-good-to-me',
    payoutsUrl: env.PAYOUTS_URL || 'https://pay-s04.mega.dev/looks-good-to-me/payouts',
  };
}

/**
 * Where a secret may be sent, or null for a name with no scope (not a credential). Each entry is { base } (that path
 * and below, on that origin: the course API) or { exact } (that one endpoint: the payout API, Sol review P2).
 */
export function scopeOf(name, cfg = config()) {
  const n = name.replace(/_PREV_\d+$/, '');
  if (n === 'TICKET' || n === 'ATTEMPT') return [{ base: cfg.apiBase }];
  if (n === 'PAYOUT_KEY') return [{ exact: cfg.payoutsUrl }];
  if (n === 'CUR_TASK' || /^TASK_[A-Z]+_\d+$/.test(n)) return [{ base: cfg.apiBase }, { exact: cfg.payoutsUrl }];
  return null;
}

const trimPath = (p) => p.replace(/\/+$/, '');
/** Parsed and normalized by WHATWG URL (default port dropped, dot segments resolved). */
export function inScope(url, spec) {
  try {
    const u = new URL(url);
    const p = new URL(spec.exact ?? spec.base);
    if (u.origin !== p.origin) return false;
    const want = trimPath(p.pathname);
    const got = trimPath(u.pathname);
    if (spec.exact) return got === want;
    return want === '' || got === want || got.startsWith(`${want}/`);
  } catch {
    return false;
  }
}

/** Percent-decodes until stable (any hex case, char by char), so an encoded secret is still seen (Sol review P1). */
export function decodeAll(s) {
  let cur = String(s ?? '');
  for (let i = 0; i < 5; i++) {
    const next = cur.replace(/%[0-9a-fA-F]{2}/g, (m) => {
      const c = String.fromCharCode(parseInt(m.slice(1), 16));
      return c;
    });
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** A regex matching v with each character either as itself or as %HH (hex in any case). */
function encodedSpan(v) {
  const hexCase = (h) => [...h].map((d) => (/[a-f]/i.test(d) ? `[${d.toLowerCase()}${d.toUpperCase()}]` : d)).join('');
  const part = (c) => {
    const lit = c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const code = c.charCodeAt(0);
    // %HH, or nested: %25HH, %2525HH … (each %25 is an encoded "%"; Sol re-review 2)
    return code < 128 ? `(?:${lit}|%(?:25)*${hexCase(code.toString(16).padStart(2, '0'))})` : lit;
  };
  return new RegExp([...v].map(part).join(''), 'g');
}

/** Why this request may not carry the secrets it holds to this URL, or null. */
export function scopeRefusal(target, outgoing, vars, cfg = config()) {
  const plain = decodeAll(outgoing);
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'string' || v.length < 4) continue;
    const scope = scopeOf(k, cfg);
    if (!scope || !(outgoing.includes(v) || plain.includes(v) || plain.includes(decodeAll(v)))) continue;
    if (!scope.some((p) => inScope(target, p))) return `secret {{${k}}} may go only to ${scope.map((p) => p.exact ?? `${p.base}/…`).join(' or ')}; this request would send it to ${new URL(target).host}. Nothing was sent`;
  }
  return null;
}

/** Replaces every vars value (raw and URL-encoded) with {{NAME}}. Longest values first. */
export function mask(text, vars = loadVars()) {
  let s = String(text ?? '');
  // Facts kept in the state file that are not secrets: masking them would hide data the rules compare.
  const PLAIN = /^(ACCOUNT_ON_FILE(_PREV_\d+)?|.*_AT(_PREV_\d+)?)$/;
  // Two names may hold one value (CUR_TASK and TASK_RUN_7): the per-task name wins, so a log line says which task
  // it touched; a current name wins over an old _PREV_ one.
  const rank = (k) => (/^TASK_[A-Z]+_\d+$/.test(k) ? 0 : /_PREV_\d+$/.test(k) ? 2 : 1);
  const pairs = Object.entries(vars)
    .filter(([k, v]) => !PLAIN.test(k) && typeof v === 'string' && v.length >= 4)
    .sort((a, b) => b[1].length - a[1].length || rank(a[0]) - rank(b[0]));
  for (const [k, v] of pairs) {
    for (const form of new Set([v, encodeURIComponent(v)])) s = s.split(form).join(`{{${k}}}`);
  }
  // a value hidden by other percent-encodings (char by char, mixed hex case): mask only that span, so the text around
  // it (JSON, a refusal) stays as it was (Sol re-review: decoding the whole text corrupted JSON)
  if (/%[0-9a-fA-F]{2}/.test(s)) for (const [k, v] of pairs) s = s.replace(encodedSpan(v), `{{${k}}}`);
  return s;
}

/** Every absolute URL in s keeps its scheme and host; its path, query and fragment become <redacted>. */
export const redactPaths = (s) => String(s ?? '').replace(/(https?:\/\/[^/\s"'\\]+)[/?#][^\s"'\\]*/g, '$1/<redacted>');

const sameUrl = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '') && x.search === y.search;
  } catch {
    return false;
  }
};
// The manual's guards ignore the query: /manual?x=1 is still a manual fetch that opens an attempt (Sol review B #3).
const samePath = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
};

/** Why this request may not be sent, or null. */
export function refusal({ method, url, caller }, cfg = config()) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'not a valid absolute URL';
  }
  const host = u.hostname.toLowerCase();
  if (!cfg.allowedHosts.includes(host)) return `host ${host} is not in ALLOWED_HOSTS (${cfg.allowedHosts.join(', ') || 'empty'})`;
  if (!LOCAL.has(host) && u.protocol !== 'https:') return 'only https is allowed outside localhost';
  if (cfg.denyUrls.some((d) => samePath(url, d))) return 'this URL is closed in this mode (DENY_URLS): a manual fetch would open a new attempt';
  if (cfg.manualOnce && cfg.manualUrl && samePath(url, cfg.manualUrl) && cfg.attemptOpenUntil > Date.now()) {
    return `the manual was already fetched and its attempt is open until ${new Date(cfg.attemptOpenUntil).toISOString()}; a new fetch would deal a new batch. Run journal.mjs status and continue`;
  }
  if (cfg.readOnly && method !== 'GET') return `READ_ONLY: ${method} is refused; only GET is allowed`;
  if (cfg.readOnly && !sameUrl(url, cfg.manualUrl)) return 'READ_ONLY: only the manual URL may be requested';
  if (caller === 'model' && method !== 'GET') return `the http tool sends GET only; writes go through the checked scripts in scripts/`;
  if (method !== 'GET' && !cfg.writeUrls.some((w) => sameUrl(url, w))) return `${method} to this URL is not in WRITE_URLS (${cfg.writeUrls.join(', ') || 'empty'})`;
  return null;
}

function log(cfg, record) {
  mkdirSync(cfg.logDir, { recursive: true });
  appendFileSync(join(cfg.logDir, 'requests.jsonl'), `${JSON.stringify(record)}\n`);
}

/**
 * The manual reply carries { attempt, manual }; the attempt token authorizes /parked, so it is a secret. It is saved
 * as ATTEMPT in the state file (earlier ones kept as ATTEMPT_PREV_<n>, so old logs stay masked) before anything is
 * logged or shown. Returns true when an attempt was captured.
 */
export function captureAttempt(rawText) {
  let attempt;
  let expires;
  try {
    ({ attempt, attemptExpiresAt: expires } = JSON.parse(rawText) ?? {});
  } catch {
    return false;
  }
  if (typeof attempt !== 'string' || attempt.length < 4) return false;
  const exp = typeof expires === 'string' && !Number.isNaN(Date.parse(expires)) ? { ATTEMPT_EXPIRES_AT: expires } : {};
  saveState({ ATTEMPT: attempt, ATTEMPT_SEEN_AT: new Date().toISOString(), ...exp, ...fromManual(rawText) });
  return true;
}

/**
 * The account on file and the key-check path of this attempt, from the manual text (manual 2026-11-16:
 * "The account on file is acct_…", "GET https://verify-s04.mega.dev/<path> with the header X-Payout-Key").
 */
export function fromManual(rawText) {
  let text = '';
  try {
    text = String(JSON.parse(rawText)?.manual ?? '');
  } catch {
    text = String(rawText ?? '');
  }
  const out = {};
  const acct = /account on file is (acct_[A-Za-z0-9]+)/i.exec(text)?.[1];
  if (acct) out.ACCOUNT_ON_FILE = acct;
  const path = /https:\/\/verify-s04\.mega\.dev\/([A-Za-z0-9_-]{8,})/.exec(text)?.[1];
  if (path) out.VERIFY_PATH = path;
  return out;
}

/**
 * Writes run-time secrets into the state file, before anything is logged, so they are masked as {{NAME}}. A name that
 * already holds another value keeps the old one as <NAME>_PREV_<n>, so old logs stay masked.
 */
export function saveState(pairs) {
  const file = STATE_FILE();
  let state = {};
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  for (const [k, v] of Object.entries(pairs)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || typeof v !== 'string') continue;
    if (state[k] && state[k] !== v && !k.endsWith('_AT')) {
      let n = 1;
      while (state[`${k}_PREV_${n}`]) n++;
      state[`${k}_PREV_${n}`] = state[k];
    }
    state[k] = v;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}

const maskHeaders = (h, vars) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, mask(v, vars)]));

/**
 * Sends one request through the checks. `url`, `headers` and `body` may hold {{NAME}} references.
 * Returns { ok, refused?, error?, status?, url (masked), body (masked), headers }. Never throws.
 */
export async function send({ method = 'GET', url, headers = {}, body, caller = 'script', signal } = {}, opts = {}) {
  const cfg = opts.cfg ?? config();
  let vars = opts.vars ?? loadVars();
  method = String(method).toUpperCase();
  const base = { time: new Date().toISOString(), run: cfg.runId, caller, method };
  let target = fillVars(url, vars);
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k, fillVars(v, vars)]));
  if (!Object.keys(h).some((k) => k.toLowerCase() === 'user-agent')) h['user-agent'] = USER_AGENT;
  let payload;
  if (body !== undefined && body !== null) {
    payload = fillVars(typeof body === 'string' ? body : JSON.stringify(body), vars);
    if (typeof body !== 'string' && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
  }

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    // every hop: a redirect never carries a secret past its scope either
    const why = refusal({ method, url: target, caller }, cfg) ?? scopeRefusal(target, `${target}\n${JSON.stringify(h)}\n${payload ?? ''}`, vars, cfg);
    if (why) {
      log(cfg, { ...base, hop, url: mask(target, vars), refused: why });
      return { ok: false, refused: why, url: mask(target, vars), body: '' };
    }
    let res;
    try {
      res = await fetch(target, { method, headers: h, body: payload, signal, redirect: 'manual' });
    } catch (e) {
      const error = mask(e?.cause?.message ?? e?.message ?? String(e), vars);
      log(cfg, { ...base, hop, url: mask(target, vars), reqHeaders: maskHeaders(h, vars), reqBody: payload === undefined ? undefined : mask(payload, vars), error });
      return { ok: false, error, url: mask(target, vars), body: '' };
    }
    let raw;
    try {
      raw = await res.text();
    } catch (e) {
      // the reply was cut (a timeout mid-body): the request did reach the server
      const error = mask(`reply cut: ${e?.cause?.message ?? e?.message ?? String(e)}`, vars);
      log(cfg, { ...base, hop, url: mask(target, vars), reqHeaders: maskHeaders(h, vars), reqBody: payload === undefined ? undefined : mask(payload, vars), status: res.status, error });
      return { ok: false, error, url: mask(target, vars), body: '' };
    }
    const isManual = res.status === 200 && cfg.manualUrl && samePath(target, cfg.manualUrl);
    if (isManual && captureAttempt(raw) && !opts.vars) vars = loadVars();
    // A script names the secrets a reply carries (task tokens, …); they are saved and masked before the log.
    if (opts.capture) {
      let pairs = {};
      try {
        pairs = opts.capture(raw) ?? {};
      } catch {}
      if (Object.keys(pairs).length) {
        saveState(pairs);
        if (!opts.vars) vars = loadVars();
      }
    }
    // A redirect's address may carry a token we hold no name for (real run 2: 307 to cdn-s04.mega.dev/<token>/payouts).
    // Keep only the host in what is logged, kept or returned; following a GET reads the real header below.
    const redirect = res.status >= 300 && res.status < 400;
    const text = mask(redirect ? redactPaths(raw) : raw, vars);
    // A script keeps the reply (the next task) before anything else can fail, so a crash right after a send never
    // leaves the next task unknown (Sol review A #1).
    if (opts.keep && res.status >= 200 && res.status < 300) {
      try {
        opts.keep(text);
      } catch {}
    }
    const resHeaders = maskHeaders(Object.fromEntries(res.headers), vars);
    if (redirect && resHeaders.location) resHeaders.location = redactPaths(resHeaders.location);
    log(cfg, {
      ...base,
      hop,
      url: mask(target, vars),
      reqHeaders: maskHeaders(h, vars),
      reqBody: payload === undefined ? undefined : mask(payload, vars),
      status: res.status,
      resHeaders,
      resBody: text,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      // A write is never sent twice: a redirect after a write is not followed, and the write counts as unclear
      // (it reached the server) — never "not sent" (Sol review B #2).
      if (method !== 'GET') return { ok: false, error: `redirect ${res.status} after a ${method}, not followed`, status: res.status, url: mask(target, vars), headers: resHeaders, body: text };
      target = new URL(res.headers.get('location'), target).href;
      continue;
    }
    if (isManual) {
      const dir = join(cfg.logDir, 'manual');
      mkdirSync(dir, { recursive: true });
      const stamp = base.time.replace(/[:.]/g, '-');
      writeFileSync(join(dir, `manual-${stamp}.txt`), `content-type: ${resHeaders['content-type'] ?? ''}\n\n${text}`);
    }
    return { ok: res.ok, status: res.status, url: mask(target, vars), headers: resHeaders, body: text };
  }
  log(cfg, { ...base, url: mask(target, vars), refused: 'too many redirects' });
  return { ok: false, refused: 'too many redirects', url: mask(target, vars), body: '' };
}
