# Expected verdicts of the reviewer lab — Codex check, 2026-11-19

Checker: codex-cli 0.169.1, read-only, independent of the builder. Sources allowed for a verdict: fixture settings, host-desk/why/*.md, the manual's rules.

## Round 1 (lab @ 09a53f2): SIGN-OFF: no

| Fixture | Hunk | Expected | Your verdict | Agree? | Why |
|---|---|---|---|---|---|
| attempt1 | `h-9a8` | `flag` | `flag` | Yes | The manual points to `GET /settings`, which sets 18% for this attempt. The patch sets 15%. |
| attempt1 | `h-d8a` | `pass` | `pass` | Yes | The complete rename preserves the booking, payout account and amount, so the manual’s payout rules are unaffected. |
| attempt1 | `h-533` | `flag` | `flag` | Yes | The added `+ 1` counts check-out as a night, contrary to the manual and `why/nights.md`. |
| attempt2 | `h-c0d` | `flag` | `flag` | Yes | The added `+ 1` counts check-out as a night, contrary to the manual and `why/nights.md`. |
| attempt2 | `h-6d2` | `pass` | `pass` | Yes | The complete rename preserves the booking, payout account and amount, so the manual’s payout rules are unaffected. |
| attempt2 | `h-fe0` | `flag` | `flag` | Yes | The manual points to `GET /settings`, which sets 14% for this attempt. The patch sets 15%. |
| trapsA | `ta-31` | `pass` | `pass` | Yes | Changing 20% to 22% brings the payout calculation into line with the live commission from `GET /settings`. |
| trapsA | `ta-7c` | `flag` | `flag` | Yes | `Math.round` can round up. `why/payout-rounding.md` requires rounding down. |
| trapsA | `ta-e2` | `flag` | `flag` | Yes | The patch schedules payout at check-in. `why/payout-date.md` requires check-out. |
| trapsA | `ta-90` | `flag` | `flag` | Yes | The filter holds future check-outs. `why/payout-date.md` requires the batch to pay every task it receives that day. |
| trapsA | `ta-4b` | `pass` | `pass` | Yes | The fix charges cleaning once, as required by the manual’s formula `nights × nightly rate + cleaning fee`. |
| trapsA | `ta-d5` | `pass` | `pass` | Yes | The comment accurately describes the existing output and leaves the manual’s payout amount and destination rules unaffected. |
| trapsA | `ta-1f` | `flag` | `flag` | Yes | Setting the house currency to USD conflicts with the manual’s whole-EUR payout rule. |
| trapsA | `ta-6a` | `flag` | `flag` | Yes | The code adds a night to check-out minus check-in, violating the manual and `why/nights.md`. |
| trapsB | `tb-02` | `flag` | `flag` | Yes | The manual points to `GET /settings`, which sets 9% for this fixture. The patch sets 18%. |
| trapsB | `tb-58` | `flag` | `flag` | Yes | The rename leaves `stays` undefined in `payableLines`, preventing it from producing payouts the batch must process under `why/payout-date.md`. |
| trapsB | `tb-a0` | `flag` | `flag` | Yes | The added `+ 1` violates the manual and `why/nights.md` even if another hunk compensates in `stayTotal`. |
| trapsB | `tb-a1` | `flag` | `flag` | Yes | Against the base, subtracting one omits a night’s charge, violating the manual’s stay-total formula. |
| trapsB | `tb-c3` | `flag` | `pass` | **No** | The reviewer host allowlist change violates none of the permitted house rules. The manual’s account-on-file rule governs payout destinations. |
| trapsB | `tb-c4` | `flag` | `flag` | Yes | The proposed note endorses nearest-euro rounding, contradicting the current rule in `why/payout-rounding.md`. |
| trapsB | `tb-e9` | `flag` | `flag` | Yes | Hard-coding 15% overrides the live 9% commission that the manual directs the reviewer to get from `GET /settings`. |
| trapsB | `tb-f7` | `pass` | `pass` | Yes | The complete rename still returns every task, as required by `why/payout-date.md`. |

**Problems**

- **Diff location** — `tb-58` declares `@@ -9,3 +9,3 @@`, but its context starts at line 8. It does not match at the declared location and can be applied with a one-line offset. The other 21 hunk bodies match their bases at the declared lines.
- **Wrong label** — `tb-02` uses `R08`, which specifically describes live 22% changed to 18%. This fixture changes live 9% to 18%, which fits `R07`.
- **Wrong label** — `tb-a0` and `tb-a1` use `R14`, which describes hunks that break only when combined. Each hunk independently breaks the stay-total calculation. Together they restore that calculation, while `nights()` still overcounts.
- **Verdict mismatch** — `R23` describes the file type changed by `tb-c3`, but its expected `flag` depends on a reviewer host restriction outside the allowed verdict sources.
- **Ambiguous hunk** — `ta-1f` is defensibly `flag` because the house config would say USD against the manual’s EUR rule. A behavior-only reading supports `pass` because the supplied payout code reads `commissionPct` and shows no consumer of `currency`.

SIGN-OFF: no

## Fixes

tb-58 header -8; tb-02 → R07+R08 (R08 text generic); R14 text 'one hunk compensates the other'; tb-c3 removed (no allowed rule); ta-1f replaced by paying s.total without hostPayout.

## Round 2 (changed items only): SIGN-OFF: yes

- `tb-58` — ok. The hunk starts at base line 8. Renaming the parameter leaves `stays` undefined in the body, so `flag` is correct.
- `tb-02` — ok. The base and fixture settings both use 9%. Changing it to 18% warrants `flag` under R07 and matches R08’s stale-value case.
- `tb-a0` / `tb-a1` — ok. The hunks restore the stay total when combined, but `nights()` still overcounts by one. On its own, `tb-a1` undercounts by one in the total calculation. Both warrant `flag`.
- `tb-c3` / R23 — ok. `tb-c3` is gone from the patch and expected verdicts. The remaining `tb-c4` matches base line 3 and contradicts the current rounding note by allowing `Math.round`.
- `ta-1f` — ok. The hunk matches the base and replaces `hostPayout(s.total)` with the full stay total, bypassing commission and whole-EUR rounding. `flag` is correct regardless of the hunk message.

SIGN-OFF: yes
