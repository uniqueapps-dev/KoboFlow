# KoboFlow: financial turnaround readiness audit

- **Audited:** source `uniqueapps-dev/KoboFlow`, branch `claude/koboflow-loan-management-qn2vql`,
  HEAD `740ded125751e6f92e01b23cfb7b4d13fdb0334d` (2026-10-24).
- **Line numbers** refer to `koboflow.html` at that commit.
- **This document was written uncommitted during an audit.** No code, records, branches or
  deployments were changed.
- **Status terms:** verified working; implemented but inadequately verified; incomplete;
  incorrect; blocked by data; not found.
- **Evidence:**
  - "Executed" means a scenario was run against the shipped engine (`tests/load-engine.js`) or the
    TEST build in a throwaway browser, with fictional data.
  - "Read" means traced in the code only.

## A. Executive summary

**KoboFlow is not yet safe to rely on for daily allocation decisions.** Its core arithmetic is
sound and well tested:
- classification of transfers, owner withdrawals, capital, loan proceeds and principal versus
  interest;
- account balances, restricted assets, earmarks without double counting, bill schedules,
  idempotent payments, edits and the review step.

Five things stop it from guiding real money decisions:

1. **Loan liabilities and obligations go wrong after an extra principal payment.** Instalments
   stay fully due. If the user then amends the schedule, as the app advises, the extra principal
   is subtracted a second time and the liability is understated. Executed, D2/D3.
2. **The Director can show a confident "₦X can go to other purposes" when it should not.**
   - It does so while its own data-quality checks report problems.
   - It says "No problems found in the records" while listing future-dated income, possible
     duplicates or no bills.
   - It gives no "pay it" action for an overdue payment that is already earmarked.
   - It counts accounts marked Personal as business cash.
   (Executed, DIR-1/3/4.)
3. **Quick entry records some common phrases with the wrong financial meaning, with no review
   flag.** "refund to customer" becomes income, "transfer to landlord" becomes an internal
   transfer. Executed, D4.
4. **The pharmacy side of the decision has no reliable data source.**
   - There is no receivable or "sale not yet collected" concept anywhere.
   - There is no interface from PBSRx.
   - PBSRx's own margin and break-even figures are still unreliable (verified in its code).

   The Director can therefore only see cash typed into KoboFlow by hand.
5. **Parts of the agreed Director briefing do not exist yet.** These are:
   - the monthly destination and progress;
   - trading days;
   - pharmacy performance (sales versus receipts, margin, break-even, stock replacement);
   - expected inflows.

**The recommended first task is P0-1: correct loan extra-principal accounting**
(section F). It is the only issue found that silently misstates a liability and net worth.
Following the app's own advice triggers it.

## B. Requirements matrix

The blueprint is the user's own specifications in this project. There is no single document
titled "financial turnaround blueprint". The sources are:
- **S1:** Loan Management and Opportunity Analyzer specification (2026-10-15).
- **S2:** product definition, "financial operating system" (2026-10-15).
- **S3:** "Financial Control and Daily Money Director, Implementation Blueprint" (2026-10-18).
- **S4:** Stage 0 work order and its confirmed decisions (2026-10-18).
- **S5:** Master specification for the integrated build (2026-10-18).
- **S6:** Bills and database v4 (2026-10-18).
- **Later scopes:** transaction editing, destination tracking, the income warning and bill
  frequencies.

Requirements are explicit unless marked (inferred).

### B1. Classification and balances (S1 §13, S3 §8, S4, S5 §2.3)

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| Transfers are not income or expense | Verified working (engine). Incorrect at quick entry | `classifyTxn` 705-728. engine.test "transfers and owner withdrawals are not expenses" (287). `parseEntry` 2765-2794 makes "rent transfer" / "transfer to landlord" a transfer (D4) | A real expense can be hidden. P0-3 |
| Owner withdrawals are not operating expenses | Verified | `classifyTxn`; `cashFlowSummary` memo (1168); runway excludes them (1086). engine.test 287, 520, 667 | — |
| Capital injections are not revenue | Verified | `classifyTxn` capitalIn; `receiptTxn` 3419. engine.test 297 | The statement total is wrong for an injection from your own account (D1). P1-4 |
| Loan proceeds are not income (including legacy "Loan") | Verified, with one gap | `classifyTxn` 714-718; Add Entry intercept 5135. engine.test 259, 269. Gap: type Income with category "Loan" is counted as income | P0-4: warn |
| Principal reduces the liability; interest and fees are costs | Verified for normal and provisional payments. Incorrect with extra principal | `agreementBalances` 617-647, `allocatePayment` 653-690. engine.test 194, 206, 276, 544. D2, D3 | P0-1 |
| Restocking cash is not automatically COGS | Implemented as a cash outflow / operating expense. Design question | "Restocking" is an ordinary expense in Analytics, runway, cash flow, Autopilot and Restock ROI. No inventory asset in Net Worth (4306). No tests on this | Decision H4 |
| Only From and To accounts move balances | Verified | `accountDeltas` 729-735, `accountBalances` 740-750. engine.test 287, 307, 467, 477 | — |
| paidTo and receivedFrom never move balances | Verified | destination.test "names never change balances…" plus browser tests | — |
| Editing keeps identity, links and balance effects | Verified (browser tests) | `saveEdit` 5262, `confirmEdit` 5316, `atomicIf` 321, `editRule` 5180. transaction-edit.test (8 tests) | — |
| Reversals, refunds and duplicates create no extra movement | Mostly verified. Refunds incorrect | Idempotency keys for receipts, payments, settlements and bills; `guard`; import dedupe; `reversalOps` 3544. e2e "double-tap… reversal and restart". There is no refund type: "refund…" and "gift…" quick entries become income (D4). Stored negative or unknown-type records are not flagged. Bill and loan payments do not use `atomicIf`, so two tabs could each record one | P0-3, P0-4, P2-5 |
| A schedule is not a payment; a bill falling due is not an outflow | Verified | Status comes from allocations and payments only (`instalmentStates` 593, `billPaid`). engine.test 307 and the bill tests | — |
| One cash definition on every screen (S5 §5.2) | Verified for Cash Now, restricted, earmarked and free | `cashPosition` 768, `cashCover` 793, `freeCash` 3167. Calendar shows a 60-day "Left after", while the others use 30 days (intended and labelled, stage0 test) | P3-3: consider one horizon |
| Restricted assets and investments are not liquid (S4 decision, S5 §5.1) | Verified | `accountAccess` 764: coop and investment are restricted unless overridden. Net Worth includes them. engine.test 578, 586 | — |
| Cash-flow statement reconciles to real money (engine.test 520 claims this) | Incorrect in 4 cases | D1 | P1-4 |

### B2. Bills, obligations and earmarks (S5 §5.3, S6, bill frequencies)

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| Correct recurring dates, including Every 6 months and Custom | Verified | `billDueDates` 846+. bill-frequency.test (14, including an exact comparison with the previous release over more than 400 cases), bills.test | — |
| A bill never moves money; a payment counts once | Verified | Only "Bill paid" transactions move balances. Amount is capped at what is left; idempotency keys | — |
| A linked earmark covers only what is owed; no double deduction; restricted earmarks cover nothing | Verified, with a silent case | `reservationPlan` 810-833. engine.test 694-762, 935, 984. An earmark linked to a bill or loan but held in a restricted account covers nothing, and no message says so (`restricted_source`, 823, is never read) | P0-4 |
| Consistent date windows | Verified (by design) | All screens use `obligationsWithin`: Brief 14 days, Director and free cash 30, Calendar 60, reservations 365 | — |
| A loan must not also be counted as a bill | Not found (no guard) | A bill created for a loan already in Loans is counted twice in every obligation window. Its payments count as expenses, principal included. Executed | P0-4: warn |
| Bill reminders | Not found | Only loan instalments raise reminders (S1 §11 covers loans) | P2-4 |

### B3. Loans, opportunities and investments (S1, S5 §8.6)

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| Opportunity analysis is separate from committed loans | Verified | Proposals; "accepted_awaiting" is not an obligation until funded. engine.test 345-447, e2e 248, 307 | — |
| Funding is not assumed to be debt | Verified | `isDebt` 454. Equity, gifts and profit share are capital_in | — |
| Planned instalments are not treated as paid | Verified | `instalmentStates` 593 | — |
| Settlement and reversal | Verified; settlement reversal untested | engine.test 215, 232, e2e 209. Reversing a settlement un-waives (3547) but has no test | P2-6 |
| Extra principal and amendments | **Incorrect** | D2, D3 | P0-1 |
| Investments are assets, not liquid cash | Verified | type `investment` sits in the investing line; investment accounts are restricted. An investment with no To account removes the money from net worth | P3-2 |
| Net Worth loan liability | Design question | Uses `outstanding.total`, which includes future scheduled interest, while future bills are excluded | Decision H5 |

### B4. Daily Money Director (S3 §6/§10, S5 §7)

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| Traceable arithmetic: Cash Now − earmarks − reserved = free; − uncovered 30-day payments − floor = free to allocate | Verified | `directorPlan` 1034-1068, `renderDirector` 4702-4751. engine.test director (836-875), integrated-build.test | — |
| Ranked actions with why and consequence; no arbitrary percentages | Verified | `DIRECTOR_ORDER` 1033. No percentage split; the engine test asserts no "%". (Autopilot and other screens still use rule-of-thumb percentage thresholds: P3-1) | — |
| Floor is never invented; its effect is shown; its absence qualifies the result | Verified | 1042, 1060. integrated-build.test 206-222 | — |
| Overdue payments rank first (bills doc line 71) | **Incorrect** when fully earmarked | DIR-1: the overdue rule needs an uncovered gap (1045) | P0-2 |
| Never turn incomplete data into a confident result (S5 §7.6) | **Incorrect** | DIR-3: "free" is still offered while qualified (1061). `qualified` ignores medium items (1065), so the banner says "No problems found" while listing issues | P0-2 |
| Actions link to the record (S5 §11) | Incorrect for bills | DIR-2: `billId` is dropped at 4695, so there is no OPEN link for bill actions (loans work) | P1-5 |
| Action wording is accurate | Incorrect in shortfalls | DIR-5: "covers only part" when it covers none (1052); floor_breach understates and prints "₦-140,000" (`naira` 1032); the reserve "If not" line is wrong (1054) | P0-2 |
| "Today's income is already inside Cash Now" | Incorrect for income into restricted, unmapped or missing accounts | DIR-6, 4742 | P0-2 |
| Business versus household money (S3 §10 question, unanswered) | Incomplete | DIR-4: "Used For: Personal" is saved (3982, 4052, 4166) but dropped in `applySetup` (3843), so personal balances count as business free cash | Decision H1, then P1-1 |
| Distinguish cash received, sales recorded, expected inflows, gross profit | Incomplete / blocked by data | Only recorded cash is known (text at 4728, 4743). No receivable or expected-inflow concept; `cashForecast` (1179) has no callers. A future-dated or uncollected "sale" entered as income is spendable at once (medium warning only) | Decision H2, then P1-2 |
| Briefing A–E: destination, position, progress and trading days, pharmacy performance, action (S3 §6) | Incomplete | B (position) and E (action) exist. A (monthly destination), C (progress, trading days: S4 decision 4) and D (pharmacy performance) are not found | P1-3 |
| Payments after the 30-day horizon | Implemented and stated; risk | Borrowed cash can show as "free to allocate" with later instalments not shown (executed with a fictional loan) | P1-3: add a horizon note or second figure |

### B5. PBSRx and Cockpit boundary (S1 §3, S3 §7, S5 §4/§9, handoff document)

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| No second supplier-debt or inventory ledger in KoboFlow | Verified | Restocking is a cash category only; screens defer supplier credit to PBSRx (2041, 2146, 3769) | — |
| Minimal validated handoff with stable ids, idempotent, no re-entry | Not found (by agreed design: contract only, S6 §9) | KoboFlow imports only its own JSON backups (`planImport` 4854: no `transactions` → rejected; no `sourceId`). No CSV import | Blocked by PBSRx. P2-1 |
| PBSRx margin and break-even trusted only after validation | Blocked by data: still unreliable | PBSRx RC3.9.4A (unchanged, `344b565`): "net profit" = sales − expenses (no COGS); break-even = fixed costs ÷ 30 against raw sales, includes loan principal, defaults to ₦0; sale profit ignores discount and uses current cost and base-unit qty; collected cash includes change given; Cash Desk save resets the day's cash and expenses; POS shortfall never recorded; UTC dates | Do not use. P2-1 (PBSRx project) |
| Cockpit does not duplicate KoboFlow | Verified (no link) | `Pbsrx-Cockpit-` (`f337f62`): stock, consignment and repayment logs in its own IndexedDB; no finance export. Duplicates PBSRx stock and supplier-repayment data, not KoboFlow | P2-2 (document) |
| Handoff document accuracy | Partly incorrect | It says PBSRx is on "its own origin". The repo's PWA test (pwa.test.js:3-5) models KoboFlow, its old test site and PBSRx on one origin (`uniqueapps-dev.github.io`). If deployed there, PBSRx's stored owner password and API key are readable by any app on that origin (key names only verified; no values read) | P2-3 |

### B6. Data quality, minimum input, release

| Requirement | Status | Evidence | Impact / next action |
|---|---|---|---|
| Surface missing classifications, unmapped accounts, duplicates, future dates; no silent rewrite (S5 §6.5) | Verified, with gaps | `dataQuality` 986+, `liveQuality` 4680. Not flagged: stored negative amounts, unknown types, Income with category "Loan", loans also entered as bills, restricted-source earmarks | P0-4 |
| Income-with-a-From-account warning: read only, accurate effect, severity from the balance effect | Verified | `incomeFromFindings`; income-from.test (6, including an exact comparison of effects with `accountBalances` and a "no financial effect" test) | — |
| Duplicates: names separate only when both are named; legitimate repeats not flagged | Verified | destination.test duplicate matrix | — |
| Record once; minimum manual input (S1 §18, S3, S5 §3) | Incomplete | Pharmacy cash, restocking and supplier payments must be retyped from PBSRx. Quick entry, the bill name as payee, and the lender as payee reduce typing | P2-1 |
| Android acceptance only on a real device (S5 §12.4) | Pending | Last reported device acceptance covered transaction editing (d8bce84). Destination tracking, the income warning (da8a683) and bill frequencies (740ded1) are not yet device-accepted | Acceptance plan G |
| Production release path | Not started (by policy) | main is still the v2 `index.html`. PR #1 (develop into main) is open and stale. No upgrade test uses records made by the real production `index.html` | P2-7 |

## C. Critical defects (executed, could materially distort figures)

1. **D2: extra principal leaves instalments fully due.**
   - Scenario: 3 instalments of 34,500 (30,000 principal + 4,500 interest). Pay 30,000 as extra
     principal.
   - Result: liability 73,500, but obligations still total 103,500, and the 30-day figure is
     unchanged.
   - After 90,000 of extra principal: principal is 0 but the loan is not settled, and all three
     instalments remain due. This feeds the Director, free cash, Calendar and reservations.
   - Code: `agreementBalances` 632-647, `allocatePayment` 661-671.
2. **D3: after an amendment, extra principal is subtracted twice.**
   - The same loan is amended to the lender's revised schedule (3 × 20,000 principal + 4,500
     interest), as the loan screen advises (3286).
   - Result: principal 30,000 and total 43,500. The correct figures are 60,000 and 73,500.
   - So the liability is understated by 30,000 and net worth is overstated.
   - Cause: `extraP` is always subtracted (638-640).
3. **DIR-3: the Director recommends a spendable amount while uncertain, and reports "No
   problems found" alongside listed issues.**
   - Example: with a negative account balance (high severity), it still showed a specific "₦X can
     go to other purposes".
   - Medium items (future-dated income, possible duplicates) do not qualify the figures.
   - Code: 1061, 1065, 4715.
4. **DIR-1: an overdue payment that is fully earmarked gets no action.** It shows as "Funded" and
   is never prompted, because of the gap > 0 test at 1045.
5. **D4: quick-entry wording is turned into the wrong financial type, with no review flag.**
   - "refund to customer", "refund from supplier" and "gift for mum" become income.
   - "rent transfer" and "transfer to landlord" become a pers_cash → pers_bank transfer.
   - All are saved as "AI Categorized" (`parseEntry` 2765-2794).
6. **D1: the cash-flow statement does not reconcile to real money.**

   | Case | Statement net | Real change |
   |---|---|---|
   | Capital injection from your own tracked account | +20,000 | 0 |
   | Investment into a tracked fixed-deposit account | −30,000 | 0 |
   | Owner withdrawal with no To account | 0 | −10,000 |
   | Imported unknown type | 0 | −7,000 |

   - Reporting only: the Director does not use it.
   - It contradicts the test claim at engine.test 520 and the "no contradicting screens" rule.

## D. Incomplete capabilities

- **Director briefing:**
  - no monthly destination or target;
  - no progress or trading days (S4 decision 4: 6 days per week);
  - no pharmacy-performance section;
  - no expected inflows;
  - nothing on the effect of commitments beyond 30 days.
- **No receivables:** a sale not yet collected cannot be recorded honestly. If it is entered as
  income, it is spendable at once.
- **Business and household separation:** the Personal flag on accounts has no effect (DIR-4).
- **Bill reminders:** do not exist.
- **Correction tools:**
  - no general reverse or delete for ordinary entries (deliberately deferred);
  - edits do not travel between devices by import.
- **Director links:** bill actions do not open the bill (DIR-2).
- **Silent coverage gap:** an earmark linked to a bill or loan but held in a restricted account
  covers nothing, and no message says so.
- **PBSRx:** no handoff interface (agreed: contract only).

## E. Data-quality blockers

1. **PBSRx figures are not trustworthy as inputs.**
   - Collected cash includes change.
   - Day records are rebuilt, and expenses can be lost.
   - There are two revenue totals.
   - Refunds are unlinked.
   - Dates are UTC.
   - Net profit excludes COGS.
   - Break-even includes principal and defaults to 0.

   They must not feed the Director until the handoff contract exists and PBSRx's calculations are
   corrected and validated.
2. **Records upgraded from the production v2 app may contain income with a From account.** v2's
   quick entry does this. The read-only warning lists them; each needs the user's decision.
3. **Possibly mislabelled refunds, gifts and "transfer to …" quick entries** (D4) in existing test
   or real data. Nothing currently flags them.
4. **Stored negative or unknown-type records** (older data, imports) move balances but are not
   flagged.
5. **Loans entered both as an agreement and as a bill** would double the obligations. Nothing
   flags this.

## F. Prioritised backlog

**Rules for every task:**
- Use fictional data only and keep the isolated TEST build.
- Make no database version change unless approved.
- Keep main and develop unchanged.
- Add regression tests at engine level and, where screens are involved, browser level against
  both builds.

### P0: correctness and safety blockers

**P0-1. Loan extra-principal accounting**
- **Scope:**
  - An extra principal payment must leave the liability and the remaining instalment obligations
    consistent.
  - Paying the full principal must settle the loan or clearly state the interest still due.
  - An amendment made after extra principal must not subtract it again: either the amendment
    absorbs earlier extra principal, or the user is asked.
- **Depends on:** decision H3 (lender behaviour).
- **Acceptance:**
  - the D2 and D3 scenarios give the correct figures;
  - Net Worth, Director, free cash, Calendar and the loan screen agree;
  - existing loan tests are unchanged (engine.test 194-276, 544; e2e loan tests).
- **Unchanged:** normal and provisional payment allocation, settlement, and reversal.

**P0-2. Director truthfulness**
- **Scope:**
  - An overdue payment always gets an action, even when funded ("pay it now").
  - While any high-severity item exists, withhold or clearly qualify the exact "can go to other
    purposes" amount.
  - The banner must not say "No problems found" while issues are listed. Count medium items, or
    reword the banner.
  - Fix the shortfall and floor wording and the negative-amount formatting.
  - "Today's income" text must be accurate for restricted, unmapped and missing accounts.
- **Acceptance:** each DIR scenario (1, 3, 5, 6) has a test.
- **Unchanged:** the arithmetic and figures (traceable rows), and no percentages.

**P0-3. Quick-entry classification safety**
- **Scope:**
  - "refund", "gift" and "transfer/transfer to <name>" keywords must not produce a confident
    income or transfer.
  - Send ambiguous phrases to Needs Review with an explanation, or require the `@` name or an
    explicit type.
- **Acceptance:** the D4 phrases are not saved as AI Categorized income or transfer; existing
  alias tests still pass.
- **Unchanged:** amounts, aliases, categories and the `@` parsing.

**P0-4. Data-quality coverage for silent distortions** (read-only warnings only)
- **Flag:**
  - stored negative amounts;
  - unknown transaction types;
  - Income or Expense with category "Loan";
  - a bill that looks like a loan already in Loans;
  - an earmark linked to an obligation but held in a restricted account.
- **Acceptance:** each case is flagged with its balance effect; no record is changed.
- **Unchanged:** existing warnings and severities.

### P1: essential for a usable Director

1. **Business and personal money** (after decision H1). Apply the account "Used For" setting in
   the Director's free cash and floor, and treat owner withdrawals to personal accounts
   accordingly.
2. **Receivables and expected inflows** (after decision H2).
   - Either a simple "money owed to me" record that never counts as cash until received, or a
     documented wait for PBSRx.
   - Expected inflows shown separately from cash, never spendable.
3. **Director briefing sections:**
   - monthly destination and progress;
   - trading days (6 per week with exceptions);
   - a beyond-30-day note on commitments (especially borrowed cash);
   - pharmacy performance shown as "not available" until a validated source exists.
4. **Cash-flow statement reconciliation (D1).** Treat a capital injection from a tracked own
   account and an investment into a tracked asset account as internal in the combined view.
   Flag unknown types. Acceptance: the engine.test 520 claim holds for all D1 cases.
5. **Director links to bills (DIR-2).**

### P2: integration and usability

1. **PBSRx handoff (PBSRx project).** Implement the export contract in
   `docs/pbsrx-financial-handoff.md` and fix PBSRx's collected-cash, day-record, refund, UTC,
   COGS and break-even issues. Then build the KoboFlow importer: idempotent by `sourceId`, cash
   events only.
2. **Document Cockpit** as a separate, non-integrated stock and consignment tool, and note its
   overlap with PBSRx.
3. **Correct the handoff document's origin statement.** Assess shared-origin exposure of PBSRx
   credentials (a PBSRx and hosting matter).
4. **Bill reminders**, at the same 14 / 7 / today / overdue points as loans.
5. **Cross-tab protection** (`atomicIf`) for bill and loan payments.
6. **Tests:** settlement reversal, and amendment after provisional payments.
7. **Production release preparation** (when approved):
   - an upgrade test with records created by the real production v2 `index.html`;
   - replace `index.html` in one change;
   - retire the stale PR #1.

### P3: can wait

1. **Autopilot and other rule-of-thumb percentage thresholds** (Autopilot 4378-4393, owner
   impact 3020-3024, budget score 2827): label them as heuristics, or align them with Director
   data quality.
2. **Investment with no To account** removing value from net worth: warn.
3. **One "left after" horizon** across screens, or clearer labelling on Calendar.
4. **Restocking as inventory** in Net Worth and runway (after decision H4).

## G. Acceptance plan (no real records, no production)

1. **Engine fixtures (Node):**
   - D1–D4 and DIR-1/3/5/6 scenarios as failing tests first;
   - fix;
   - full suite with none skipped;
   - `node scripts/build-test-file.js --check`.
2. **Scripted fictional dataset on the TEST build** (browser, throwaway profile, `KoboFlowDB-test`
   only):
   - accounts: wallet, bank, coop, fixed deposit, and one Personal account;
   - a working-capital floor;
   - a general earmark and a linked earmark;
   - a semiannual and a custom bill;
   - a loan with a principal + interest repayment and an extra principal payment followed by an
     amendment;
   - a capital injection, an owner withdrawal, a restocking payment and a transfer;
   - a sale recorded but not collected (or a receivable, per H2);
   - an overdue funded bill;
   - one item of each data-quality problem.

   Assert every Director row, action and banner, and that Net Worth, Calendar, Brief, Pressure and
   the loan screens agree.
3. **Reproducibility and isolation checks** of the generated site: database and cache allowlist,
   `SOURCE.json`.
4. **Publish to the isolated test site** only after approval. Confirm the Pages deployment and
   `SOURCE.json` on the phone.
5. **Device acceptance on Android** with the same fictional scenarios. Record which checks
   passed.
6. **Only then consider a production release plan** (P2-7), separately approved.

## H. Outstanding decisions (not answered in the project record)

1. **Business versus household money.** Should accounts marked Personal be excluded from the
   Director's free cash and the pharmacy floor, with an owner withdrawal into a Personal account
   reducing business free cash?
2. **Money owed to you.** Should KoboFlow record receivables (a sale not yet collected) itself, or
   wait for the PBSRx handoff?
3. **Extra principal.** When you pay extra principal, does your lender usually shorten the term
   or lower the instalments? This sets the default for P0-1. It can still be changed per loan by
   amending.
4. **Restocking.** Treat stock purchases as an expense (as now) or as an inventory asset in Net
   Worth and runway?
5. **Net Worth loan liability.** Include future scheduled interest (as now), or only principal
   plus interest already due?
6. **Priority among obligations of the same date** (for example rent, loans, salaries, school
   fees, household). It was proposed in the Director blueprint but never chosen. Today the order
   is by due date and urgency only.

**Already decided, so not asked again:**
- Opay is the primary account.
- Coop is restricted by default.
- The 30-day free-cash horizon.
- The floor is manual.
- Owner withdrawals are commitments, not expenses.
- 6 trading days per week.
- No PBSRx importer until a reliable interface exists.
- No Delete action.
- The destination-tracking scope.
- The duplicate rule.
- The bill frequencies.
- The release and branch policy.

## Sources and verification

- **Specifications:** the user's specifications S1–S6 and later scope messages (session record),
  README, and docs/*.md.
- **Commit history:** `git log --all`.
- **Code:** `koboflow.html` engine and app code.
- **Tests:** `tests/*.test.js`, 17 files with 243 test declarations; 295 runs including the
  two-build variants.
- **PBSRx:** `pbsrx-phoenix-release` at `344b565`, `pbsrx-phoenix` and `pbsrx` (read only).
- **Cockpit:** `Pbsrx-Cockpit-` at `f337f62` (read-only shallow clone).
- **Run during this audit:** `npm test` 295/295 passed, 0 failed, 0 skipped;
  `node scripts/build-test-file.js --check` up to date.
- **Defect reproductions:** executed against the engine and the TEST build with fictional data.
