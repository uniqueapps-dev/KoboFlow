# Stage 1 acceptance record — central financial classification engine

- **Decision:** Stage 1 of the Personal Money Separation architecture
  (`docs/personal-money-separation-design.md`, sections 5, 6, 12.1 and 23) is **accepted** by the
  owner. The owner recorded this in the KoboFlow Stage 2 Implementation Brief and Acceptance
  Specification v1.0 (13 November 2026): "Accepted following source review, automated testing and
  Android acceptance on the isolated TEST deployment."
- **Scope of this record:** Stage 1 only. It records evidence; it changes no code, test, build,
  deployment or Git history. Stage 2 is specified separately (Brief v1.0) and is not part of this
  record. Its implementation awaits the owner's authorisation of the reconciled Stage 2 plan.

## Source and deployment checkpoints

| Item | Value |
|---|---|
| Source repository | `uniqueapps-dev/KoboFlow` |
| Feature branch | `claude/koboflow-loan-management-qn2vql` |
| **Accepted Stage 1 source commit** | `3bdacf30f1ffbe257b324534ee9c1153c1e04651` ("test: direct browser coverage of account-less income (P-D13c)") |
| Stage 1 implementation history | `ff6e626` (implementation checkpoint), `ddd6be5` (I-2 / P-D13c revision and verification record), `2220a01` and `36852f8` (documentation), `3bdacf3` (browser tests) |
| TEST Pages repository | `uniqueapps-test/uniqueapps-test.github.io` |
| **TEST deployment commit** | `97e33422068e3862377e34def4d707345b894557` (GitHub Pages "pages build and deployment" run 10, conclusion success) |
| TEST site build record | `SOURCE.json`: `sourceCommit` `3bdacf3…`, `sourceInputsCommitted: true`, `newFinancialFormat: false`, database `KoboFlowDB-test`, cache prefix `koboflow-test-` |
| Application version | 3.2.0 |
| Database version | 4, unchanged |
| Backup format | 1 (export); the Stage 0 reader guard reads up to format 2 and refuses format 2 while the switch is off |
| Financial-format switches | `NEW_FINANCIAL_FORMAT = false` in production (`koboflow.html`) and in TEST (`koboflow-test.html`) |
| Production | not deployed; production `main` (`2f4ab03`) and `develop` (`e5e9f69`) untouched |

## What Stage 1 delivered

- **The classification engine** (`scopeOf`): one result per live entry, as an exact partition in
  kobo into pharmacy, personal and unclassified parts. Loan repayments are classified by components.
  Implemented decisions:

  | Area | Decisions |
  |---|---|
  | Financing and funding | financing (P-D2, N1); external funding (N3a); owner contribution only with a checked own-money agreement, fail-safe otherwise (N3b) |
  | Repayments | repayment components with provisional amounts (P-D11, P-D11b, P-D11e; owner decisions Q1, Q2, I-4) |
  | Warnings and income | payer warnings and `shared_payer` (P-D6); income rules (P-D13, P-D13b as revised by P-D13c; Q-N2 / N2) |
  | Figures and summary | separate Business / Shared / other figures with pre-opening parts (P-D10, R-open); the two review figures (P-D15); summary totals (P-D3) |

- **The obligation router** (read-only, P-D14, P-D16).
- **The measures table** (section 6) as one function, `financialMeasures`.
- **A read-only summary card** on the INTEL screen. It stores nothing, and no other screen uses the
  measures yet (that is Stage 2).
- **Owner decisions** recorded in register 20.2a: I-1 confirmed (strict rule); I-2 revised as
  P-D13c.
- **Unchanged:** `classifyTxn`, the cash layer, the Stage 0 backup guard, import and export, and
  every other screen.

## Automated evidence (recorded at `3bdacf3`)

| Check | Result |
|---|---|
| Full test suite (`npm test`) | 436 passed, 0 failed, 0 skipped (three runs: two before the TEST deployment and one immediately before publishing) |
| Stage 1 tests (`tests/stage1-scope.test.js`) | 30 passed, 0 failed, 0 skipped |
| Account-less income browser tests (`tests/stage1-accountless-browser.test.js`) | 8 passed: TEST build, production candidate, and the exact built TEST-site files |
| Stage 0 tests (`tests/backup-format-guard.test.js`) | 28 passed, 0 failed, 0 skipped |
| Engine tests (`tests/engine.test.js`) | 78 passed |
| TEST build-sync check (`node scripts/build-test-file.js --check`) | up to date; `koboflow-test.html` byte-identical to `build(koboflow.html)` |
| Published artifact | built from a fresh, clean clone of `3bdacf3`; every `SOURCE.json` input hash matches the source blob and every output hash matches the published file; manifest, service worker and icons unchanged from the Stage 0 deployment |
| Read-only guarantee (browser, both builds) | summary card equals the Node engine; 0 read-write IndexedDB transactions while rendering; identical store snapshots; every other screen's text identical to the accepted Stage 0 build; no page errors |

The detailed record, including the full-suite investigation history and the revisions, is in
`docs/stage-1-verification.md`.

## Manual Android evidence

The owner carried out the Android acceptance review on the deployed TEST site, using the Stage 1
Android acceptance checklist and its fictional fixtures (the review fixture imported only in an
Incognito tab), and then accepted Stage 1.

**What this record does and does not show:**
- The item-by-item device results are retained by the owner. They are not reproduced in this
  repository.
- Live HTTP access to the TEST site was not available from the implementation environment, whose
  network policy denied the host. Live behaviour was therefore verified by the owner on the device,
  not by the implementation agent.
- Database writes were not independently measured on the Android device. The zero-write evidence
  comes from the automated browser tests on disposable Chromium profiles.

## Known limitations at acceptance (all recorded and deferred)

- **Duplicate second entry:** a separate second entry recorded for the same money as an account-less
  income entry is not detected and can be counted twice. Reconciliation and detection are stage 3
  (P-D13c).
- **Purpose or split while the switch is off:** income with a purpose or split cannot be created or
  edited on a switch-off site, because the Stage 0 gate refuses new-format fields. Those cases are
  verified by the automated tests.
- **Opening dates:** per-account effective opening dates are stage 4. The global baseline is used for
  the pre-opening parts.
- **Displays:** the measures are displayed in Stage 2. The card performance and lifecycle clean-up is
  deferred, to be addressed with Stage 2's single-computation design.

## Closure conditions (verified when this record was written)

- Source branch at `3bdacf3`, matching the remote; working tree clean before this record.
- TEST site `main` at `97e3342`.
- Both financial-format switches OFF; `DB_VERSION` 4; backup export format 1.
- Production source and deployment untouched; PBSRx repositories untouched.
- No Stage 2 implementation included.
