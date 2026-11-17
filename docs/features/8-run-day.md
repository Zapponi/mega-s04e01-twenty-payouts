# 8 · Giovanni can start the real batch knowing every pre-run check passed

Source: plan.md § 5, § 6; issue #8. This file covers the part before the clock; the run itself waits on Giovanni's window (#2) and his yes.

## Outcome

The code that runs the real batch is in `main`. It was:
- reviewed by another model family;
- verified by an independent agent;
- rehearsed against the real practice of the course API on 2026-11-17.

Every pre-mortem row in `BRIEF.md` has a result. `check-flow --release` passes.

## Done means

| Check | Shown by | Result |
|---|---|---|
| Cross-family review of the whole change | `/sol-loop`: 2 × codex gpt-6.1-sol and 1 re-review; PR #9 body; `kit/review` | match: 12 blocking findings fixed (6eb82df, 26f41e8) |
| Independent verification before the merge | verifier: "Verdict: done"; PR #9 merged (66edde4) | match |
| The real API still answers as the code expects | `docs/rehearse/2026-11-17-practice.md` | match: manual, key check, practice 3/3 (1.8–4.0 s per task) |
| Every pre-mortem row has a result | `BRIEF.md` "Pre-mortem"; `check-flow --release` PASS | match |
| The real batch: `./verify` exit 0 against the course's replies | `./verify` after the run | waits on #2 and Giovanni's yes |

## Easy to miss

- The run-day attempt is a new one: one `GET /manual` fetch opens it, with its own account on file. A restart within those 3 h never fetches the manual again (`MANUAL_ONCE`).
- The machine must be idle during the run: under load everything gets about 10× slower, and the limit is 8 s per task.
- Owner tasks: the harness watches `journal status` and tells Giovanni once per task. If a refusal with a `need` comes, the harness calls `check-lane`.

## Not proven yet

- The real shapes of `/parked`, the reply to a flag, a refusal, and any run-wide deadline. Only the run shows them. The agent stops with `INCOMPLETE` instead of guessing.
- The two last review fixes are tested but were not reviewed again: the loop ended by its rule.
