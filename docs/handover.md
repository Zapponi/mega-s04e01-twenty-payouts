# Handover — S04E02 Looks good to me, slice 2: the batch (2026-11-19 02:25 UTC)
Objective: one S04E02 payout batch passes (the "done" half still open); the reviewer half is done and accepted. Then the claim (uuid c0000000-0000-4000-8000-0000005e04e2).
Deadline: ticket expires **2026-11-20 00:03 UTC**; plan: real batch starts by 2026-11-19 20:00 UTC, claim by 23:30 UTC.
Decisions (docs/decisions.md, 2026-11-18/19): same repo, branch per issue off `s04e02-reviewer`; model = Claude subscription in Pi (`anthropic/claude-haiku-5-5`, token in `~/.pi/agent/anthropic-oauth-token`); no `verify-s04` key check (S04E01 refusal); amount = `Math.floor(total × (1 − commissionPct/100))` with commission from `GET /settings` of the same attempt; I-cases never count for adherence.
Current state:
- Slice 1 PASS on the real course: "Review accepted: every verdict is right." (logs/s04e02/review-real-*.json); `./verify --slice 1` PASS; issues #16 #17 #18 closed. Branch `s04e02-reviewer` @ dc25852 (pushed) holds everything.
- Adherence (`./verify --adherence`): reviewer sentences now pass with model runs; all batch sentences (F14–F19, F21, part of F11–F13, F20, F22) PENDING.
- Open issues: **#22** (batch in the lab, plan.md § 4, this thread's work), #19 practice key (waits on Giovanni), #20 yes for the real batch + owner tasks (Giovanni), #21 claim (Giovanni, course).
- `host-desk/vars.json` has TICKET and ATTEMPT (the accepted review's attempt — the batch must NOT use it: plan § 4 "state ATTEMPT wins"); no PAYOUT_KEY yet.
Done when (BRIEF.md proof): R1 ✔ R2 ✔ R3 ✔ S1 ✔ (reviewer) · B1 ✘ B2 ✘ B3 ✘ B4 ✘ B5 ✘ · S2 ✘ (batch part).
Open questions for Giovanni: the practice key (secret card, #19) before the practice; the yes for the real batch with its scope (#20); the yes for the claim (#21).
Approvals (BRIEF.md "Outside actions approved"): GitHub in this repo; lab model runs (39 used for the reviewer; batch lab runs need a new count, ask first); new attempts; practice (POST /practice, practice payouts). NOT approved: POST /run, real payouts, POST /parked, the claim.
Return route: report in this new thread to Giovanni; nothing to send back.
Next 3 steps:
1. AGENTS.md "After the first slice lands": write `docs/features/22-batch-lab.md` (kit `_template.md` at ~/Projects/zapponi/mega-agent-kit/project/docs/features/) and get Giovanni's Acceptance in his words before code.
2. Branch `22-batch-lab` off `s04e02-reviewer`; plan.md § 4 in order; `lab/CASES.md` B01–B28 are the cases (B23 conflicts with the manual on purpose, see its note).
3. Dry lab first, then ask for the model session count; then #19 key → practice → ask #20.
Read first: KEEP.md, BRIEF.md, plan.md § 4–6, lab/CASES.md (batch part + matrix), docs/reviews/2026-11-18-plan.md (Claude items 1, 5, 6; Codex 6, 7, 9), host-desk/roles/payout-runner/ (ROLE.md, scripts/routine.mjs, start.mjs, parked.mjs, lib/), lab/mock-api.mjs, lab/EXPECTED.md.
Don't:
- Don't edit files while a lab run is going (it broke R29 in reviewer run 3).
- Guards that merge state must read the current state at write time (parallel reads lost one: KEEP.md).
- Never `cat` vars.json; never call start-challenge; never send the payout key to verify-s04.
- The S04E01 run limit was 6000 ms for the WHOLE batch; read `runLimitMs` from the first task.
