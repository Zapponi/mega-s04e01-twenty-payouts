# 4 · Anyone reading the project uses the same words as the code

## Outcome

A person or an agent opening this repo can look up each term the code, tests and notes use (attempt, practice, run, owner task, decision, receipt, refusal, secret scope, ticket) in `BRIEF.md` "Glossary", with the source each meaning came from.

## Done means

| Check | Shown by | Result |
|---|---|---|
| BRIEF.md has a glossary with a source per term | `BRIEF.md` "## Glossary" | match |
| The brief has no placeholders | `node ~/src/mega-agent-kit/scripts/check-brief.mjs` → PASS | match |
| The pre-mortem rows use the real calls | `BRIEF.md` "Pre-mortem", Result column filled; the "inside the time limit" row corrected to 6000 ms for the whole batch (it still said 8 s per task) | match after the fix |
| The four proof changes are approved | `docs/decisions.md` 2026-11-16 ("2 - aprovo") | match |

## Easy to miss

- The run's time limit is for the whole batch (6000 ms), not per task like the practice (8000 ms). That was the cause of real run nº 1's refusal.
- The ticket and the payout key each have a fixed scope. A document never widens it.

## Not proven yet

- Nothing.
