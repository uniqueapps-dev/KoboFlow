# Stage 2 verification record — reports, runway, budgets, personal and unresolved views

- **Status:** implemented and verified; deployed to the isolated TEST site; **awaiting the owner's
  Android acceptance and acceptance decision**. Stage 2 is not accepted until the owner says so.
- **Controlling specification:** the owner-authorised Stage 2 implementation plan, revision 11
  (13 November 2026), with the owner-approved CF5 and fixture correction of the same day (recorded below
  as revision 11.1). Brief v1.0 and owner decisions S-1 to S-7 apply.
- **Base:** branch `claude/koboflow-loan-management-qn2vql` at `2278c46` (Stage 1 acceptance record) on
  the accepted Stage 1 source `3bdacf3`; TEST site at `97e3342`. Both were verified, clean and in sync,
  before any change.
- **Delivery:** one cohesive implementation, one integrated test cycle, one TEST deployment.

## 1. What Stage 2 delivers

| Brief | Area | Delivered |
|---|---|---|
| 4.1, 4.2 | Central measurement layer | `financialMeasures` keeps every Stage 1 key and rule; additive outputs: `figures` (every Stage 2 figure for the period), `breakdown` (per category), per-entry facts (`paySide`, `recv`, `preOpening`, `held`, `cat`, `contrib`, `replay`), `sharedReplay`, `financingReceipts`, `loanPrincipalRepaid`, `runway.figures` and `runway.entries`. New pure derivations of one measures result: `cashFlowStatement`, `budgetConsumption`, `dailyTotals`, `burnReport`, `explain` (plus `replayOrder`, `sharedReplay`, `FIGURE_KEYS`). |
| 4.3 | Explainability | One shared "How this is calculated" sheet: period, definition, contributing entries with their classification and the amount each contributes, the Shared replay row of each C2 payment, excluded amounts, warnings and limitations. The listed entries always sum to the figure (R10). |
| 6.1 | Analytics | This month, last month and a custom period; pharmacy income (recorded) with lines (i)–(iv); pharmacy operating expenditure (B1) with F1–F4; personal; unresolved; burn (C1–C8); financing; classified spending by category; "all recorded income" as a labelled comparison. |
| 6.2, 3E | Cash Flow | OP-R (Pharmacy operating result) and OP-C (Pharmacy cash movement from operations), named and reconciled by the difference line; unresolved and provisional cash movements shown separately, in neither total; the owner's OP-C qualification, verbatim, immediately below OP-C in the operating card, the summary grid and the OP-C explanation sheet; personal; unresolved; financing; owner and other movements. The single "Operating Cash Flow" total is retired. Period: the calendar month, inclusive. |
| 6.3 | Budgets (Home list and the budget score) | Consumption = classified pharmacy and personal spending by category, shown apart; unresolved spending shown, never consumed. |
| 6.4 | Home "yesterday", Timeline daily totals | Pharmacy, personal and unresolved income and spending per day, from the measures; Home "yesterday" = the Timeline row for yesterday. |
| 6.5 | Owner Impact | Withdrawals and contributions (with "Implicit owner contribution — not a formal capital contribution."), pharmacy and personal activity, financing; ratio to recorded pharmacy income. |
| 6.6, 3B | Runway | Pharmacy cash runway = confirmed available pharmacy cash ÷ (pharmacy cash burn ÷ history days); the approved 0-days display rule and its two messages; unresolved or provisional share; known commitments and cash after known commitments beside it (the Director's `cashCoverFor`). |
| 6.7 | Burn reporting | Analytics burn card (period) and the runway (window): C1–C8, confirmed versus unresolved or provisional, and what is not in the burn. |
| 6.8 | Financing summaries | Cash Flow, Analytics and the Capital screen: loans received, principal, interest and fees, provisional repayments, own-money capital, external funding, capital of unconfirmed source, each apart. |
| 6.9 | Director (S-6) | Today's income = recorded pharmacy income, with all recorded income as the comparison; the month's unresolved figures as qualifications in "Missing or uncertain" (display only). Floor, free-to-use, free-to-allocate, reservations, ranking and safeguards are unchanged. |
| — | Autopilot | Owner withdrawals and income inputs from the measures; runway from the pharmacy cash runway. |

**Demo mode:** the sample screens are unchanged. The Stage 1 rules never classify sample entries, so the
Stage 2 figures are shown for live records only (as the Stage 1 card was).

## 2. Owner decisions implemented

P-D18 (with D-F2, D-F2a = O1, D-F2b, D-F2c parts 1 and 2, D-F4, D-OC, the "Amount not counted against the
confirmed pharmacy portion." wording and the date–time–id order), P-D18a, the runway display rule, the
OP-R / OP-C distinction (revision 9), the OP-C qualification (revision 10), the identity 4 wording
(revision 11), S-1 to S-7, and the CF5 and fixture correction (11.1). Register rows P-D18 and P-D18a, the
section 6 "Pharmacy cash burn" row (revised by P-D18) and the section 3 Shared-rule descriptions (corrected
by P-D18a, original wording kept as history) are in `docs/personal-money-separation-design.md`. The Stage 1
acceptance record is unchanged.

**Revision 11.1 (owner-approved correction, 13 November 2026).** Revision 10 stated that the existing
no-purpose Cash Flow fixtures stay unresolved. That was wrong: their entries are from confirmed Business
accounts, so accepted Stage 1 rule 4 classifies them as Pharmacy. CF5 therefore uses a payment explicitly
marked purpose unknown (as Stage 1 Example 15), and the existing fixtures are tested against OP-R and OP-C.
No Stage 1 rule, `classifyTxn`, OP-R, OP-C, burn or Shared definition changed.

## 3. Changed files

| File | Change |
|---|---|
| `koboflow.html` | Engine: `scopeTotals` (funding lines F1–F4, income lines (i)–(iv), per-entry contributions), `scopeBurnK` (P-D18), `financialMeasures` (additive outputs), the Shared replay and the Stage 2 derivations. App: `measuresFor` and the Stage 2 screen renderers, the explanation sheet, the OP-C display helper; live-mode branches in the existing render functions; the demo-mode screens unchanged. |
| `koboflow-test.html` | Regenerated by `scripts/build-test-file.js` (byte-identical to the build output). |
| `tests/stage2-shared-replay.test.js` | New: S1–S11, H1–H4 and the order rule (16 tests). |
| `tests/stage2-measures.test.js` | New: 3A, 3B, 3C.5, 3E (CF1–CF5), derivations, R10 at engine level, read-only, scenarios B, D, E, F and K (19 tests). |
| `tests/stage2-screens-browser.test.js` | New: CF6, CF7, R1–R12, the runway display rule on both builds; the static checks; offline (8 tests). |
| `tests/stage2-performance.test.js` | New: start-up render at 500, 3,000 and 10,000 entries, Stage 2 and Stage 1 (1 test). |
| `tests/stage2-regions.js` | New: the closed allow-list of Stage 2 regions used by the two Stage 0 comparison tests. |
| `tests/stage1-scope.test.js` | The two P-D18 expectations (section 4.1); the Stage 0 comparison extended with the allow-list. |
| `tests/stage1-accountless-browser.test.js` | The Stage 0 comparison extended with the allow-list. |
| `tests/stage0-truthfulness.test.js`, `tests/transaction-edit.test.js`, `tests/destination.test.js`, `tests/e2e.test.js` | Re-pointed screen assertions (section 4.2). |
| `docs/personal-money-separation-design.md` | P-D18, P-D18a, section 6 burn row, section 3 Shared rule, status lines. |
| `docs/stage-2-verification.md` | This record. |

No database, backup, stored-field, cash-layer, `classifyTxn`, Stage 0 guard, switch, build-script, service
worker, manifest, PBSRx or production change.

## 4. Changed expectations (none deleted, loosened or skipped; no timeout changed)

### 4.1 Stage 1 engine expectations changed by P-D18 (exactly the two in plan 3C.6)

| Test | Old | New | Why |
|---|---|---|---|
| measures table | burn ₦165,500; runway burn ₦175,500; 252 days | burn ₦147,500; runway burn ₦157,500; 281 days | the ₦6,000 paid personally is F3; the ₦12,000 Shared part is F2 with C2 ₦0 (the Shared balance stays above D) |
| N-T10 completion fixture | burn ₦28,000 | ₦21,000 | F15 (₦7,000 from Shared) is F2 with C2 ₦0 |

Every other Stage 1 classification and ownership test is unchanged and passes.

### 4.2 Existing screen assertions re-pointed (plan 6.3, corrected in 11.1)

| File | Old | New | Why |
|---|---|---|---|
| `transaction-edit` | `#cf-op-total` −₦5,000, −₦7,500 | OP-R and OP-C −₦5,000, then −₦7,500; separate unresolved line ₦0 | the lunch is Pharmacy (rule 4), F1, counted once |
| `transaction-edit` | `#cf-op-total` +₦3,000 | OP-R and OP-C +₦3,000; separate line ₦0 | the refund, now income into a confirmed Business account: line (i) |
| `destination` | `#cf-op-total` −₦7,000 | OP-R and OP-C −₦7,000; separate line ₦0 | fuel and bread are Pharmacy (rule 4; no vehicle purpose stored), F1 |
| `e2e` | `#cf-financing` lines, `#cf-fin-total` +₦115,000 | Stage 2 financing section: loans ₦150,000, principal ₦17,045, interest and fees ₦17,955, provisional ₦0; net ₦115,000 | the same figures, from the measures |
| `stage0-truthfulness` | runway labels "Available Cash", "Monthly Burn", "Daily Burn", the old basis text and status; Analytics empty state; `#insights-list` vehicle line; `#wd-stats` "This Month" | "Available pharmacy cash", "Monthly (reference)", "Daily pharmacy cash burn", the new basis and messages; the same values (518 days, ₦30,200; 594 days, ₦27,000, ₦900; "--" with the short-history and no-spending messages); Analytics `#ana-s2`; Owner Impact `#oi-s2` | every payment in these fixtures is from confirmed pharmacy cash, so the burn and runway values are unchanged |
| `stage1-scope`, `stage1-accountless-browser` | "every other screen identical to Stage 0" | the same comparison with the closed allow-list of Stage 2 regions removed from both pages; every `[data-stage2]` element must be inside an allow-listed region; demo mode compared in full | plan 6.3 |

## 5. Results

All runs on the feature branch working tree with the final source, Chromium (Playwright) and Node.

| Check | Result |
|---|---|
| Baseline before any change (`npm test` at `2278c46`) | 436 passed, 0 failed, 0 skipped |
| Full suite with Stage 2 (`npm test`) | **480 passed, 0 failed, 0 skipped** (436 existing + 44 new) |
| Stage 0 guard (`tests/backup-format-guard.test.js`) | unchanged, passes |
| Stage 1 (`tests/stage1-scope.test.js` 30, `tests/stage1-accountless-browser.test.js` 8, `tests/stage1-ownership-and-liability.test.js` 22) | pass; only the two P-D18 expectations of 4.1 changed |
| Shared replay S1–S11, H1–H4, order rule | 16 / 16; the independent reference matches the cash layer (`accountBalances`, `unreconciledInflows`, `pharmacyEligibleAccounts`) after **every** entry |
| Measures, 3A, 3B, 3C.5, CF1–CF5, R10, scenarios | 19 / 19 |
| Screens on both builds: CF6, CF7, R1–R12, runway display rule; static checks; offline | 8 / 8 |
| Mutation check (scratch copy; 17 mutations: each component dropped or doubled, F3 / F4 / not-counted into the burn, F1 out, Shared 100%, cap removed, `min(declared, balance)`, input order, held inflows ignored or applied at the start, discrepancy as spending, and four OP-R / OP-C mixes) | **17 / 17 detected** (each fails 3–16 tests) |
| Read-only | 0 read-write IndexedDB transactions and identical stores while every Stage 2 screen renders and sheets open (both builds) |
| `DB_VERSION`, backup format, switches | IndexedDB v4; export format 1 (no format block); `NEW_FINANCIAL_FORMAT` false on both builds |
| Offline | the TEST site, once loaded under its service worker, renders every Stage 2 screen with the network blocked |
| Build | `node scripts/build-test-file.js --check`: up to date; the TEST file is byte-identical to the build output |

**Key figures verified (hand-calculated in the plan; asserted by the tests):**
- 3B: B1 ₦270,000 (F1 ₦247,500, F3 ₦15,000, F4 ₦7,500); burn ₦315,000 over 45 days; ₦7,000 a day;
  available ₦600,000; **86 days**; 21.4% unresolved or provisional; cash after known commitments
  ₦400,000. Shared variant: C2 ₦20,000, burn ₦335,000, available ₦500,000, **67 days**.
- 3E: OP-R **₦230,000**, OP-C **₦182,500**, difference ₦47,500, burn check ₦315,000; Shared variant
  ₦210,000 / ₦162,500 / ₦47,500 / ₦335,000.
- Shared worked replay: F2 ₦60,000 = C2 ₦35,000 + not counted ₦17,000 + pre-opening ₦8,000; burn from the
  account ₦39,000; discrepancy reductions ₦165,000, never spending; same-date swap ₦37,000; 200 random
  orders, one result. H1: C2 ₦30,000 (₦45,000 if held inflows were ignored).
- CF5 (corrected): an explicitly unknown ₦5,000 payment leaves OP-R and OP-C unchanged, raises the separate
  line and the burn by ₦5,000.

**Performance** (start-up: load the records and one full render pass, Chromium, same machine):

| Entries | Stage 2 | Stage 1 (`3bdacf3`) | Measures computations per render pass (Stage 2) |
|---|---|---|---|
| 500 | 202 ms | 196 ms | 11 |
| 3,000 | 651 ms | 530 ms | 11 |
| 10,000 | 2,404 ms | 2,086 ms | 11 |

One memoised result per period (this month to date, the calendar month, yesterday, today, all dates, last
month, the year to date and the Cash Flow six-month trend); the number does not grow with the entries.

## 6. Known limitations (stated in the app where relevant)

- Held unresolved inflows: the cash layer's existing, conservative behaviour (fixture H3) is followed, not
  changed.
- Income is recorded income, not sales (PBSRx); only line (i) is called cash received; no receivables
  (S-1); completed recorded movements only (S-2); personal cash is not calculated (S-3, stage 4).
- The Shared portion stays the static threshold rule until stage 5; one crossing payment can remove the
  whole portion from available cash (the existing, flagged discrepancy); only the payment's own pharmacy
  part enters the burn.
- Finance cost has no position until stage 6 (unresolved finance cost); pre-opening parts use the baseline
  date until stage 4; a separate second entry for the same money can be counted twice until stage 3.
- On a switch-off site, purpose and split cannot be recorded, so F2 (C2), F3, F4 and income lines (iii)
  and (iv) appear on the device only for records that already carry them; they are verified by the
  automated tests on both builds and the built TEST-site files.
- The Analytics vehicle insight shows the Vehicles screen's own figure (unchanged; not a Stage 2 measure).
- Demo mode shows the earlier sample screens (section 1).
