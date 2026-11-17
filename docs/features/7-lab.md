# 7 · The agent is proven, with the real model, against a local stand-in for the course API and its traps

Source: plan.md § 4; issue #7; expectations in `lab/EXPECTED.md`, written before any lab run.

## Outcome

Giovanni can watch the payout-runner do a whole payout day on its own against `lab/mock-api.mjs`, with the real model and nothing real touched. `./verify --lab` then judges it from the mock's own record. The day includes:
- the practice and 20 tasks;
- 4 owner tasks, each decided 5 min after its flag;
- text that asks for another account;
- an account one letter off the account on file;
- a slow payout and a short deadline;
- a refusal with a `need`;
- the agent killed after task 7.

## Done means

| Check | Shown by | Result |
|---|---|---|
| `./verify --lab` exits 0 on two consecutive model runs | lab runs 2026-11-17T01-10-29 (run 2) and 01-16-59 (run 3) | run 2: exit 0. Run 3: every lab check passed. Its first `./verify --lab` exited 1 on one unit test that failed once and did not fail again in 19 runs; after a test-timing fix, `./verify --lab` on the same run exits 0 |
| The lab catches a broken agent, not only a good one | `test/lab.test.mjs` (each lab check fails on its fault) | match |
| A run with a defect fails | lab run 1 (01-01-38): the agent could not see the open task after the restart → L.M1 failed → fixed in 3ec2658 | match |

## Easy to miss

- The scripted agent (`lab/dry-agent.mjs`) proves the mock, the runner and the checks, never the model. It has no judgement of its own: `settle` decides, in code.
- The task in flight at the kill is reported, not graded. In runs 2 and 3 it took 4.8 s, inside 8 s anyway.

## Not proven yet

- The real shapes of `/parked`, of a refusal, of the reply to a flag, and of a whole-run deadline. The mock follows the index. `journal status` reports `INCOMPLETE` instead of guessing.
- The lost payout reply (timeout). It is covered by unit tests only, because in this API it ends the batch (`lab/EXPECTED.md`).
- `check-lane` on a real `need`: only the harness can call it.
