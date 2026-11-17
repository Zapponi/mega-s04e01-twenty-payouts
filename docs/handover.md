# Handover — S04E01 Twenty payouts (2026-11-17 03:50 UTC / 00:50 BRT)

Objective: the payout-runner agent (Pi + vars/http/code, model `openrouter/anthropic/claude-haiku-5.5`) runs the batch of 20 payouts on its own, inside the time limit, and the claim is accepted (uuid c0000000-0000-4000-8000-0000005e04e1).

**Deadline: the ticket expires 2026-11-17 21:44 UTC = 18:44 BRT (today).** Real run nº 2 must happen before that.

## State

- **`main` = 77704a8** (PR #11 merged). Branch `8-run2` holds only the session notes and this file.
- Tests 82/82. The lab is green twice with the model. `check-flow --release` PASS.
- **Real run nº 1** (03:06 UTC) was refused: "Time ran out at task 2." The real limit is **6000 ms for the WHOLE batch** (`runLimitMs`), not per task.
  - check-lane `routine-script` was called and recorded in `logs/check-lane.jsonl`.
  - That run counts for nothing. A new manual fetch starts a new run.
- **The fix, merged:** `scripts/routine.mjs` runs the whole batch in one process, with the connection kept open.
  - A pace guard reads the practice of the same attempt. If 20 tasks would take more than 85% of 6 s, the run is not opened (exit 6).
  - `ROLE.md`: journal status → manual (only if no attempt is open) → check-key → `routine.mjs practice` → `routine.mjs run` (once) → `parked.mjs` → summary.
- **Rehearsal attempt:** open until 06:00:29 UTC; its run was refused. `MANUAL_ONCE` blocks a new manual fetch until then. After 06:00:29 UTC, `journal status` says "fetch the manual" and run nº 2 needs no code change.
- **Decided** (docs/decisions.md): run nº 2 waits until Giovanni wakes ("prefiro fazer amanha, preciso dormir").

## Run nº 2 — exact steps (after Giovanni's yes, with him at the Challenge page)

1. Check that the machine is idle: `free -g`, `uptime`, and no whisper process running.
2. Run `./verify`: unit 82/82 and M5 PASS.
3. Run `node host-desk/roles/payout-runner/scripts/journal.mjs status`. Expected: `attempt: none open`, and next: fetch the manual.
4. From `host-desk/roles/payout-runner`: `MODE=run ALLOW_RUN=1 MODEL=openrouter/anthropic/claude-haiku-5.5 RUN_ID=real-run2-<stamp> node run.mjs`, in the background, with a Monitor on `journal/journal.jsonl`.
5. Watch for `PACE TOO SLOW`. If it appears, the run was not opened: report it and stop.
6. Tell Giovanni once for each owner task (n and reason). He decides on https://hq.mega.dev/challenges/twenty-payouts.
7. If any refusal carries a `need` or `pointer`, call check-lane with it and add a line to `logs/check-lane.jsonl`.
8. Afterwards, run `./verify` in full (M1–M7) and `check-flow --release`, then `/verify`. Only then ask Giovanni's yes for `claim-challenge`, which cannot be taken back.

## Don't

- Call `start-challenge`.
- Fetch `/manual` by hand.
- Run `settle.mjs` on the run's tasks.
- Write code by heredoc.
- Run tests in parallel on a loaded machine. The machine must be idle on run day: the limit is 6 s for the whole batch.

## Return route

`t3_thread_send` (environmentId fbf717ef-3cea-41d0-a0a8-8ce0e41ae96c, threadId 7aadc61f-9297-4086-a010-8892c9410baa) with `[fim] S04E01 #8: <result | question | blocked>`.

## Read first

KEEP.md (top lines: the run-wide limit), BRIEF.md, docs/decisions.md, sessions/2026-11-17.md, lab/EXPECTED.md.
