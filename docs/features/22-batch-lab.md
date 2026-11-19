# 22 · The payout runner runs the S04E02 batch correctly in the lab, before any real payout

Source: plan.md § 4; issue #22; `lab/CASES.md` B01–B28. The practice key (#19), the real batch (#20) and the claim (#21) are other issues.

## Outcome

Giovanni can point the payout runner at the S04E02 course and know, from the lab alone, that it:
- pays each plain task once, to the account on file, with the commission of that attempt's `GET /settings` taken off and rounded down;
- hands every other task to the owner and finishes it only after his decision on the hq page, including an `amount` he sets (pay it) or `0` (declined);
- never sends the payout key anywhere but `pay-s04.mega.dev`, never pays twice, never uses the reviewer's attempt, and stops at a refusal instead of working around it.

Before this issue the runner still pointed at S04E01 (`twenty-payouts`, no commission, no owner `amount`).

## Acceptance

- Owner's words: "No lab, o payout-runner passa todos os casos B01–B28 numa rodada sem modelo e em duas rodadas seguidas com o modelo: paga cada tarefa simples uma vez à conta cadastrada com a comissão do /settings da tentativa (arredondada para baixo), manda o resto ao dono e respeita o amount dele, nunca manda a chave fora do pay-s04 e nunca usa a tentativa do revisor." — Giovanni chose "Aceito o rascunho (Recommended)" for this text on 2026-11-19.
- Source: `docs/decisions.md` 2026-11-19 (issue #22 thread, question "Aceite #22").
- Receiver: Giovanni, for this lab step (AGENTS.md "Who decides": the agent decides the lab, the human decides the real batch). The course is the receiver of the real batch (#20), not of this issue.

## Done means

| Check | Shown by | Result |
|---|---|---|
| Unit tests pass | `node --test host-desk/roles/payout-runner/test/` | |
| Every batch case B01–B28 passes on a dry run (no model) | `./verify --lab` on the dry agent's output | |
| The same on two model runs in a row (Haiku 5.5, session count asked first) | `./verify --lab` on each run | |
| Batch sentences F11–F19, F21 of the adherence matrix pass | `./verify --adherence` | |
| No secret in repo, logs, journal, lab output | `./verify` S1 | |
| One review of the whole diff by another model family | `/sol-loop` + `review-mark.py` | |

## Premises

| Claim | Source and its scope | Target scope | Unit | Clock starts |
|---|---|---|---|---|
| Base `https://hq.mega.dev/challenges/looks-good-to-me`; payouts `https://pay-s04.mega.dev/looks-good-to-me/payouts` | `logs/s04e02/api-index.txt` (`run`, `payouts`); S04E02 only | every URL of the runner | none | n/a |
| "The host gets the stay total minus the house commission, in whole EUR. The house’s current settings: `GET /settings`." | manual of the attempt (`logs/s04e02/manual-*.json`); per attempt | `amountOf()`: `Math.floor(total × (1 − commissionPct/100))` | EUR | n/a |
| Payouts round down | `host-desk/why/payout-rounding.md` | same | EUR | n/a |
| `commissionPct` changes per attempt (18, 14 seen) | `logs/s04e02/settings-attempt1.json`, `logs/s04e02/attempt-*/`; per attempt | read `/settings` in the batch's own attempt, before `POST /run` | % | n/a |
| `/parked`: `amount` > 0 pay it; `amount` 0 → `done: "declined"`; no `amount`: on-file / new / decline; `null` read again | api-index `parked.decisions` | `parked.mjs` | EUR | n/a |
| "Keep each flagged task's token: finishing it needs that token." | api-index `run.keepToken` | flag → `/parked` finish | none | n/a |
| Practice: "no time limit: runLimitMs and timeLeftMs show a fixed value"; 3 tasks | api-index `practice` | practice only | ms | n/a |
| Run time limit: not in the index; S04E01 gave `runLimitMs: 6000` for the whole batch of 20 | KEEP.md (S04E01 real run, 2026-11-17); **S04E01 scope, not S04E02** | the deadline is read from the first run task, never assumed | ms | the reply that opens `POST /run` (S04E01 evidence) |
| The manual asks for a key check at `verify-s04.mega.dev` | manual; contradicted by S04E01 evidence (`check-lane payout-run`, real run 4 accepted without it) | not done (BRIEF "Left out on purpose", case B23) | none | n/a |
| Each `GET /manual` opens a new attempt with its own account on file, ~3 h | api-index `next`; manual `attemptExpiresAt` | the batch fetches its own manual; the reviewer's `ATTEMPT` in `vars.json` is never used | h | the `GET /manual` reply |

## Receiver receipt

- State: pending
- Evidence: _none yet; the lab result and Giovanni's look at it go here._

## Easy to miss

- `vars.json` still holds the reviewer's `ATTEMPT`; today `loadVars()` lets it override the runner's own state. B09 tests that the batch uses its own.
- `/settings` must be read in the batch's attempt: the reviewer's attempt had 14 %, the first one 18 %.
- An owner `amount` is paid as given, not recomputed; `amount: 0` is a decline, not a payout of 0.
- The S04E01 pace guard assumes 6000 ms (`RUN_BUDGET_MS`); S04E02 may differ. The deadline comes from the first task.
- Do not edit files while a lab run is going (it broke R29 in reviewer run 3).

## Not proven yet

- The real S04E02 run limit, the real `/parked` shape with `amount`, and the real refusal shapes: only the practice (#19) and the real batch (#20) show them.
- B23 (no `verify-s04` check) rests on S04E01 evidence against an S04E02 manual line. If the course refuses for it, the decision goes back to Giovanni.
