# Stage 0 acceptance record — backup reader compatibility guard

- **Decision:** Stage 0 of the Personal Money Separation architecture
  (`docs/personal-money-separation-design.md`, sections 15 and 23) is **accepted** by the owner after
  automated verification, deployment to the isolated TEST site and manual Android verification.
- **Scope of this record:** Stage 0 only. It records evidence; it changes no code, test, build,
  deployment or Git history. Stage 1 is authorised separately and is not part of this record.

## Source and deployment checkpoints

| Item | Value |
|---|---|
| Source repository | `uniqueapps-dev/KoboFlow` |
| Feature branch | `claude/koboflow-loan-management-qn2vql` |
| Stage 0 source commit | `3359ae0c8efdd0f15574f375c6a0c4205d1ec649` ("feat: implement Stage 0 backup compatibility guard") |
| TEST Pages repository | `uniqueapps-test/uniqueapps-test.github.io` |
| TEST deployment commit | `50d30b7c52ba10c6067b3ad29d8c7a8809ec15a3` (GitHub Pages "pages build and deployment" run 9, conclusion success) |
| TEST site build record | `SOURCE.json`: `sourceCommit` `3359ae0…`, `sourceInputsCommitted: true`, `newFinancialFormat: false`, database `KoboFlowDB-test`, cache prefix `koboflow-test-` |
| Production | not deployed; production `main` (`2f4ab03`) and `develop` (`e5e9f69`) untouched |
| Financial-format switches | `NEW_FINANCIAL_FORMAT = false` in production (`koboflow.html`) and in TEST (`koboflow-test.html`) |

## Automated evidence (recorded at `3359ae0`)

| Check | Result |
|---|---|
| Stage 0 tests (`tests/backup-format-guard.test.js`) | 28 passed, 0 failed, 0 skipped |
| Full test suite (`npm test`) | 400 passed, 0 failed, 0 skipped (also re-run in a fresh clean clone at the exact commit before deployment) |
| TEST build-sync check (`node scripts/build-test-file.js --check`) | passed (`koboflow-test.html` is up to date) |
| Explicit format-1 bypass (review finding B1) | fixed and covered by regression tests on both builds and both switch states |
| Atomic-write protection | tested: failures on the first, middle and last record, thrown or aborted, on `atomic`, `atomicIf` without checks and `atomicIf` with checks leave nothing written; the old defect demonstrated on `03d8dee` |
| Refusal before confirmation and database writes | tested: every refusal shows zero confirmation prompts, zero storage-layer calls, zero read-write transactions and a byte-identical snapshot of every store |
| Database version | 4, unchanged |
| Database schema | unchanged (no store or index change) |
| Published artifact | the files at `50d30b7`, served locally, passed 22 of 23 browser checks; the one failed check was over-strict (it flagged the pre-existing Google Fonts stylesheet request, also present in the `03d8dee` build; no production or data service was contacted) |

## Manual Android evidence (owner, on the deployed TEST site)

The owner confirmed on an Android device:

1. TEST BUILD identification visible.
2. KoboFlow opened without errors.
3. Existing TEST accounts visible.
4. No production records appeared.
5. Backup/export screen opened.
6. TEST backup was correctly identified.
7. Existing format-1 backup was recognised.
8. Format-2 test fixture (`koboflow_TEST_format2_refusal_fixture.json`, SHA-256
   `bde8a753628e5260c65f0adcf28e25f5010464e431d44691fd9d4459cb9d43c3`) was refused.
9. The live TEST website displayed the expected message:

   > Import failed: This backup uses KoboFlow’s new financial format, which is not enabled on this site yet.
   >
   > Nothing was changed.

**Screenshot evidence:** the owner supplied a screenshot of that message on the live TEST site. It is
retained by the owner as the manual acceptance evidence. It is not stored in this repository.

**What the manual evidence does and does not show.** The screenshot and the owner's checks show
what the live TEST site displayed on the device. **Database writes were not independently measured
on the Android device.** The zero-write evidence comes from the automated tests and the
published-artifact checks: zero confirmation prompts, zero storage-layer calls, zero read-write
transactions and byte-identical snapshots of every store, measured in Chromium on disposable profiles.

## Closure conditions (verified when this record was written)

- Source branch at `3359ae0`, matching the remote; working tree clean.
- TEST site `main` at `50d30b7`.
- Both financial-format switches OFF.
- Production source and deployment untouched.
- PBSRx repositories untouched.
- No Stage 1 implementation included.
