# 6 · The agent can run the whole payout day on its own, owner tasks included

Source: plan.md § 3; issue #6.

## Outcome

The payout-runner, started with `MODE=run ALLOW_RUN=1`, can do the whole day in one attempt with no one typing:
- read where it stands (`journal.mjs status`);
- fetch the manual once;
- check the payout key;
- do the practice, then the run;
- hand each task that is not a plain payout to the account on file to the owner;
- finish each owner task only after Giovanni's decision shows in `/parked`;
- end with a summary.

After a crash, a new session picks up where the journal says. It never fetches the manual again, never opens a batch twice and never pays twice.

## Done means

| Check | Shown by | Result |
|---|---|---|
| Every case of plan.md § 3 passes, with no model and no outside host | `node --test host-desk/roles/payout-runner/test/*.test.mjs` | match: 50 pass, 0 fail (2026-11-16) |
| `parked.mjs`: on-file, new (structured field only), decline, null → wait; decision journaled before the first write | core.test.mjs: owner wait, decision ×3, twice, late payout, conflicting decisions, account from text | match |
| `check-key.mjs`: GET verify-s04 with X-Payout-Key; the path is never printed | core.test.mjs "check-key" | match |
| Manual fetched once per attempt; restart continues at task 8; nothing paid twice | core.test.mjs "restart" ×2, "manual is fetched once" | match |
| `MODE=run` only with `ALLOW_RUN=1` | core.test.mjs "run.mjs MODE=run refuses" | match |
| `./verify` M1–M4, M6 and M7 are computed from the log, the journal and the manual, and each catches its fault | proof.test.mjs (a clean run passes; one fault per check fails) | match |

## Easy to miss

- After a flag, the next task's token replaces CUR_TASK. Each token is also kept as `TASK_RUN_<n>`, and each task body as `scripts/state/task-run-<n>.json`, so `/parked` can finish the task later.
- A refusal's shape is not known yet. Any of these counts as a refusal: a `need`, a status `refused`/`rejected`/`denied`, or a 4xx reply. The task is stopped, journaled with its need, and never retried.
- `logs/check-lane.jsonl` gets one `{ need, time, result }` line for each check-lane call the harness makes. M7 reads it.

## Not proven yet

- No model run of `ROLE.md`. The real API was not touched (no paid call was allowed in #6). The lab (#7) runs it against the fake.
- The real shape of `/parked`, of the POST /parked reply, of a refusal, and of a whole-run deadline (if any). The fake follows the index. M2 checks each task against the `timeLeftMs` it showed.
- `./verify`: M1–M4, M6 and M7 fail until the real batch runs (no run in the log).
- M5 now also searches for VERIFY_PATH and the task tokens. Three old local logs from the slice-1 run of attempt nº 1 held the raw path. They were re-masked with Giovanni's yes, one replacement per file, and M5 passes (2026-11-16).
