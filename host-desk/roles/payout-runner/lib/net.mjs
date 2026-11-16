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

export function config(env = process.env) {
  return {
    allowedHosts: String(env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    readOnly: env.READ_ONLY === '1',
    manualUrl: env.MANUAL_URL ?? '',
    // Writes (any method but GET) are allowed only to these exact URLs, set per run or per script.
    writeUrls: String(env.WRITE_URLS ?? '').split(',').map((w) => w.trim()).filter(Boolean),
    logDir: env.LOG_DIR ? resolve(env.LOG_DIR) : join(ROOT, 'logs'),
    runId: env.RUN_ID ?? '',
  };
}

/** Replaces every vars value (raw and URL-encoded) with {{NAME}}. Longest values first. */
export function mask(text, vars = loadVars()) {
  let s = String(text ?? '');
  const pairs = Object.entries(vars).filter(([, v]) => typeof v === 'string' && v.length >= 4).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of pairs) {
    for (const form of new Set([v, encodeURIComponent(v)])) s = s.split(form).join(`{{${k}}}`);
  }
  return s;
}

const sameUrl = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '') && x.search === y.search;
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
  try {
    attempt = JSON.parse(rawText)?.attempt;
  } catch {
    return false;
  }
  if (typeof attempt !== 'string' || attempt.length < 4) return false;
  saveState({ ATTEMPT: attempt, ATTEMPT_SEEN_AT: new Date().toISOString() });
  return true;
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
    if (state[k] && state[k] !== v && !k.endsWith('_SEEN_AT')) {
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
    const why = refusal({ method, url: target, caller }, cfg);
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
    const raw = await res.text();
    const isManual = res.status === 200 && cfg.manualUrl && sameUrl(target, cfg.manualUrl);
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
    const text = mask(raw, vars);
    const resHeaders = maskHeaders(Object.fromEntries(res.headers), vars);
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
