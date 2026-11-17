# scripts

Scripts the code tool runs live here. Each one gets the values from vars.json as environment variables. Every request goes through `lib/net.mjs`; each script sets its own write URLs.

| Script | What it does |
|---|---|
| `journal.mjs status` | where the attempt stands and the next step (no request) |
| `check-key.mjs` | the manual's pre-run GET on verify-s04 with X-Payout-Key; the path stays `{{VERIFY_PATH}}` |
| `start.mjs practice\|run` | opens a batch once per attempt (the run only with `ALLOW_RUN=1`) |
| `settle.mjs <batch> pay\|flag "<reason>"\|answer` | the current task: check, pay once, answer; or hand it to the owner |
| `parked.mjs` / `parked.mjs answer <n>` | owner tasks: reads /parked for ~110 s and finishes each decided task once |
| `open-practice.mjs` | § 2 only: opened the practice to see the task shape |
