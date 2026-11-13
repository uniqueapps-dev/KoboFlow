# Stage 1 verification record: classification engine (`scopeOf`) and measures

- **Status:** Stage 1 implementation complete, including the Stage 1 completion (work packages
  WP1–WP8 of the owner-approved implementation plan, decisions Q1–Q10), the I-4 correction and the
  I-2 revision (P-D13c). **Accepted** by the owner (source `3bdacf3`, TEST deployment `97e3342`); the
  acceptance is recorded in `docs/stage-1-acceptance.md`. Stage 2 implementation is not yet
  authorised.
- **Scope of this record:** evidence gathered during the Stage 1 review. It records results; it
  changes no code, test, build, deployment or Git history. It is separate from the Stage 0 acceptance
  record (`docs/stage-0-acceptance.md`).
- **Base:** branch `claude/koboflow-loan-management-qn2vql`.
  - The Stage 1 work starts from the accepted Stage 0 commit `3359ae0`.
  - The Stage 0 acceptance record is commit `1ccb369`.
  - The Stage 1 implementation (completion WP1–WP8 and the I-4 correction) is preserved in commit
    `ff6e626`, a checkpoint, **not** Stage 1 acceptance.
  - The I-2 revision (P-D13c) and this record's revision 4 updates were committed and pushed in commit
    `ddd6be56deef04839c7fb536d296e0fd110e4c22` (parent `ff6e626`).
  - Neither `ff6e626` nor `ddd6be5` constituted Stage 1 acceptance. The direct browser tests were added
    in `3bdacf3`. **Stage 1 was accepted at `3bdacf3`**, deployed to TEST as `97e3342`
    (`docs/stage-1-acceptance.md`).

## Architecture decisions recorded during the Stage 1 review

The owner-approved Stage 1 review decisions are recorded in `docs/personal-money-separation-design.md`.
The register is section 20.2a ("Stage 1 review: decisions, deferrals and pending items"); sections 20.1
and 20.2 are unchanged.
- They were applied as the A1–A12 replacement wording at **revision 9 of that wording set**, including
  the corrected A6 wording and decision R-open, treatment 2.
- Revision 9 is the revision of the A1–A12 wording, not of the design document. The design document
  remains at revision 6, with these amendments recorded in its status block.
- P-D13c was added later (section 20.2a; commit `ddd6be5`).

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
| P-D13, P-D13b (revised by P-D13c) | the three income measures |
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

### Owner decisions I-1 and I-2 (after the Stage 1 checkpoint `ff6e626`)

- **I-1, confirmed: the strict rule is retained.** Only a capital injection whose stored agreement has
  the nature "capital injection (own money)" is an owner contribution. Every other Outside → Business
  movement remains an unresolved account movement unless its nature is established. No code change was
  needed.
- **I-2, revised: register row P-D13c, revising the first clause of P-D13b.** Income with no receiving
  account is classified by a valid, reconciling split or an explicit pharmacy or personal purpose, with
  its `missing_source` warning kept. Without either it is unresolved income, and no vehicle default
  applies.
  - **Cash:** classification is separate from cash. No account is assigned, and the income is in no
    balance, confirmed pharmacy cash, held unresolved inflows or runway cash until a receiving account
    is recorded.
  - **Warning:** the `missing_account` data-quality warning stays active until then.
  - **"Of which" figures:** two new figures, `pharmacyReceiptsNoReceivingAccount` and
    `personalIncomeNoReceivingAccount`, are informational subdivisions of their parent income figures,
    never additional income and never added to any total.
  - **Reconciliation:** editing the original entry to add its receiving account keeps the entry's
    identity, so its income is counted exactly once. The existing rules then apply: a differing
    confirmed ownership gives unresolved income (N2), and a Shared account needs a valid split
    (rule 3).
  - **Known limit:** a separate second entry recorded for the same money is **not** detected in
    Stage 1 and can be counted twice. Its detection (possible-repeat matching that treats a missing side
    as matching any account, and linking during reconciliation) is **deferred to stage 3** and recorded
    in the stage 3 scope.
- **Code:** the change is confined to `scopeSingle`, `scopeTotals` and `financialMeasures`. The card
  layout is unchanged; the new figures are displayed in stage 2.
- **Tests:** the 5.2 truth table, N-T7 and N-T10 were updated (with the old expectations in comments).
  The new N-T7b was added. Before the engine change, all four were shown to fail against `ff6e626` for
  the expected reason, and they pass after it.

### Verification results

All runs are on the working copy after the I-2 revision (`koboflow.html`, the regenerated
`koboflow-test.html` and `tests/stage1-scope.test.js`, each MD5-checked as unchanged across the runs).
Those three files were committed unchanged in `ddd6be5`.

| Run | Result |
|---|---|
| Baseline before the Stage 1 completion (full suite, frozen copy) | 418 / 418 passed, 0 skipped |
| `tests/stage1-scope.test.js`, 3 runs | 30 / 30 passed each run, 0 skipped |
| Stage 0: `tests/backup-format-guard.test.js`, 2 runs | 28 / 28 passed each run, 0 skipped |
| `tests/engine.test.js` | 78 / 78 passed |
| Full suite (`npm test`), run 1 | 430 / 430 passed, 0 failed, 0 skipped (332 s) |
| Full suite (`npm test`), run 2 | 430 / 430 passed, 0 failed, 0 skipped (325 s) |
| `node scripts/build-test-file.js --check` | up to date; `koboflow-test.html` byte-identical to `build(koboflow.html)` |

The Stage 1 browser tests, on the TEST build and the production candidate, check the following. They
run on a fixed browser seed, which contains **no income without a receiving account**:

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

Income with no receiving account (P-D13c) is verified in **Node** by N-T7b, N-T7, N-T10 and the 5.2
truth table, against the engine block loaded from `koboflow.html`, which is the same code the page
runs. There is **no direct browser test** of account-less income. Browser parity is demonstrated for
the seeded data only.

The full suite grew from 418 to 430 tests. The additions are the 12 new Stage 1 tests: N-T1 to N-T10,
N-T4b (the I-4 correction) and N-T7b (P-D13c). Superseded Stage 1 assertions were rewritten to the approved decisions,
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
- Reconciliation of income with no receiving account, and detection of a separate second entry for
  the same money (stage 3, P-D13c). Until then such a second entry can be counted twice. The
  account-less entry stays visible through the `missing_account` warning, its `missing_source` flag and
  the "of which" figures.
- Loan-purpose finance cost and the related "of which" lines (stage 6). Plan linkage (stage 7).
  Shared allocation (stage 5).
- The card performance and lifecycle clean-up remains deferred (owner decision).

