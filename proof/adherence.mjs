// proof/adherence: how well the work holds to the official statement. It parses lab/CASES.md (one source: the
// matrix "frase oficial → casos" and the Fonte column of each case), then marks each official sentence F1–F22:
// PASS when every O/E case under it passes, FAIL when one fails, PENDING when one has no result yet.
// I cases (our inference) never count here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

/** { sentences: [{ id, text, cases }], source: Map(caseId → 'O'|'E'|'I') } from lab/CASES.md. */
export function parseCases(root) {
  const md = readFileSync(join(root, 'lab/CASES.md'), 'utf8').split('\n');
  const sentences = [];
  const source = new Map();
  for (const line of md) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (/^F\d+$/.test(c[0])) sentences.push({ id: c[0], text: c[1], cases: (c[2].match(/\b[RB]\d+[a-z]?\b|real R3/g) ?? []).map((x) => (x === 'real R3' ? 'R3real' : x)) });
    else if (/^[RB]\d+[a-z]?$/.test(c[0]) && c.length >= 6) {
      const f = c.at(-1);
      source.set(c[0], /^\s*I\b/.test(f) ? 'I' : /^\s*E\b/.test(f) && !/\bO\b/.test(f) ? 'E' : 'O');
    }
  }
  source.set('R3real', 'E');
  return { sentences, source };
}

/**
 * results: Map(caseId → { ok, detail, from }) gathered by ./verify from the lab runs and the real logs.
 * Returns rows [{ id, status, text, detail }] and the counts.
 */
export function adherence(root, results) {
  const { sentences, source } = parseCases(root);
  const rows = sentences.map((s) => {
    const counted = s.cases.filter((c) => source.get(c) !== 'I');
    const marks = counted.map((c) => {
      const r = results.get(c);
      return { c, st: !r ? 'PENDING' : r.ok ? 'PASS' : 'FAIL', from: r?.from };
    });
    const status = !counted.length ? 'FAIL' : marks.some((m) => m.st === 'FAIL') ? 'FAIL' : marks.some((m) => m.st === 'PENDING') ? 'PENDING' : 'PASS';
    const detail = counted.length ? marks.map((m) => `${m.c} ${m.st}${m.from ? ` (${m.from})` : ''}`).join(', ') : 'no O/E case measures this sentence';
    return { id: s.id, status, text: s.text, detail };
  });
  const count = (st) => rows.filter((r) => r.status === st).length;
  return { rows, pass: count('PASS'), fail: count('FAIL'), pending: count('PENDING'), total: rows.length };
}
