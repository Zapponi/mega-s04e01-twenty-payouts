// why: prints the house notes (host-desk/why/*.md), the house rules a change is judged by. No network, no secrets.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WHY = join(dirname(fileURLToPath(import.meta.url)), '../../../why');
for (const f of readdirSync(WHY).filter((n) => n.endsWith('.md')).sort()) console.log(`=== why/${f}\n${readFileSync(join(WHY, f), 'utf8').trim()}\n`);
