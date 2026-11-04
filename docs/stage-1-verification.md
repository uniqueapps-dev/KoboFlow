# Stage 1 verification record: classification engine (`scopeOf`) and measures

- **Status:** Stage 1 implementation complete, including the Stage 1 completion (work packages
  WP1–WP8 of the owner-approved implementation plan, decisions Q1–Q10) and the I-4 correction. Under
  owner review. **Not yet accepted.** Stage 2 is not authorised.
- **Scope of this record:** evidence gathered during the Stage 1 review. It records results; it
  changes no code, test, build, deployment or Git history. It is separate from the Stage 0 acceptance
  record (`docs/stage-0-acceptance.md`).
- **Base:** branch `claude/koboflow-loan-management-qn2vql`, accepted Stage 0 commit `3359ae0`. All
  Stage 1 changes are uncommitted working-copy changes until the owner authorises a commit.

## Architecture decisions recorded during the Stage 1 review

The owner-approved Stage 1 review decisions (revision 9 of the A1–A12 wording, including the
corrected A6 wording and decision R-open, treatment 2) are recorded in
`docs/personal-money-separation-design.md`. The register is section 20.2a ("Stage 1 review: decisions,
deferrals and pending items"); sections 20.1 and 20.2 are unchanged.

## Full-suite investigation (intermittent failures)

### Earlier history (retained)

Recorded on the working copy that contained the Stage 1 engine and the R-open treatment-2 change.

| Run | Result | Failing test | Failure |
|---|---|---|---|
| Full suite, run 1 | 417 passed, 1 failed (418) | `tests/escaping.test.js`: "TEST build: an HTML-looking bill name is shown as text on every screen and never runs" | failed under full-suite load |
| Full suite, run 2 | 417 passed, 1 failed (418) | `tests/bills.test.js`: "TEST build: Opportunity Analysis and the Director apply the same working-capital floor once; no floor is stated plainly" | `page.click: Timeout 30000ms exceeded` waiting for `#setup-confirm-btn` |
| Full suite, run 3 | 418 passed, 0 failed | — | — |
| `tests/escaping.test.js` alone, 4 runs | 15 of 15 each run | — | — |
| `tests/bills.test.js` alone, 3 runs | 13 of 13 each run | — | — |
| Clean `3359ae0`, full suite, 1 run | 400 of 400 | — | — |

The two failures were in different tests. Both were waits for screen elements under full-suite
load, and both tests passed every isolated run.

### Six paired runs (accepted by the owner)

Frozen copies of clean `3359ae0` and of the current working copy (Stage 1 + treatment 2), run
alternately on the same machine:

| Pair | Clean `3359ae0` | Current working copy |
|---|---|---|
| 1 | 400/400 passed, 354 s | 418/418 passed, 353 s |
| 2 | 400/400 passed, 351 s | 418/418 passed, 345 s |
| 3 | 400/400 passed, 336 s | 418/418 passed, 361 s |

Per-test timings of the two tests that failed earlier, across the six runs:

| Test | Clean `3359ae0` | Current |
|---|---|---|
| Bills working-capital floor | 4.2–5.2 s | 4.9–5.3 s |
| Bill-name escaping | 4.6–5.2 s | 5.0–5.1 s |

Both are well within the 30-second limit. The slowest test in every run of both versions was the same
pre-existing loan-earmark test (about 38 s).

### Stage 1 refresh cost

The read-only Stage 1 summary card recalculates on every screen refresh (`renderAll`), even when the
INTEL screen is not shown. Each recalculation computes the full `financialMeasures` result, although
the card uses only the period classification totals and the entry list.

Measured cost per refresh:

| Entries | Cost per refresh |
|---|---|
| 12 (test-fixture size) | 0.19 ms |
| 500 | 1.8 ms |
| 3,000 | 7.8 ms |
| 10,000 | 25.3 ms |

### Conclusion

- The evidence does not implicate Stage 1 in the earlier failures. The failures did not recur in
  six paired runs, and timings were equal across the two versions.
- The earlier failures are recorded as unexplained intermittent timeouts under full-suite load. Their
  cause is not proven.
- No timeout, test or engine behaviour was changed in response.
- **Deferred (owner decision):** the card performance and lifecycle clean-up (calculate only what the
  card shows; recalculate only while the INTEL screen is visible). The card and its rendering
  lifecycle are unchanged.

## Stage 1 completion (WP1–WP8) and the I-4 correction

### What was completed

The coverage review found Stage 1 rows that were effective in Stage 1 but not implemented. The owner
approved an implementation plan, with decisions Q1–Q10, to complete them in Stage 1 rather than defer
them. After the completion, every row of register 20.2a that is effective in Stage 1 is implemented
and tested:

| Decision rows | Completed behaviour |
|---|---|
| P-D2, N1 | financing (loan receipts and the legacy capture) |
| N3a | external funding |
| N3b | owner contribution only with a stored agreement whose nature is checked; otherwise "source unconfirmed" |
| P-D3 | summary totals limited to income and expense |
| P-D6 | warnings kept and `shared_payer` |
| Q-N2 / N2 | income with a differing purpose is unresolved |
| P-D10 | separate Business and Shared figures |
| P-D11, P-D11b, P-D11e | repayment components and provisional repayments |
| P-D13, P-D13b | the three income measures |
| P-D15 | the two review figures |
| R-open | pre-opening parts for every Business and Shared figure |

Every deferred row stays deferred.

Repayment components are calculated at read time from the entry's stored allocation, and nothing is
stored. Rules:
- **Missing allocation (Q1):** the whole positive amount is provisional.
- **Invalid allocation (Q2):** the whole positive amount is provisional. Invalid means any of:
  - a raw component that is not a finite, non-negative number in whole kobo;
  - components above the payment;
  - an inconsistent stored `unsplit`;
  - a provisional allocation that claims a split.
- **Valid allocation:** the confirmed principal and finance cost are kept, and any remainder is
  provisional.
- **I-4 correction (approved plan 3.2):** a repayment whose amount is zero or negative (after the
  legacy `Number(amount) || 0` reading) has all components zero. It never creates a negative
  provisional amount and cannot reduce the conservative burn. Its stored amount still moves in the
  unchanged cash layer.

Not changed:
- `classifyTxn`, the cash layer, the Stage 0 backup, import and export behaviour, and every other
  screen;
- `DB_VERSION` (4), the backup format (1), and both `NEW_FINANCIAL_FORMAT` switches (off).

### Roadmap wording applied (owner decision Q10)

In `docs/personal-money-separation-design.md`:

| Location | Wording added |
|---|---|
| Section 23, Stage 2 scope | display of the income measures; the pharmacy cash burn with its Shared-account and provisional-repayment amounts separately identifiable; Financing and External funding shown apart from income and expense; display of the two P-D15 figures as separately counted figures. The capital-injection review action remains stage 3 (N3c). |
| Section 23, Stage 2 integrity risks | provisional repayments or Shared-account amounts dropped from, or counted twice in, the burn |
| Section 23, Stage 4 scope | the account's effective opening date also determines the pre-opening "of which" parts of the Business and Shared figures; the global baseline is used until stage 4 |
| Section 23, Stage 4 unit tests | pre-opening parts calculated separately for each account |
| Register 20.2a, row P-D15, Effective | "stage 1 (figures); displayed in stage 2; the capital-injection review action remains stage 3 (N3c)" |

### Verification results

All runs are on the working copy after the I-4 correction (`koboflow.html`, the regenerated
`koboflow-test.html` and `tests/stage1-scope.test.js`, each MD5-checked as unchanged across the runs).

| Run | Result |
|---|---|
| Baseline before the Stage 1 completion (full suite, frozen copy) | 418 / 418 passed, 0 skipped |
| `tests/stage1-scope.test.js`, 3 runs | 29 / 29 passed each run, 0 skipped |
| Stage 0: `tests/backup-format-guard.test.js`, 2 runs | 28 / 28 passed each run, 0 skipped |
| `tests/engine.test.js` | 78 / 78 passed |
| Full suite (`npm test`), run 1 | 429 / 429 passed, 0 failed, 0 skipped (340 s) |
| Full suite (`npm test`), run 2 | 429 / 429 passed, 0 failed, 0 skipped (326 s) |
| `node scripts/build-test-file.js --check` | up to date; `koboflow-test.html` byte-identical to `build(koboflow.html)` |

The Stage 1 browser tests, on the TEST build and the production candidate, check the following:

| Check | Result |
|---|---|
| Summary card equals the Node engine (entries, totals, separate lines, repayment components) | pass |
| In-page engine equals the Node engine | pass |
| Read-write IndexedDB transactions while rendering | 0 |
| Store snapshot before and after rendering (including `agreements`) | identical |
| `newFinancialFormat` | false |
| Every other screen's text against the accepted Stage 0 build (live and demo mode) | identical |
| Demo mode | shows no summary |
| Page errors | none |

The full suite grew from 418 to 429 tests. The additions are the 11 new Stage 1 tests: N-T1 to N-T10
and N-T4b, the I-4 correction. Superseded Stage 1 assertions were rewritten to the approved decisions,
which are named in the test file. No test was deleted or weakened, and no timeout was changed.

### Remaining limitations and deferred work

- Per-account effective opening dates (stage 4): the global baseline is used for the pre-opening parts
  until then.
- Displays (stage 2), as registered:
  - the income measures;
  - the burn, including provisional repayments;
  - Financing and External funding;
  - the two P-D15 figures.
- The capital-injection review action and explicit own-money capture (stage 3, N3c).
- Loan-purpose finance cost and the related "of which" lines (stage 6). Plan linkage (stage 7).
  Shared allocation (stage 5).
- The card performance and lifecycle clean-up remains deferred (owner decision).

