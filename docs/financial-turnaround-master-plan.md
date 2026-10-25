# KoboFlow: financial turnaround master plan

- **Status:** draft for the owner's review, revision 7. Records the confirmed U2–U5 decisions,
  then U4a, U5a, U5b, U9 and U12, then the approved financial-safety corrections and the owner's H5
  decision, then the final-review corrections (G1–G5, H1–H3, S1–S4) and the owner's U13 decision,
  then the owner's integrated sales, collections, receivables and bucket direction, then the
  owner's U14 and U15 decisions (revision 6), then an implementation-scope clarification recording
  what an integrated implementation pass actually delivered against stages 1, 2, 3 and 5 below
  (revision 7; change log in section 13).
  Planning only: no code was changed for this document.
- **Branch:** `claude/koboflow-loan-management-qn2vql`.
- **Checkpoint:** `cb5f209bc50224044435bf857b892c0ec62f0325`, which contains the loan principal and
  settlement fix.
- **Sources:**
  - `docs/turnaround-readiness-audit.md`, the readiness audit (audited at `740ded1`; line numbers
    in it refer to that commit);
  - `docs/loan-principal-and-settlement.md`, the loan fix;
  - `docs/pbsrx-financial-handoff.md`, `docs/bills-and-database-v4.md`,
    `docs/destination-tracking.md` and `docs/transaction-editing.md`;
  - the current `koboflow.html`;
  - the owner's requirements as restated in the request that created this plan (2026-10-24);
  - the owner's confirmed decisions on U2, U3, U4 and U5 (2026-10-24, second revision), and on
    U4a, U5a, U5b, U9 and U12 (2026-10-24, third revision);
  - the financial-safety review of revision 3 and the owner's approved corrections, including the
    H5 decision (2026-10-24, fourth revision);
  - the final consistency review of revision 4 and the owner's approved corrections, including the
    H1 rule for loan charges and the U13 decision (2026-10-24, fifth revision);
  - the owner's continuation and integration direction (sales, cash collected, available cash,
    credit sales and receivables, source reliability, five-bucket build versus activation) and a
    read-only inspection of PBSRx `344b565` (2026-10-25, sixth revision).
  - PBSRx release `pbsrx-phoenix-release` at `344b565` (read only), for its existing five-bucket
    calculation.
- **Where this document fits:**
  - It does not replace the audit. Defect ids (D1–D4, DIR-1 to DIR-6) and decision ids (H1–H6)
    refer to the audit.
  - Where this plan and the audit differ, section 9 explains why.

**Status terms:**
- **Complete:** implemented, tested and accepted.
- **Awaiting verification:** implemented and tested, but independent review or device acceptance
  is still outstanding.
- **Partially complete:** some of the scope exists.
- **Not started.**

---

## 1. Overall goal

KoboFlow must help the owner decide what each naira should do next. Specifically:
- meet obligations when they fall due;
- preserve pharmacy working capital and keep stock available;
- provide sustainable owner support;
- improve the financial position over time.

It must **reduce cognitive load**, not just display records. That means:
- one clear answer to "what should this money do now", with the reasons and the trade-offs;
- a clear statement of how sure that answer is.

**Rules that apply to every stage:**
- **Money moves only through recorded entries.** A plan, schedule, allocation, forecast or
  recommendation never moves money or marks anything paid.
- **Expected money is never available money.** Expected income, receivables and PBSRx figures not
  yet validated are never shown as cash available now.
- **Uncertain data lowers confidence, and the screens say so.** Unknown classifications,
  unvalidated sources and stale data must never produce a confident figure.
- **No silent changes.** KoboFlow never silently reassigns protected money, changes an approved
  plan, executes a payment or rewrites a record. History is kept.
- **Count everything once.** Each cash event, obligation, receivable and payment has one
  authoritative record, with stable ids and duplicate protection.
- **Three money figures are never substituted for one another (revision 6):**
  - **sales** (what was sold);
  - **cash collected** (what was actually received, including payments of earlier debts);
  - **available pharmacy cash** (confirmed pharmacy-owned money after ownership, commitments and
    the floor).

  A sale is not proof that money was received. Cash collected is not sales.
- **Different questions, different figures.**
  - Break-even sales are not cash availability.
  - Future receipts, pending transfers and unpaid receivables are not current cash.
  - A planned payment is not a payment.
  - An actual receipt or repayment is counted once, in every module (buckets, break-even, forecast,
    receivables, loans, Director, briefing and alerts).
- **Every figure says what it is.** Each displayed figure is labelled by its provenance:
  - **source fact:** a recorded entry, or validated PBSRx data;
  - **owner-confirmed:** for example, a balance confirmation;
  - **estimate:** labelled as such;
  - **calculated:** derived from the above.

  Imported or external data also shows its source and when it was last current (U9).
- **Standing project rules:**
  - fictional data only in tests;
  - the isolated TEST build (`KoboFlowDB-test`);
  - no database version change without approval;
  - `main` and `develop` stay unchanged until a separately approved release;
  - no Android acceptance claim without a real-device test.

## 2. The three connected financial systems

| System | Answers | Owns | Inputs | Must never |
|---|---|---|---|---|
| **A. Financial Break-Even Calculator** | "What must the pharmacy sell, over a stated period, to cover its costs?" | KoboFlow | Validated operating costs (from KoboFlow records); validated gross margin / COGS (from PBSRx, once validated); the owner's period definitions | Use PBSRx's current margin or break-even figures; include loan principal as an operating cost; mix break-even with cash availability |
| **B. Cash-Obligations Forecast** | "What cash will I have, by date, against what I must pay?" | KoboFlow | Actual balances; expected inflows (receivables, expected sales collections, both labelled); bills, rent, salaries, supplier obligations (PBSRx feed), loan instalments, other commitments | Count expected money as available; double-count an obligation (for example a loan entered as a bill too); treat a scheduled payment as paid |
| **C. Daily Money Director** | "What should each naira do now, and why?" | KoboFlow | A and B; the five protected buckets; the floor; data quality; approved decisions | Silently move protected money, change an approved plan, or execute a payment; give a confident figure on stale or incomplete data |

**How they connect:**
- A and B are different questions:
  - break-even is **profitability over a period**;
  - the forecast is **cash timing**.
- The Director reads both. It must label which one each statement comes from. For example:
  - "you are below break-even this month" is a statement about profit;
  - "you cannot pay rent on the 30th" is a statement about cash.
- A business can be above break-even and still short of cash, or the other way round. The
  Director must be able to say so.

### A. Financial Break-Even Calculator: requirements

- **KoboFlow owns the consolidated calculation.**
  - **Today:** PBSRx's own break-even (fixed costs ÷ 30 against raw sales) includes loan
    principal, defaults to ₦0 and ignores COGS (audit B5, E1). It must not be used.
- **Inputs, each with a definition and a source:**
  - fixed operating costs per period (rent spread over the period it covers, salaries, utilities,
    subscriptions);
  - variable costs;
  - gross margin = (sales − COGS) ÷ sales, from validated PBSRx sales and cost data;
  - trading days per period (decided: 6 per week, with exceptions).
- **Separate operating break-even from cash:**
  - break-even sales = fixed operating costs for the period ÷ gross-margin ratio;
  - loan principal, owner support, inventory purchases and transfers are not operating costs;
  - loan interest and fees are finance costs, shown separately ("break-even including finance
    costs").
- **Costs that cover other periods** are spread over the period they cover. For example, a
  12-month rent payment counts as 1/12 per month in break-even, while the cash forecast still
  shows the full outflow on its due date.
- **Unvalidated inputs:** if any input is missing or unvalidated, the result is shown as
  "estimate" or "not available", with the missing input named. It is never shown as ₦0.

### B. Cash-Obligations Forecast: requirements

- **By due date:** actual cash, plus expected inflows shown as a separate line, against every
  known outflow.
- **Each line is labelled as one of:** liability, cash movement, operating expense, inventory
  purchase, owner support or expected receipt.
- **Duplicate protection:** stable ids for occurrences (already true for bills and loan
  instalments), and a warning for a loan also entered as a bill (P0-4).
- **What exists today** (partially complete): obligations within 14, 30, 60 and 365 days from bills
  and loan instalments, plus `cashCover`.
- **Missing today:**
  - expected inflows;
  - salaries and supplier obligations as distinct sources;
  - the business-versus-personal split;
  - a view beyond 30 days in the Director.

### C. Daily Money Director: requirements

- **Inputs the Director must weigh (revision 6):**
  - actual account balances;
  - pharmacy versus household ownership (section 4);
  - shared-account portions and their uncertainty;
  - upcoming supplier obligations and other liabilities;
  - the working-capital floor;
  - inflows, separated into confirmed and expected and labelled by certainty and date (section 5);
  - existing commitments and actual payments;
  - Reserve protection and approved allocation changes.

  Where any input is unreliable or incomplete, the exact recommendation is withheld or qualified,
  with the reason.
- **Reassess on every change:** balances, collections, expenses, obligations, receivables,
  schedules or approved decisions. It is a pure recomputation, never stored figures. This holds
  today, and must stay true.
- **Distinct states, each labelled on screen:**
  - **actual position:** recorded cash;
  - **expected position:** actual plus expected inflows minus expected outflows;
  - **protected allocations:** buckets, earmarks and the floor;
  - **recommendation:** the Director's suggestion;
  - **approved action:** the owner accepted it;
  - **verified payment:** a recorded payment, confirmed where confirmation applies.
- **Explanations:** each recommendation states why, the trade-off, and what happens if the owner
  does not follow it.
- **Never:**
  - silently reassign protected money;
  - change an approved plan;
  - execute a payment.
- **Plan history:** approved plans and overrides are kept with date and reason. This needs a new
  store, and so a database change (approval required, U1 in section 11).
- **Disclosure:** stale data and incomplete data are disclosed. They reduce confidence, and the
  exact "can go to other purposes" figure is withheld or qualified (P0-2, DIR-3).
- **Stale-data thresholds (U9, decided; provisional and configurable).** Flag:
  - an account balance not confirmed by the owner today;
  - PBSRx data older than 24 hours;
  - obligations not reviewed or refreshed for 24 hours.

  These values are **provisional defaults**. The owner can change them in settings, and the
  Director always shows which threshold was exceeded and when the data was last current.
- **Owner confirmation is not reconciliation.** "Balance matches today" means the owner looked at
  the displayed balance and said it matches. It is always labelled **"Confirmed by you, not
  independently verified"**, and is never called a bank reconciliation or an independent
  verification. KoboFlow has no bank connection. Storage and behaviour: Stage 2, item 9.
- **Uncertain money is never available money (U5b, decided).** If household or shared-account
  balances are included in pharmacy cash while their pharmacy-owned portion is unresolved, that is
  a **high-severity** item. The exact free-to-spend amount is withheld (or, where the uncertain
  amount is identified and can be excluded, qualified with that amount stated).
  - **Withholding the amount is not enough on its own.** Payment coverage, shortfalls, free-to-use
    and the floor check are also calculated conservatively, on **pharmacy-eligible cash**: cash in
    accounts explicitly identified as Business and confirmed (Stage 2, item 10).
    - Earmarks held in Personal, Shared or unconfirmed accounts never count as pharmacy coverage
      (G1).
    - Any broader figure that includes uncertain money is shown separately and labelled
      uncertain.
  - **One definition on every screen (G2).** The Director, Calendar, Pressure, Autopilot and the
    Opportunity Analyzer all use the same pharmacy-eligible cash definition, with the same
    treatment of commitments, obligations and the floor.
  - **Nothing known is hidden.** Known obligations, due dates, overdue items, shortfalls,
    consequences, alternatives and available actions stay visible whenever the exact amount is
    withheld.
- **When obligations cannot all be met:**
  - list them;
  - state the consequence of leaving each unpaid (charges, supply risk, relationship risk);
  - **ask the owner to choose**. The priority order is the owner's decision (H6).

## 3. Five protected buckets

**Agreed provisional targets (unchanged by the U2 decision):**

| Bucket | Target | Purpose |
|---|---|---|
| Inventory | 35% | Stock purchases |
| Supplier | 25% | Supplier payments (credit repayments) |
| Expenses | 20% | Operating expenses |
| Owner | 15% | Owner support |
| Reserve | 5% | Emergencies and buffer |

### Calculation basis (U2, decided)

- **PBSRx keeps its existing calculation, unchanged,** for its own reporting. The owner describes
  it as the targets applied to total daily sales (capital + profit).
- **As implemented in PBSRx** (`344b565`, read only, verified in code):
  - the Cash Desk splits the day's **cash collected** field (`cd_c`, `calcB`);
  - the weekly and monthly summary (`renderAllocSummary`) uses each day's `cash`, and falls back
    to `sales` when no cash was recorded.
  - The audit found that collected cash includes change given (audit E1), so the PBSRx bucket
    figures inherit that defect. This is recorded here, not changed: **KoboFlow must not silently
    change the basis in PBSRx**, and any PBSRx correction is a separate, approved PBSRx task.
- **KoboFlow keeps these apart and never merges them (correction 1):**

  | Concept | What it is | Current source and reliability |
  |---|---|---|
  | **1. Sales** | The value of goods sold | **Not available.** No validated sales feed exists. KoboFlow has no sales record, and PBSRx sales are unvalidated (E1) |
  | **2. Cash collected** | Money actually received | KoboFlow income entries (category "Pharmacy Sales" and others). These are **recorded receipts, not validated total sales**, and are not interchangeable with sales. They include collections of earlier receivables, which are never new sales (section 5). Shown for information only (U13). Future-dated receipts are excluded from current totals until their effective date (S4) |
  | **3. Actual account balances** | Money recorded as held in real accounts | KoboFlow accounts. Subject to owner confirmation (U9) and ownership classification (section 4) |
  | **4. Committed money** | Linked earmarks, reserved obligations, approved plans | KoboFlow |
  | **5. Real payments** | Recorded payments | KoboFlow entries only |
  | **6. Virtual bucket targets** | Planning allocations: percentage × a validated sales basis | **No live targets until a validated sales basis exists (U13).** Recorded receipts never silently become the basis. Not separate cash, and not proof of funding |
  | **7. Available-to-spend money** | The conservative amount the Director can justify | Business-only actual cash (section 4, Stage 2 item 10), less commitments and uncovered obligations, less the active floor. Qualified or withheld when ownership or data quality is uncertain |

  **Allocation basis (U13, owner-decided at revision 5).**
  - **Hold live five-bucket allocation recommendations** until a validated sales basis is
    available.
  - **Recorded receipts / cash collected may be displayed for information only.** They are labelled
    "recorded receipts, not validated sales". They must not silently become the allocation basis,
    and no live targets are calculated from them.
  - The 35/25/20/15/5 percentages stay provisional, pending validation and historical evidence.
  - A validated sales basis is expected from PBSRx after stage 8. Live allocation recommendations
    start only after that validation is recorded.
  - **The hold applies to activation, not to building (owner direction, revision 6).** The
    following can be implemented and tested before a validated sales basis exists, using validated
    or explicitly labelled test inputs:
    - the bucket rules and provisional percentages;
    - sales-based target calculations;
    - funding and allocation tracking;
    - Reserve restrictions and approval;
    - cross-bucket rules;
    - over-allocation and insufficient-funding warnings;
    - allocation history and reconciliation;
    - the handling of refunds, credit sales and collections of old debts.

    Test fixtures, illustrative figures, targets, recorded allocations, funded amounts and real
    available cash are always labelled as what they are. Whether recorded allocations of real money
    may be used live before a validated sales basis exists is decided by U14 (section 11): yes, for
    explicitly recorded, owner-confirmed allocations such as a Reserve allocation, provided the
    ownership, confirmation, funding and reconciliation safeguards are met; live sales-based bucket
    targets and allocation recommendations still wait for stage 8.
  - **Target and funding are separate calculations.** A target is never money in an account, proof
    of collection, or permission to spend. Funding is the actual pharmacy cash allocated to a
    bucket, never more than available pharmacy cash.

  **Unfunded target (S2).** This applies only once a validated sales basis exists. When the target
  calculated on validated sales exceeds the cash actually collected (for example, credit sales),
  the difference is shown as **unfunded target**, never as cash. Until then, informational receipts
  and any virtual targets are never presented as funded cash or available-to-spend money.
- **KoboFlow's own receipts are not assumed reliable** just because PBSRx figures are excluded.

  **Material income-quality warnings (S3).** Each one makes the affected receipts "provisional" in
  the informational receipt figures, and names the entries:

  | Warning | Detected by | Effect on informational receipts | Effect on live allocation recommendations |
  |---|---|---|---|
  | Misclassified income (refund or gift saved as income, D4 patterns) | Stage 2 warning; Stage 4 prevention | Marked provisional; the amount stated | Held regardless (U13). Once a validated sales basis exists, the affected days' recommendations are withheld until the warning is resolved |
  | Unexpected or invalid From account on income (`income_with_from`) | Existing warning | Marked provisional | As above |
  | Future-dated receipts | Existing `future_dated` warning | Excluded from current totals until the effective date (S4) | As above |
  | Duplicate or possible duplicate receipts | Existing `possible_duplicates` warning | Counted once in the informational total, the possible duplicate shown separately as "possible duplicate, not added"; never deleted or merged automatically | As above |

  **While a validated sales basis is unavailable,** informational receipts never drive live
  recommendations, whether or not these warnings are open (U13).

  **Future-dated receipts (S4):**
  - excluded from current-period receipt totals until their effective date;
  - until then, labelled "future-dated" and never treated as current cash collected,
    pharmacy-available money or allocation funding;
  - once effective, they are still informational recorded receipts, not a validated sales basis.

  Stage 7 depends on the Stages 2–4 safeguards for this reason.
- **PBSRx bucket figures never drive live recommendations until validated (U12, decided).**
  - PBSRx's own bucket figures are not used for live allocation recommendations until the
    underlying calculation (cash collected versus sales, change given, rebuilt day records) has
    been validated and corrected where necessary (stage 8).
  - Until then, wherever they are shown, they are labelled **"PBSRx figure, unvalidated"** and
    kept out of every Director calculation, recommendation and confidence check.
  - Tests prove that changing an unvalidated PBSRx bucket figure changes no Director figure or
    recommendation.
  - Excluding PBSRx does not validate KoboFlow's receipts. See the previous point.
  - A PBSRx sales figure can become the validated sales basis (U13) only after stage 8 validates
    it.
- **Sustainability check before any change to the targets.** Use the historical assessment
  below. No change to the percentages is recommended until that evidence exists.

### Rules

- **Inventory and Supplier both fund stock purchases and supplier payments.** Moving between those
  two is within the stock purpose. It is still shown, but needs no emergency override.
- **Reserve is protected from routine spending (U3, decided):**
  - Using Reserve for any other purpose requires the owner's explicit approval.
  - **Before asking**, the Director states:
    - the amount;
    - the reason;
    - the consequence (how much Reserve is left, and what it then cannot cover);
    - the alternatives (other buckets, deferring, partial payment, timing of expected inflows).
  - **Approval to reallocate is not a payment.** It changes no account balance. The payment is
    recorded separately, when it is actually made.
  - **Urgent obligations are still surfaced honestly,** even when only Reserve could cover them.
    Protection never hides a due payment.
- **An allocation is not a transfer or a payment.** The money can stay in Opay or any real
  account; KoboFlow tracks what it is intended for. Bucket totals must reconcile to actual cash at
  all times. If allocations exceed the actual available business cash, that is shown as
  over-allocated, never hidden.
- **Cross-bucket use needs approval.** Any use of one bucket's money for another purpose (outside
  the Inventory–Supplier pair) needs the owner's explicit approval. Before approving, the screen
  shows what the source bucket will then be short of, and when that shortfall bites. The approval
  is recorded in plan history.
- **The percentages are provisional targets.** Totalling 100% does not make them optimal.
  - **How they will be assessed:** after at least 3 complete months of reliable records (count to
    be confirmed by the owner), compare each bucket's target with what it actually needed. The
    comparisons are:
    - stock bought versus stock sold (needs PBSRx);
    - supplier payments due versus paid on time;
    - operating expenses versus the Expenses bucket;
    - owner withdrawals versus the Owner bucket;
    - how often the Reserve was used.
  - **Report:** months a bucket ran short, months it was over-funded, and the effect on missed
    payments and stock-outs.
  - **Changes:** propose new targets with the evidence. Change them only with the owner's
    approval, and keep the history.
- **Relation to existing features:**
  - The working-capital floor and earmarks exist today (partially complete).
  - Linked earmarks for bills and loans remain the mechanism for "money for this specific
    payment".

### Pharmacy working-capital floor (U4, decided)

- **The floor is separate.** Inventory plus Supplier allocations do **not** replace it. Buckets say
  what money is *for*; the floor is the minimum of real pharmacy liquidity that must remain.
- **Its basis is evidence:**
  - validated operating costs;
  - stock replacement needs;
  - near-term obligations;
  - reliable history.

  It is **never an invented amount or percentage**. Until that evidence exists, the floor stays the
  owner-set manual figure (the earlier decision), labelled "owner-set, not yet validated".
- **Replacing the manual floor (U4a, decided; correction 4):**
  - a calculated floor is proposed with its inputs shown. A proposal never replaces the active
    floor before approval;
  - it **replaces the manual floor only after the owner explicitly approves it**;
  - until then the manual floor stays in force, and the proposal is shown beside it;
  - **an approved calculated floor is a fixed active value.** Later recalculations create new
    proposals; they never change the active floor silently;
  - **rejection** leaves the active floor unchanged and is recorded;
  - **each decision record holds:**
    - the previous floor value;
    - the proposed or new value;
    - the decision time;
    - the decision-maker, recorded as "you, on this device" (the app has no user identities);
    - the inputs and evidence used for the proposal;
    - the reason;
    - the outcome: approved, rejected, or restored;
  - **prior values stay recoverable.** The owner can select a previous floor from the history and
    restore it, which is itself recorded as a decision;
  - **where it is stored:** the existing setup history (`ledgerSetup.history`). It already records
    floor changes with old and new values and a time; the new fields extend those entries.
    Verify at implementation that this fits the setup save and backup path. If so, no new store
    and no dependency on U1 is needed. A new store would only be justified if the setup history
    proves unable to hold or back up these records, and that would need U1 approval.
- **What it is measured against:** eligible real business liquidity, meaning pharmacy accounts plus
  the identified pharmacy portion of shared accounts (section 4), with immediate access only.
  - **Until Stage 3,** the floor check uses the conservative Business-only cash from Stage 2. It
    discloses the uncertainty and never counts household, shared or unconfirmed balances.
  - **No double counting.** Buckets are labels on the same cash, not extra money. The floor check
    subtracts real commitments (uncovered obligations due) once, and never subtracts bucket
    allocations a second time.
- **Breach warning.** When a proposed payment would take liquidity below the floor, the Director
  warns before it is recorded and explains the trade-off: what is protected, what is at risk, and
  the alternatives. The owner decides; nothing is blocked silently, and nothing is paid
  automatically.

## 4. Business and household money (critical priority)

**Why this is core.** The owner has stressed that today it is hard to tell whether pharmacy cash is
paying for the household, or household cash is paying for the pharmacy. Answering that question
reliably is **a core outcome of the turnaround**, not a minor account setting. It answers audit
decision H1 and the confirmed U5 decision.

### Two separate questions on every entry

| Question | Answer | Moves money? |
|---|---|---|
| **Where is the money held?** | The real account (Opay, bank, cash…), via `fromAcct` / `toAcct` | Yes: balances move only through these |
| **Whose money / what purpose?** | Pharmacy, household, shared or unclassified | No: a classification only |

- The account says *where*; the purpose says *for whom*. They can differ. For example, pharmacy
  takings held in a personal Opay wallet, or a household bill paid from the pharmacy bank account.
- **Purpose is recorded per relevant entry and per account.** An entry with no stated purpose takes
  its account's "Used For". If neither is set, it is **unclassified**: flagged, never guessed.
  - This is a new optional field on existing records (like the destination names). No database
    version change is expected; confirm when the stage starts.

### Rules

- **Personal (household) accounts:**
  - stay visible in total finances and Net Worth;
  - are **excluded** from pharmacy-available cash, the pharmacy working-capital floor and the five
    buckets.
- **Pharmacy money used for the household:**
  - a transfer from a pharmacy account to a household account is recorded as an **owner
    withdrawal** (owner support), not a pharmacy operating expense;
  - a household purchase paid directly from a pharmacy account is the same in substance: it
    reduces pharmacy cash, counts as owner support, and is excluded from pharmacy operating
    expenses and break-even;
  - either way, it is shown as such ("pharmacy cash used for household: ₦X this month").
- **Household money used for the pharmacy:**
  - a transfer from a household account to a pharmacy account is an **owner contribution**
    (capital injection, own money), never sales revenue;
  - a pharmacy expense paid directly from a household account is a pharmacy expense (it counts in
    pharmacy costs and break-even) funded by an owner contribution, and it does not reduce
    pharmacy cash;
  - shown as "household money used for pharmacy: ₦X this month".
- **Transfers** within the same side (pharmacy to pharmacy, household to household) are neither
  income nor expense. This is already true.
- **Shared accounts (U5a, decided):**
  - never count their whole balance as pharmacy cash;
  - the owner declares an **opening pharmacy portion** for each shared account, with a date;
  - after that, the portion changes **only** through entries explicitly classified by purpose: a
    pharmacy-purpose receipt raises it, and a pharmacy-purpose payment lowers it. Household or
    unclassified entries never change it;
  - it is **reconciled against the actual account balance**. A discrepancy is flagged, never
    absorbed silently. Examples: a portion larger than the balance, a negative portion, or
    unclassified movements large enough to make the portion uncertain;
  - until an opening portion is declared, or while a discrepancy is unresolved, the account
    contributes nothing to pharmacy-available cash. This is high severity (U5b).
- **Accounts with no "Used For"**, or with a Business value the owner never confirmed, are flagged.
  They are never guessed or silently reclassified, and they lower the Director's confidence.
- **Correction:**
  - a misclassified entry is corrected through the existing edit flow (same id, review step,
    `edits[]` history);
  - changing purpose never creates or removes a cash movement;
  - all figures recompute.
- **A pharmacy balance is not all spendable.** Commitments, protected buckets, the Reserve and the
  working-capital floor still apply.
- **Separate accounts are not required.** KoboFlow works with mixed accounts. The plan should still
  explain, in the app's help text, that physically separate pharmacy and household accounts make
  discipline and reconciliation easier. That is advice, not a prerequisite.

### Current state: partially complete

- The account "Used For" setting (Business / Personal / Shared) is saved, but dropped in
  `applySetup`, so personal balances count as pharmacy free cash (DIR-4).
- **New accounts silently default to Business (fact, code).** The selector has no "not chosen yet"
  option, so a stored Business value may not be the owner's choice. Stage 2 adds a one-time
  confirmation; Stage 3 adds "not chosen yet" and stops the default.
- **Already exist:** owner withdrawal and capital-injection types, and the edit flow with review.
- **Missing:**
  - per-entry purpose;
  - shared-account portions;
  - unclassified flags;
  - pharmacy-versus-household summaries.

## 5. Receivables and expected inflows

**Not started.** No such record exists today. These requirements answer audit decision H2:
KoboFlow records receivables itself.

**Scope:** all money owed to the owner, not only pharmacy customers.

**Fields:**
- debtor;
- amount;
- reason;
- date lent or sold;
- expected date, which may be missing (a missing date is shown as "no expected date");
- partial receipts;
- outstanding balance (derived);
- notes or reference;
- status: open, partly received, received, overdue, rescheduled or cancelled.

**Rules:**
- **Receipts:**
  - a partial receipt reduces the outstanding balance;
  - a full receipt closes the receivable;
  - each receipt is one cash entry into a real account, linked to the receivable and protected
    against duplicates.
- **Overdue items** stay on the follow-up list until they are paid, or explicitly rescheduled
  (new date, with the reason kept) or cancelled (with the reason kept, never deleted).
- **Seen is not paid.** Marking an alert seen does not mean the debt was paid.
- **Forecast only.** An unpaid receivable is an expected inflow in the forecast and never cash in
  the Director. If it is overdue, the forecast shows it as at risk.
- **Duplicates:**
  - receiving the money must not also be entered as separate income;
  - when PBSRx credit sales arrive later, they must reconcile to existing receivables by source id,
    not create a second receivable.

**Credit sales, collections and pending money (revision 6):**

| Event | Sales | Receivable | Cash |
|---|---|---|---|
| A pharmacy sale on credit | Recorded as a sale **by PBSRx only** (the source of truth for pharmacy sales); KoboFlow never records a second sales figure | Created once, for the unpaid amount, as a KoboFlow receivable with a stable source reference where available, until PBSRx supports credit sales (U15, decided) | No change |
| A customer pays an earlier debt in full | No change (not a new sale) | The existing receivable is reduced to zero and closed | Increases once, by the amount received |
| A customer pays part of a debt | No change | Reduced by exactly the amount received; the rest stays open | Increases once, by the amount received |
| A transfer is promised or pending | No change | Stays open, marked "payment pending", with the expected date | **No change.** Pending money is never available cash |
| A payment fails or never arrives | No change | Stays open, or returns to open, with the failure noted; the overdue rules apply | No change, or the provisional receipt is reversed through the normal reversal |
| A receipt is corrected, retried, double-tapped or imported again | No change | The same receivable stays linked | **Moves at most once.** Idempotency key or stable source id; a correction uses the existing edit or reversal flow |

- **Stable links.** Every receipt keeps a link to its receivable (and, after stage 8, the PBSRx
  source id of the originating sale), so nothing is counted twice when integration arrives.
- **Forecast only.** Open and pending receivables are expected inflows, labelled by certainty
  (confirmed date, promised, overdue, at risk) and date. They are never current cash.
- **Gap (fact, PBSRx code `344b565`):**
  - PBSRx has no customer credit-sale or receivables feature;
  - a POS sale paid less than the amount due is still saved as a full sale, and the unpaid
    remainder is recorded nowhere;
  - where a pharmacy credit sale is recorded until PBSRx supports it is **decided (U15, section
    11)**: a KoboFlow receivable, reconciled to PBSRx by source id once that integration exists.

## 6. Loans and liabilities

**Checkpoint:** `cb5f209`. See `docs/loan-principal-and-settlement.md`.

**What it does:**
- Extra principal is counted once.
- The agreed instalments stay until the lender confirms new ones (flagged "Schedule needs
  review").
- An amendment records which extra payments it reflects.
- A full principal payoff keeps known interest and fees owed.
- A settlement is saved only when the lender's figure is confirmed and the payment is already
  made.
- A quote only previews.

**Disclosed edge cases, still open:**
- an older amendment that did not include an earlier extra payment now overstates the liability
  (flagged);
- a reversed extra payment that an amendment reflects (flagged);
- extra principal beyond the schedule (flagged);
- counting extra principal against the last instalments is a placeholder until the lender's
  behaviour is known (H3);
- "needs review" is not yet shown in the Director;
- ordinary payments have no separate "verified" status.

**Rules for later stages:**
- Keep principal, interest, fees, actual payments, expected instalments and settlement status
  distinct.
- Never invent lender-approved terms.
- **Net Worth loan liability (H5, owner-confirmed 2026-10-24, fourth revision).**
  - This is a decision the owner made at this revision. It was not documented in any earlier
    record; the audit and the loan-fix report both listed it as open.
  - **The rule:**
    - **Net Worth** includes outstanding loan principal plus interest and fees **already due**;
    - **"Already due" means demonstrably due (H1, owner-decided at revision 5).** Only interest and
      fees whose amount can be shown from a supported, verifiable split enter current liabilities.
      If a payment split is unknown (for example, a provisional "split not yet known" payment
      against a partly paid instalment), the amount is flagged as **uncertain** and never invented.
      No estimate enters current liabilities unless the owner separately approves that;
    - **future instalments and future interest** belong in the Cash-Obligations Forecast, not
      among current liabilities;
    - future interest is never double-counted as money already owed;
    - extra principal reduces the liability exactly once;
    - revised repayment schedules are never invented when the lender's treatment of an extra
      payment is unconfirmed (flagged instead).
  - **Disclosure:** excluding future interest from current liabilities can **raise reported Net
    Worth without reducing the future cash actually needed for repayments**. Net Worth must show
    this as a note, with the future scheduled interest amount alongside.
  - **Two figures, everywhere (H2).** The loan screen, the Loans summary, the Brief and Net Worth
    distinguish:
    1. **Current loan liability:** outstanding principal plus demonstrably due interest and fees;
    2. **Remaining scheduled payments:** future instalments, including future interest, shown as a
       cash-forecast commitment and never hidden.

    Labels, totals and explanations agree across the loan screen, Net Worth and the forecast,
    without double counting.
  - **Today (fact, code):** Net Worth, the loan screen's "Outstanding", the loan card, the Loans
    "Total Owed" and the Brief all use `outstanding.total`, which includes all future scheduled
    interest. The change is implemented in Stage 5.
- **Early settlement to qualify for a larger stock facility** (decision support only). Compare:
  - the quoted settlement and its cash effect on the buckets and the forecast;
  - the new facility's total cost (the existing Opportunity Analyzer);
  - the stock return it is expected to finance, labelled as an estimate.

  The Director may present this comparison but never assumes it is worthwhile. The old loan
  settles only through the confirmed-and-paid settlement flow.

## 7. Restocking and inventory

**Rules (these answer audit decision H4 in principle):**
- **A stock purchase is recorded as a real cash outflow.** It is not cost of goods sold at
  purchase. COGS comes from validated PBSRx sales at cost.
- **Stock as an asset:** remaining stock goes into Net Worth only when PBSRx quantities and
  valuations are validated. Until then Net Worth shows stock as "not valued".
- **Do not rely** on unvalidated stock valuation or margin data.

**Current state:** conflicts with these rules.
- "Restocking" is treated as an ordinary operating expense in Analytics, runway, cash flow,
  Autopilot and Restock ROI (audit B1).
- The interim treatment until PBSRx is validated is unresolved (U7).

## 8. PBSRx and system boundaries

**Who owns what:**
- **PBSRx** is authoritative for pharmacy operations: stock, batches, expiries, sales, supplier
  invoices and supplier outstanding balances.
- **KoboFlow** owns the consolidated financial picture: break-even, the cash forecast and the
  Director.

**Supplier obligations:**
- Start as a **read-only feed** from PBSRx, with stable source ids and reconciliation.
- **No second supplier ledger** in KoboFlow. Today KoboFlow keeps none.

**Duplicate protection:**
- No duplicate cash events, sales, supplier obligations or payments.
- Importing is idempotent by `sourceId` (contract in `docs/pbsrx-financial-handoff.md`).
- A payment made in KoboFlow and also reported by PBSRx must reconcile to one event.

**Validation:** all PBSRx data is treated as unvalidated until the relevant calculations and
interface are verified. Known PBSRx defects (audit B5, E1):
- collected cash includes change given;
- day records are rebuilt, and expenses can be lost;
- refunds are unlinked;
- dates are in UTC;
- net profit has no COGS;
- break-even includes principal and defaults to 0.

**Read-only inspection of PBSRx `344b565` (revision 6; facts from the code, no tests exist in the
repository):**

| Figure | What PBSRx actually records | Reliable for KoboFlow? |
|---|---|---|
| Gross sales | `sale.total`: basket total at entered prices, before discount | Usable once validated |
| Net sales | `sale.due` = total − discount; the day's `cashDays.sales` adds `due` | Usable once validated |
| Discounts | `sale.discount` on each POS sale | Yes, per sale |
| Cash collected | `cashDays.cash` adds `cash + transfer` **as tendered**, so change given back is included | **No** (overstated by change) |
| Change given | Shown on screen only; never stored | **No** |
| Short-paid sales | The sale is saved for the full `due` even when tendered < due; no debt is recorded | **No** |
| Credit sales and collections | No customer credit or receivables feature | Not available |
| Customer refunds | `salesReturns`; a cash refund reduces **today's** `sales` and `cash` (clamped at 0) regardless of the original sale date, and is not linked to the sale; transfer refunds and store credit do not reduce sales; store credit is not recorded as a liability | **No** |
| COGS and gross profit | `profit = qty × (price − current costPrice)` per line; ignores discount; uses the current cost, not the batch cost; sell-unit price against cost price (unit mismatch risk) | **No** |
| Five-bucket figures | First POS sale of the day: % × `due`; later sales recompute % × `cash` (tendered); so the basis changes within one day | **No** |
| Supplier balance | `openingBalance + GRN invoices − payments − return credits`; invoices and returns are matched by supplier **name**, payments by **id** (a rename breaks it) | Usable only after a name/id fix and validation |
| Supplier due dates | One `creditDays` per supplier (default 30); no due date per invoice; payments are not matched to invoices | **No** for per-invoice due dates |

**Smallest safe PBSRx fixes (a PBSRx-side task, separately approved; nothing is changed here):**
1. Store `changeGiven = max(0, tendered − due)` and record cash collected as `tendered − change`.
2. Refuse, or record as a customer debt, any sale with tendered < due.
3. Use one bucket basis (net sales) for every sale of the day.
4. Link refunds to the original sale and date; record transfer refunds; record store credit as a
   liability.
5. Match supplier invoices, returns and payments by id.
6. Calculate COGS from batch cost in base units.

Each fix needs fixture tests in PBSRx (none exist today): change given, short payment, a refund
of an earlier sale, a day with mixed sales, a supplier rename, and a multi-unit product.

**Document conflict:** the handoff document says PBSRx is on its own origin. The audit found the
repository's PWA test models a shared origin (P2-3). This must be corrected and the credential
exposure assessed before integration.

---

## 9. Implementation sequence

### Why this order differs from the requested order

The guiding order is unchanged:
1. financial truth and data quality first;
2. PBSRx validated before its gross-margin data is used;
3. no break-even presented as authoritative on unvalidated inputs.

Changes:

1. **Business/household separation moved up (requested 4, now 3), ahead of quick-entry
   classification (now 4).**
   - The owner made separation a critical priority.
   - The quick-entry fix sends ambiguous phrases to review. Doing it after separation lets that
     review offer the pharmacy/household purpose (for example "gift for mum" as household), instead
     of a second change later.
   - The risk of delaying D4 is limited: stage 2 adds a read-only warning that lists existing
     quick entries matching the D4 patterns, so they are not silent in the meantime.
2. **Stage 2 now includes the interim, conservative parts of separation:**
   - a warning for accounts with no "Used For", or one that was defaulted and never confirmed;
   - a warning for shared accounts;
   - a one-time confirmation of each account's "Used For";
   - a conservative Business-only view, used for payment coverage, shortfalls, free-to-use and the
     floor check (correction 3), with any broader figure shown separately as uncertain;
   - the same pharmacy-eligible cash definition on the Director, Calendar, Pressure, Autopilot and
     Opportunity Analyzer (G2), and earmarks in non-Business accounts excluded from pharmacy
     coverage (G1).

   This makes the Director truthful, and protective of pharmacy cash, before stage 3 fixes the
   underlying separation.
3. **Receivables moved after cash-flow reconciliation (requested 5, now 6; reconciliation
   requested 6, now 5).**
   Receivables add new cash events (partial receipts). The cash-flow statement should reconcile
   correctly (D1) before new event types are added, otherwise a new defect could not be told apart
   from an old one.
4. **PBSRx validation and integration moved before break-even (requested 9, now 8).**
   - Break-even and the evidence-based floor need validated gross margin, COGS and stock
     replacement data, and only PBSRx has them.
   - An estimate-only break-even (U8), if approved, must be labelled "estimate, not validated" and
     must not feed the Director as fact.

### Is Director truthfulness still the right next stage? Yes

- **It is the screen the owner acts on.** Today it can show a confident "can go to other purposes"
  amount while its own checks report problems (DIR-3). Every later stage feeds the Director, so
  its honesty about confidence must come first; otherwise later improvements would be presented
  with false certainty.
- **It is low risk.**
  - It changes no financial records: no transactions, obligations, loans or earmarks are created,
    altered or reconciled.
  - It adds only a conservative read-only calculation (pharmacy-eligible cash, used on five
    screens) and small local confirmation records (U9, and the Used For markers of G4).
  - Whether the confirmation records need a database version change is verified at stage start.
  - Rollback is simple.
- **It makes the critical separation problem visible at once,** before it is fixed in stage 3.
- **It depends only on stage 1,** which is committed.

### Stage summary

| # | Stage | Main audit items | Depends on | Status |
|---|---|---|---|---|
| 1 | Loan principal and settlement integrity | P0-1 (D2, D3) | — | **Awaiting verification** |
| 2 | Director truthfulness and data-quality coverage, including the conservative pharmacy-eligible cash view on five screens and separation warnings | P0-2 (DIR-1, 3, 5, 6), P0-4, E3–E5, DIR-4 (interim), U9, G1–G5 | 1 | Partially complete — interim parts only, delivered together with stages 1, 3 and 5's H5 item; see the implementation-scope note below |
| 3 | Business and household separation (critical priority) | P1-1 (DIR-4), H1, U5 | 2 | Partially complete — core separation (U5, U5a, G1, G4) applied, delivered together with stages 1, 2 and 5's H5 item; see the implementation-scope note below |
| 4 | Quick-entry classification safety | P0-3 (D4) | 3 (purpose available in review) | Not started |
| 5 | Cash-flow statement reconciliation; bill and obligation action links; Net Worth loan liability (H5) | P1-4 (D1), P1-5 (DIR-2), H5 (with H1–H3) | 2 | Partially complete — the H5 Net Worth change only, delivered together with stages 1–3; see the implementation-scope note below |
| 6 | Receivables, partial receipts, overdue follow-up; expected inflows in the forecast | P1-2, H2 | 3, 5; U1 | Not started |
| 7 | Five buckets (targets held until validated sales, U13), Reserve protection, floor breach warnings, approved overrides, plan history | P1-3 (part), sections 3 and 4, U2–U4, U12, U13 | 2, 3, 4, 6; U1; live allocation recommendations also need 8 (validated sales basis) | Partially complete (manual floor and earmarks exist) |
| 8 | PBSRx validation, supplier-obligation feed, reconciliation | P2-1, P2-2, P2-3 | 5, 6; PBSRx-side fixes | Partially complete (contract documented only) |
| 9 | Financial Break-Even Calculator; evidence-based floor proposal; inventory as an asset | section 2A, section 3 (U4), section 7, H4 | 3, 8 | Not started |
| 10 | End-to-end acceptance, offline and reopen reconciliation, release readiness | P2-7, audit G | all | Not started |

**Implementation-scope note (revision 7).** An integrated implementation pass on
`claude/koboflow-loan-management-qn2vql` (uncommitted; independently audited) delivered, together
and as one unit, work this plan's sequence above assigns separately to stages 1, 2, 3 and 5:
- **Stage 1** (loan principal and settlement integrity), in full, as already recorded above.
- **Stage 2**, only its interim, conservative parts (item 10 of the Stage 2 detail below): the one
  shared pharmacy-eligible cash calculation on five screens (G2), the "Used For" confirmation
  marker and its lifecycle (G4), and ownership warnings surfaced through the existing
  data-quality/confidence gate. Not delivered: U9 (balance confirmation), the three-state
  confident/qualified/withheld model, and the DIR-1/3/5/6 wording fixes — the rest of Stage 2's
  scope remains open.
- **Stage 3**'s core separation (U5, U5a, G1, G4): "Used For" no longer defaults to Business, a
  Shared account counts only its declared, confirmed portion, and household money is kept out of
  pharmacy-available cash in the one shared calculation above. Not delivered: a per-entry purpose
  field, full per-entry/running shared-account tracking, and Stage 3's other items (P3-2, P3-3).
- **Stage 5**'s Net Worth change only (H5): the current-liability/remaining-scheduled-payments
  split. The rest of Stage 5 (D1 cash-flow reconciliation, DIR-2 action links, P2-4–P2-6) is not
  started.

This note records what the current diff contains. It does not substitute for each stage's own
independent review, test-site publication and Android acceptance above, which remain outstanding
before any stage is marked complete, and it marks no later-stage requirement (receivables,
buckets, PBSRx, break-even) as done.

Remaining P1, P2 and P3 items are placed where they fit (full mapping in section 12):
- **Stage 2:** the beyond-30-day note on commitments (P1-3).
- **Stage 3:** investment without a To account (P3-2) and a single "left after" horizon (P3-3).
- **Stage 5:** bill reminders (P2-4), cross-tab protection (P2-5) and the missing tests (P2-6).
- **Stage 7:**
  - the Autopilot percentage heuristics (P3-1);
  - the monthly destination, progress and trading days (P1-3).
- **Stage 9:** pharmacy performance, shown as "not available" until validated (P1-3).

### Stage details

#### Stage 1: Loan principal and settlement integrity

- **Problem and outcome:** see section 6. Every screen shows a loan's liability correctly after
  extra principal, an amendment or a settlement.
- **Dependencies and data:** none.
- **Scope:** the engine `agreementBalances` / `instalmentStates`, and the loan, amendment and
  settlement screens. **Non-goals:** Director wording, receivables, PBSRx.
- **Tests:**
  - `tests/loan-principal.test.js`: 16 tests (engine; a 40-case comparison with the previous
    release; both builds);
  - full suite 311/311 at `cb5f209`.
- **Definition of done:**
  - committed and pushed (done);
  - independent review;
  - published to the isolated test site after approval;
  - Android device acceptance using the fictional scenarios.
- **Risks and open items:** the disclosed edge cases in section 6; H3. H5 is now decided, and its
  Net Worth change is implemented in Stage 5, not in this stage.
- **Status: awaiting verification.** Implementation is reported complete. Independent review,
  test-site publication and Android verification are outstanding.

#### Stage 2: Director truthfulness and data-quality coverage (next task)

**Problem.** The Director can be more confident than its data allows:
- it shows an exact "₦X can go to other purposes" while high-severity issues exist (DIR-3);
- `qualified` ignores medium items, so the banner says "No problems found in the records" while
  listing future-dated income or possible duplicates;
- an overdue payment that is fully earmarked gets no action (DIR-1);
- shortfall and floor wording is wrong, and amounts print as "₦-140,000" (DIR-5);
- "today's income is already inside Cash Now" is untrue for restricted, unmapped or missing
  accounts (DIR-6);
- the loan "Schedule needs review" flags from stage 1 are not shown.

Several silent distortions are also never flagged:
- stored negative amounts;
- unknown transaction types;
- Income or Expense with category "Loan";
- a bill that looks like a loan already in Loans;
- an earmark linked to an obligation but held in a restricted account;
- quick entries matching the D4 patterns;
- Personal accounts, Shared accounts, and accounts with no "Used For" or an unconfirmed Business
  default: their whole balance is counted as pharmacy cash today (DIR-4, G5);
- stale data: balances not confirmed today, and obligations or PBSRx data not refreshed.

**Coverage statements use household money (fact, code).** "Free cash covers it", "covers only
part", the shortfall and the floor check are all calculated on free cash that includes
Personal and Shared accounts (`directorPlan`).
- **Example:** pharmacy money ₦50,000, household ₦200,000, rent ₦100,000 due. The Director today
  says rent is covered.
- Withholding only the final amount would not correct that.
- **Earmarks are funded from their account's balance** (`reservationPlan`). So an earmark held in a
  Personal or Shared account can "cover" a pharmacy obligation today, and DIR-1's planned "money
  is already set aside" action could point at household money (G1).
- **The same all-account definition is used by four other screens (fact, code):**
  - Calendar (`renderCalendar`);
  - Pressure (`renderPressure`);
  - Autopilot;
  - the Opportunity Analyzer (`freeCash()`).

  The code is written so that these and the Director share one figure. Changing only the Director
  would make the screens disagree (G2).

**"Used For" is silently defaulted (fact, code).**
- New accounts default to Business, and the selector has no "not chosen yet" option. An account
  without a value is saved as Business on the next setup save.
- **So a Business label may not be the owner's choice.**
- The stored value is kept in the setup, but is not passed through to the cash calculations
  (`applySetup`).

**User outcome.** The Director never states more certainty than the records support. Every
known distortion, including mixing of household and pharmacy money, is visible, with the record it
comes from.

**Dependencies and data assumptions:**
- Stage 1 is committed (`cb5f209`). Its review and Android check can run alongside, because stage 2
  only reads loan figures.
- Existing data quality (`dataQuality`) already covers: future-dated, income with a From account,
  missing account, needs review, possible duplicates, before baseline, and unmapped account. These
  are kept unchanged.
- **Stored data (correction 2):**
  - **No financial record** (transaction, obligation, loan, earmark or setup account) is created or
    altered.
  - **New stored values** go in **separate records in the existing `meta` store** (keyed by `id`,
    as `settings` already is), **not** in setup fields. Saving the setup rebuilds the account and
    planning fields from a fixed list (`confirmSetup`), so setup fields would be erased. The new
    values are:
    - a balance-confirmation record per account;
    - an obligations-review record;
    - the three threshold settings;
    - the per-account "Used For confirmed" marker, item 10 (lifecycle in item 10, G4).
  - **Verify at implementation:** the exact record shape, and whether adding these `meta` records
    needs a database version change. Adding records with new ids to an existing store is expected
    not to; this is not promised until checked.

**Scope (exact):**
1. **Confidence states:**
   - **confident:** no issues;
   - **qualified:** any medium item;
   - **withheld:** any high item.

   When withheld, the "can go to other purposes" action shows no exact amount: "not given until the
   high-priority items below are fixed". The traceable rows still show, on the basis defined in
   item 10 (summary rows, G3).

   **High severity (U5b, decided):** household or shared-account balances included in pharmacy cash
   with no resolved pharmacy portion. Until stage 3 applies the separation, this applies to every
   account whose "Used For" is Personal, Shared, not set, or Business but not yet confirmed by the
   owner (item 10). It withholds the exact amount, or qualifies it if the uncertain balance is
   stated and excluded.

   **Withheld never means hidden.** When the exact amount is withheld, the Director still shows:
   - every known obligation, with its due date;
   - every overdue item;
   - every shortfall (calculated on Business-only cash);
   - the consequence of each, the alternatives, and the actions available;
   - what is known, what is uncertain, why the uncertainty matters, and what the owner can do
     (for example, confirm an account's "Used For").
2. **Banner wording:**
   - it never says "No problems found" while any item is listed;
   - it states the confidence state and the number of items.
3. **Overdue actions:** every overdue payment gets an action, including fully earmarked ones (DIR-1).
   - "Pay now: the money is already set aside" is used only when the earmark sits in a
     pharmacy-eligible account.
   - If the earmark is in a Personal, Shared or unconfirmed account, the action says so: "The money
     set aside for this is in [account], which is not confirmed pharmacy money." It is not
     presented as pharmacy cash (G1).
4. **Wording:**
   - shortfall wording: "covers none" versus "covers part";
   - floor-breach wording and the negative amount format (DIR-5);
   - correct "If not" lines.
5. **"Today's income" text** is accurate per account access and mapping (DIR-6).
6. **Loan review flags** from stage 1 shown in the Director (each with OPEN).
7. **New read-only warnings,** each with its effect on balances and a link to the record:
   - a negative stored amount;
   - an unknown type;
   - Income or Expense with category "Loan";
   - a bill resembling an existing loan (same lender name or amount pattern, advisory);
   - a restricted-source linked earmark (uses the existing `restricted_source` status);
   - possibly misclassified quick entries (AI Categorized; refund, gift, "transfer to"
     patterns);
   - an account with no "Used For", or Business by default and not yet confirmed;
   - a shared account;
   - the disclosure that household, shared and unconfirmed balances are kept out of the
     conservative figures (item 10), and the amount concerned.
8. **Beyond 30 days:** a note on commitments after 30 days, especially borrowed cash with
   instalments due later.
9. **Stale data and confirmations (U9, decided; provisional and configurable; correction 2):**

   **Thresholds:**
   - an account balance not confirmed by the owner today is flagged;
   - obligations not reviewed or refreshed for 24 hours are flagged;
   - PBSRx data older than 24 hours is flagged once a PBSRx feed exists (stage 8). Until then the
     rule is defined but has nothing to check;
   - the thresholds are settings, shown as "provisional";
   - each flag names the data and when it was last current;
   - stale data qualifies the figures and never changes them.

   **Balance confirmation ("Balance matches today"):**
   - It records the confirmation time and the confirmed amount, and nothing else beyond strictly
     necessary metadata (the account id).
   - It is labelled "Confirmed by you, not independently verified". It is never called a
     reconciliation or a verification.
   - It moves no money, creates no transaction, and does not alter or reconcile any balance. A
     mismatch is corrected with an ordinary, reviewed entry.
   - **It lapses when:**
     - the account's computed balance no longer equals the confirmed amount (any added, edited
       or reversed entry); or
     - the device's local calendar date is no longer the confirmation date.
   - **"Today" is the device's local date**, the same `today()` the app uses everywhere. It is never
     obtained by cutting the date off a UTC timestamp. The confirmation stores its local date
     explicitly, beside the timestamp.

   **Obligations review ("Obligations reviewed"):**
   - It records the review time only, and lapses after the threshold (24 hours) or when an
     obligation is added, changed or paid.
   - For KoboFlow's own bills and loans (recomputed live), "refreshed" means the owner reviewed or
     changed them. Confirm this interpretation at stage start.

   **Predictable behaviour:**
   - **Offline:** everything works offline, because the records are local.
   - **Reopening the PWA:** confirmations persist and are re-evaluated against the current
     balance and local date.
   - **Local midnight:** "confirmed today" becomes "not confirmed today" at local midnight, even
     with the app open (re-evaluated on the next render and on a date change).
   - **Clock changes:** a confirmation whose stored local date is later than today (clock moved
     back) is treated as not current.
   - **Balance edits:** see the lapse rules above.
   - **Backup restoration:** confirmation records are not exported. If one ever arrives from an
     older or edited file, it is ignored, never treated as current.

   **Privacy and rollback:**
   - The records stay on the device and are not included in backups. The confirmed amount is a
     balance the device already holds.
   - On rollback, older builds ignore these `meta` records. They can be left in place, or deleted
     later on approval.

10. **Conservative Business-only view (interim, correction 3):**
    - **Displayed cash is split** into:
      - accounts explicitly identified as Business (Used For = Business **and** confirmed by the
        owner, see below);
      - accounts identified as Personal, Shared, or not yet confirmed.
    - **Pharmacy figures use Business-only cash:** payment coverage ("covers it / covers part /
      covers none"), shortfalls and the working-capital-floor check.
    - **A broader figure** that includes uncertain money may be shown only separately, labelled
      "includes household, shared or unconfirmed money: not pharmacy cash".
    - **Never** is household or shared money represented as pharmacy-available cash.
    - **One-time "confirm Used For" action** for each existing account: the owner confirms or
      changes Business, Personal or Shared. Until confirmed, the account counts as unconfirmed.
      - Confirming stores only a marker (a `meta` record, item 9).
      - Changing the value goes through the normal setup review and history.
      - No account is silently reclassified, and no cash movement is created.
    - Existing account data is preserved unchanged.
    - **Earmarks (G1):**
      - general and linked earmarks held in a Personal, Shared or unconfirmed account are excluded
        from pharmacy coverage and from pharmacy free-to-use;
      - they stay visible, with their actual account, labelled "held in [account]: not
        pharmacy-eligible";
      - an obligation covered only by such an earmark is shown as uncovered for pharmacy purposes,
        with the earmark named as a possible source the owner may choose.
    - **Same definition on five screens (G2).** The Director, Calendar, Pressure, Autopilot and the
      Opportunity Analyzer all calculate on the same pharmacy-eligible cash: confirmed Business
      accounts with immediate access, less pharmacy-eligible earmarks and commitments, less
      uncovered obligations, less the active floor where the floor applies. It is one shared
      function, not five copies.
      - A screen may also show a broader all-account total for overall awareness only, separately
        labelled "all accounts, including household, shared and unconfirmed: not pharmacy cash".
      - Labels alone are not enough. The coverage calculations themselves change.
    - **Summary rows (G3):**

      | Row | Basis |
      |---|---|
      | Cash Now (pharmacy) | Confirmed Business accounts, immediate access |
      | Other money (not pharmacy cash) | Personal, Shared and unconfirmed balances, listed per account, for transparency only |
      | Earmarked / reserved | Earmarks in pharmacy-eligible accounts only. Others are listed under "Other money" |
      | Free to use | Cash Now (pharmacy) less pharmacy-eligible earmarks |
      | Due / covered / uncovered, and shortfall | Obligations against pharmacy-eligible cash and earmarks only |
      | Floor | Checked against Free to use after uncovered obligations |
      | Can go to other purposes | Exact only when no high item is open; otherwise withheld or qualified (item 1) |

      No row label may make all-account cash look like pharmacy cash. When the exact amount is
      withheld, every obligation, due date, overdue item, shortfall, alternative and action still
      shows.
    - **Used For marker lifecycle (G4):**
      - the marker records the account id, the confirmed Used For value, and the confirmation time;
      - it is **invalid** when the account's Used For changes, or no longer matches the recorded
        value; a fresh confirmation is then needed;
      - **newly created accounts** have no marker and need an explicit confirmation, even if the
        selector shows Business;
      - markers are local and not in backups (item 9). **After a backup restore, every restored
        account needs a fresh confirmation**;
      - a missing, stale or invalid marker is never treated as a confirmed Business classification;
      - confirming the purpose is separate from confirming the balance (U9). It does not verify the
        balance independently, creates no transaction, and moves no money.

**Non-goals:**
- no change to any stored figure, and no change to the existing calculations other than adding
  the conservative pharmacy-eligible cash view (item 10, used on five screens) and withholding or
  qualifying the free amount. The all-account figures may remain only as separately labelled
  awareness totals, never as pharmacy cash;
- no full separation: per-entry purpose, shared-account portions and the "not chosen yet" option
  are stage 3. Stage 2 adds only the conservative interim view and the one-time confirmation;
- no change to the Calendar, Pressure, Autopilot or Opportunity Analyzer beyond switching them to
  the shared pharmacy-eligible cash definition and its labels (G2);
- no automatic reclassification, edit or deletion of any record. The only setup change possible is
  an owner-chosen Used For change, made through the normal setup review and history;
- no buckets, receivables or PBSRx work (the PBSRx staleness rule is defined, not wired to a feed);
- no database version change, unless implementation shows one is needed for the new `meta`
  records. In that case it needs the owner's approval first (see "Stored data");
- no automatic balance adjustment: confirming a balance records only the time, the local date and
  the confirmed amount. A mismatch is corrected with an ordinary, reviewed entry.

**Regression and acceptance tests** (fictional data; engine plus both builds, TEST and production
candidate):
- each audit scenario DIR-1, DIR-3, DIR-5 and DIR-6 reproduced as a failing test first, then
  passing;
- each new warning: flagged when present, absent when not, its balance effect stated, and the
  linked record opens;
- the confidence state for: no issues, medium only, high present;
- **U5b:** with a Personal, Shared, unset or unconfirmed account present, the state is withheld,
  or qualified with the excluded amount stated. An exact free amount appears only when it is
  calculated on Business-only cash from accounts the owner has confirmed;
- **U9:**
  - each threshold flags at and after its limit and not before;
  - changing a threshold changes the flag, not any figure;
  - a balance confirmation records the time, local date and amount only;
  - an obligations review records the time only;
  - neither creates or alters a transaction or balance;
  - a confirmation lapses on a balance change (added, edited or reversed entry);
  - a confirmation lapses at local midnight, including in a timezone ahead of UTC (for example
    Africa/Lagos at 00:30 local);
  - a confirmation from a later date (clock moved back) is not current;
  - offline use, and reopening the PWA, keep and re-evaluate confirmations;
  - confirmations are absent from exported backups, and a confirmation inside an imported file is
    ignored;
  - the label reads "Confirmed by you, not independently verified";
  - restart keeps the settings;
  - all figures are identical with or without stale flags;
- **Conservative view (correction 3):**
  - a shortfall that appears only on Business-only cash is shown (the ₦50,000 / ₦200,000 /
    ₦100,000 example);
  - an overdue obligation stays listed, with its consequence and action, while the exact amount is
    withheld;
  - an account defaulted to Business and never confirmed is flagged and excluded from Business-only
    cash;
  - household and shared balances never appear as pharmacy-available cash;
  - the floor check uses Business-only cash;
  - confirming or changing Used For moves no money and creates no entry;
  - existing account data is unchanged;
- **Earmarks (G1):**
  - a general earmark and a linked earmark, each held in a Personal account, a Shared account and
    an unconfirmed account (six cases): none counts as pharmacy coverage or reduces pharmacy
    free-to-use;
  - each stays visible with its account;
  - no "money is already set aside" message points at it;
- **Five screens (G2):**
  - one fictional scenario (confirmed Business, Personal, Shared and unconfirmed accounts; a
    general and a linked earmark in a Personal account; rent and a loan instalment due; a floor);
  - the Director, Calendar, Pressure, Autopilot and Opportunity Analyzer show the same
    pharmacy-eligible cash, coverage, shortfall and floor result;
  - any all-account total is separately labelled;
- **Summary rows (G3):** each row in the item 10 table shows its defined basis, for all three
  confidence states;
- **Used For marker (G4):**
  - changing an account's Used For invalidates its marker;
  - a newly created account is unconfirmed until confirmed;
  - after a backup restore, every account is unconfirmed until confirmed again;
  - a missing or mismatched marker never counts as Business;
  - confirming creates no transaction and leaves the balance confirmation (U9) unchanged;
- no exact free amount when withheld;
- the banner text in each state;
- **unchanged figures:**
  - the existing director, integrated-build and stage0 tests unchanged, plus a comparison with the
    engine at `cb5f209`;
  - every existing all-account figure is identical;
  - where every account is confirmed Business and every earmark is in such an account, the
    conservative figures on all five screens equal the existing ones;
- **records untouched:**
  - stored transactions, bills, loans, earmarks and the setup are byte-identical before and after
    opening the Director with every warning present;
  - only the separate confirmation and threshold `meta` records change, and only when the owner
    sets them;
  - restarting changes nothing;
- the full suite, with none skipped, and `node scripts/build-test-file.js --check`.

**Acceptance criteria (definition of done):**
- every listed scenario passes on both builds;
- the full suite passes;
- the test build is up to date;
- the code is reviewed;
- the test-site publication is separately approved, and an Android device check of the Director
  screens is recorded before the stage is marked complete.

**Rollback and recovery:**
- The work is a single commit on the feature branch (no force-push).
- **To roll back:** `git revert <commit>` on the feature branch, then run the full suite again. If
  it had been published to the isolated test site, republish the previous verified build (its
  saved `SOURCE.json` and checksums) after approval.
- **No data recovery is needed.** The stage writes no financial records, so user data and backups
  are unaffected by either the change or its rollback. The "records untouched" test proves this.
  After a rollback, the separate `meta` confirmation, threshold and Used For marker records are
  ignored by older builds. The five screens return to their previous all-account figures. They are
  not in backups and can be removed later on approval.

**Risks:**
- **Warning fatigue.** Mitigation: severity is consistent and items are grouped.
- **Severity:**
  - **high:** Personal, Shared or unconfirmed balances, or earmarks held in them, counted as
    pharmacy cash without a resolved portion (U5b, decided; G1, G5); also proposed for negative or
    unknown records and restricted-source linked earmarks;
  - **medium:** the rest, including stale data (proposed).

  Severities other than U5b remain proposals for the owner's agreement at stage start.
- **The flag will show often.** "Balance not confirmed today" will appear daily until the owner
  builds the habit of confirming balances. Mitigation: one tap per account, grouped into one
  item.
- **Conservative figures may look alarming** at first, because Personal, Shared and unconfirmed
  accounts, and the earmarks in them, are excluded on all five screens. Mitigation: the one-time
  Used For confirmation, and the separate labelled broader figure.
- **Changing four more screens widens the stage.** Mitigation: one shared function, and a
  five-screen comparison test (G2).
- **Loan-like bill matching** is a heuristic. It is advisory only.

**Status:** not started.

#### Stage 3: Business and household separation (critical priority)

- **Problem:** pharmacy and household money cannot be told apart.
  - Personal and shared balances count as pharmacy cash (DIR-4).
  - An entry has no purpose separate from its account.
  - Mixed spending in either direction is invisible.
- **Outcome:**
  - every relevant entry and account says whether it is pharmacy, household, shared or
    unclassified;
  - pharmacy-available cash and the floor use pharmacy money only;
  - the Director and reports show "pharmacy cash used for household" and "household money used for
    pharmacy" each period;
  - Net Worth still shows everything.
- **Dependencies:**
  - stage 2 (warnings and confidence);
  - U5a decided (owner-declared opening portion, adjusted only by purpose-classified entries,
    reconciled against the balance);
  - confirm that the per-entry purpose field needs no database version change (expected: an
    optional field, as for destination names).
- **Scope:**
  - section 4 rules;
  - apply "Used For" in `applySetup` and cash calculations;
  - add an explicit **"not chosen yet"** option to "Used For". Stop defaulting new or unconfirmed
    accounts to Business, and keep the Stage 2 confirmation markers;
  - a per-entry purpose (Add Entry, Edit, quick-entry review);
  - shared-account opening pharmacy portion, its purpose-only adjustment, and its reconciliation
    against the actual balance (U5a);
  - unclassified flags;
  - business-to-household as owner withdrawal and household-to-business as owner contribution;
  - correction through the existing edit flow;
  - help text on the value of separate accounts;
  - P3-2 and P3-3.
- **Non-goals:**
  - requiring separate bank accounts;
  - automatic reclassification of existing entries;
  - buckets;
  - receivables.
- **Tests** (engine and both builds):
  1. **Pharmacy cash spent on household needs.**
     - Directly from a pharmacy account: pharmacy cash falls; it counts as owner support, not
       pharmacy operating expense or break-even cost; it is shown in "pharmacy cash used for
       household".
     - By transfer to a household account: the same, as an owner withdrawal.
  2. **Household money funding a pharmacy expense.**
     - Directly from a household account: it counts as a pharmacy expense and an owner
       contribution, and pharmacy cash is unchanged.
     - By transfer into a pharmacy account: an owner contribution, never sales revenue.
  3. **Shared-account allocation (U5a, U5b):**
     - only the owner-declared portion, adjusted by pharmacy-purpose entries, counts;
     - household and unclassified entries leave the portion unchanged;
     - a portion larger than the balance, or negative, is flagged as a discrepancy;
     - with no opening portion, or an unresolved discrepancy, the account adds nothing to pharmacy
       cash and the exact free amount is withheld or qualified;
     - the shared balance is fully visible in Net Worth.
  4. **Unknown classification:**
     - an account with no "Used For" ("not chosen yet") and an unclassified entry are flagged,
       never guessed;
     - a new account starts as "not chosen yet", not Business;
     - saving the setup never turns "not chosen yet" into Business;
     - the Director's confidence is lowered;
     - nothing is reclassified on load, import or restart.
  5. **Transfers and contributions:**
     - a transfer within one side is not income or expense;
     - a cross-side transfer is recorded as a withdrawal or contribution;
     - the account balances move exactly once.
  6. **Reconciliation after correction:**
     - editing an entry's purpose (review, confirm) moves no money and creates no second entry;
     - the totals for pharmacy, household and the two cross-use lines recompute;
     - balances are unchanged;
     - `edits[]` records the change;
     - backup, re-import and restart reproduce the same figures.
  7. **Compatibility:**
     - older records and backups without purpose import unchanged, and are classified from
       their account or flagged;
     - Net Worth totals are unchanged.
- **Done:** every test passes; every screen agrees; full suite; review; Android check.
- **Risks:**
  - large numbers of existing unclassified entries;
  - mistaking a purpose change for a money movement.

  Mitigations: bulk review is shown, never automatic; tests prove that balances do not move.
- **Status:** partially complete. "Used For" is saved but not applied.

#### Stage 4: Quick-entry classification safety

- **Problem:** "refund to customer", "gift for mum" and "refund from supplier" become income;
  "rent transfer" and "transfer to landlord" become internal transfers. All are saved as "AI
  Categorized" (D4).
- **Outcome:** an ambiguous phrase is never saved with a confident wrong type. Review offers the
  type and the pharmacy or household purpose.
- **Dependencies:**
  - stage 3 (purpose available in review);
  - stage 2 already lists existing matching entries.
- **Scope:**
  - the `parseEntry` rules;
  - ambiguous phrases go to Needs Review with a reason, or need `@ name` or an explicit type;
  - the purpose prompt in review.

  **Non-goals:**
  - a new refund type (unless decided, U10);
  - reclassifying existing records.
- **Tests:**
  - each D4 phrase;
  - household and pharmacy phrases;
  - the existing alias, category and `@` tests unchanged;
  - both builds.
- **Done:** no D4 phrase is saved as AI Categorized income or transfer; full suite; review.
- **Risks:** over-flagging ordinary phrases.
- **Status:** not started.

#### Stage 5: Cash-flow statement reconciliation; bill and obligation action links; Net Worth loan liability (H5)

- **Problem:**
  - the statement does not reconcile in four cases (D1): a capital injection from your own
    account, an investment into a tracked account, a withdrawal with no To account, and an
    imported unknown type;
  - bill actions have no OPEN link (DIR-2);
  - Net Worth counts all future scheduled loan interest as a current liability
    (`outstanding.total`), contrary to the H5 decision.
- **Outcome:**
  - the statement total equals the real change in money;
  - each action opens its record;
  - Net Worth's loan liability follows H5 (section 6).
- **Dependencies:**
  - stage 2 (unknown-type warning);
  - the stage 1 loan engine at `cb5f209` (its review can run in parallel).
- **Why H5 is in this stage:** it is a reporting-consistency change of the same kind as D1. It
  reuses the stage 1 instalment states, and it must land before receivables (stage 6) and buckets
  (stage 7) read Net Worth or the forecast.
- **Scope:**
  - the `cashFlowSummary` combined-view rules;
  - the bill link;
  - P2-4 (bill reminders);
  - P2-5 (cross-tab protection for bill and loan payments);
  - P2-6 tests;
  - **H5:**
    - a loan-engine figure for **current liability**: outstanding principal plus **demonstrably
      due** interest and fees (H1). The calculation must be verified before release:
      - only instalments overdue or due today are "due";
      - for each, the remaining interest and fees come from the stored split of payments already
        allocated to it (`remParts`);
      - where any payment against a due instalment is held as "split not yet known" (unsplit,
        provisional), the remaining interest and fees cannot be shown, so that instalment's
        charges are reported as **uncertain**, with the unsplit amount stated, and are not added
        as a precise figure;
      - outstanding principal uses the existing engine figure, which is already marked
        approximate when unsplit payments exist (`componentsApprox`); the same uncertainty flag is
        carried through;
    - a figure for **remaining scheduled payments**: the future instalments, including future
      interest, as in the forecast;
    - Net Worth uses the current liability in place of `outstanding.total`. The future scheduled
      interest is shown as a note, with the disclosure that it is excluded from current
      liabilities but still required in future cash;
    - **H2:** the loan screen ("Outstanding"), the loan card, the Loans summary ("Total Owed") and
      the Brief show both figures with the same labels: "Current loan liability" and "Remaining
      scheduled payments". Future commitments are never hidden.

  **Non-goals:**
  - new transaction types;
  - changing the forecast's instalment amounts;
  - inventing revised schedules.
- **Tests:**
  - every D1 case reconciles (the engine.test 520 claim holds);
  - Director bill links;
  - reminders;
  - two-tab payment attempts record once;
  - **H5 acceptance criteria:**
    1. Net Worth's loan liability equals outstanding principal plus demonstrably due interest and
       fees;
    2. future interest is excluded from current liabilities and shown only in the note and the
       forecast;
    3. every scheduled instalment appears exactly once in the cash forecast (Director, Calendar,
       reservations), unchanged by the H5 change;
    4. extra principal is counted exactly once, using the stage 1 fixtures (D2 and D3 scenarios);
    5. an unconfirmed lender schedule change is flagged ("Schedule needs review"), never invented;
    6. **H2:** the loan screen, loan card, Loans summary, Brief and Net Worth show the same
       "Current loan liability" figure, and the same "Remaining scheduled payments" figure as the
       forecast, with nothing counted twice;
    7. both builds;
    8. **H3, legacy comparison against the engine at
       `cb5f209bc50224044435bf857b892c0ec62f0325`:**
       - for each fixture and older record, compare the revised Net Worth with the legacy result;
       - document the numerical difference and its cause. The expected cause is future interest no
         longer counted, so the figures are **not** expected to be identical;
       - confirm that every scheduled instalment is still represented once in the forecast;
       - confirm that extra principal is counted once;
       - verify older records and relevant historical loan cases (amended schedules, extra
         principal before an older amendment, settlements, reversals, provisional payments);
    9. **H1 cases:**
       - an overdue, partly paid instalment with a known split: only its remaining interest and
         fees are added;
       - a due instalment paid partly with "split not yet known": its charges are shown as
         uncertain, with the unsplit amount, and no precise figure is invented;
       - a future instalment: none of its interest enters current liabilities.
- **Done:** full suite; review.
- **Risks:**
  - changing a report the owner may already rely on; show what changed;
  - **Net Worth will rise** by the future interest no longer counted. Disclosed on screen;
  - **uncertain charges** for provisional payments can leave the current liability incomplete.
    They are shown as uncertain rather than estimated (H1).
- **Status:** not started.

#### Stage 6: Receivables, partial receipts, overdue follow-up; expected inflows

- **Problem:** money owed to the owner cannot be recorded honestly. If it is entered as income, it
  is spendable at once.
- **Outcome:** receivables are tracked to closure and appear only as expected inflows.
- **Dependencies:**
  - stages 3 and 5 (a receivable is pharmacy or household money);
  - a new store, so **database version change approval** (U1);
  - backup format update.
- **Scope:**
  - the section 5 rules;
  - expected inflows in the Cash-Obligations Forecast;
  - an overdue follow-up list;
  - seen is not paid;
  - the revision 6 table in section 5: credit sale, full and partial collection, pending
    transfer, failed payment, corrected or repeated receipt;
  - collections recorded as cash collected, never as new sales or new income;
  - receipt-to-receivable links and stable source ids.

  **Non-goals:**
  - the PBSRx credit-sales feed (stage 8);
  - automatic reminders to debtors;
  - recording pharmacy sales figures in KoboFlow (PBSRx is the source);
  - reopening the U15 decision (already settled by the owner, section 11).
- **Tests:**
  - create, partial receipt, full receipt, reschedule, cancel, overdue;
  - double-tap and restart are idempotent;
  - receipts move cash once;
  - unpaid receivables never appear in Cash Now, free cash or the buckets;
  - a collection of an old debt raises cash once, closes or reduces that receivable, and adds
    nothing to sales or income;
  - a partial payment reduces the receivable by exactly the amount received;
  - a pending transfer never counts as cash, and stays an expected inflow with its date;
  - a failed payment leaves the receivable open (or reopens it), and cash unchanged;
  - a repeated import, retry or double-tap of the same receipt moves cash at most once;
  - backups and older backups import;
  - the database upgrade with a verified safety copy (as in v4);
  - both builds.
- **Done:** full suite; upgrade tested with real-format v4 data (fictional); review; device check.
- **Risks:** schema migration; duplicate entry of a receipt as plain income.
- **Status:** not started.

#### Stage 7: Five buckets, Reserve protection, floor warnings, approved overrides, plan history

- **Problem:** no structure says what each naira is for.
- **Outcome:**
  - **live five-bucket allocation recommendations are held (U13)** until a validated sales basis
    exists. Recorded receipts are shown for information only, labelled "recorded receipts, not
    validated sales", and are never the allocation basis;
  - sales, cash collected, actual balances, committed money, real payments, virtual targets and
    available-to-spend money are shown separately, never merged;
  - once a validated sales basis is recorded (stage 8), live targets and recommendations start;
  - Reserve is protected;
  - cross-bucket use needs approval, with consequences shown;
  - a proposed payment that would breach the floor is warned about;
  - plans and overrides are kept.
- **Dependencies:**
  - stage 2 (income-quality warnings: misclassified, unexpected From account, future-dated,
    duplicates);
  - stage 3 (pharmacy money only);
  - stage 4 (quick-entry classification, so new receipts are not misclassified);
  - stage 6 (expected inflows are never cash);
  - **stage 8, for activating live allocation recommendations:** a validated sales basis (U13).
    - **Built and tested before it (owner direction, revision 6),** with validated or explicitly
      labelled test inputs:
      - the bucket rules and provisional percentages;
      - sales-based target calculations;
      - funding and allocation tracking;
      - Reserve restrictions and approval;
      - cross-bucket rules;
      - over-allocation and insufficient-funding warnings;
      - allocation history and reconciliation;
      - refunds, credit sales and old-debt collections;
      - floor breach warnings;
      - plan history;
      - the informational receipts view.
    - **Not activated before it:** live allocation recommendations on real data.
    - Recorded allocations of real money may be used live meanwhile — for example an owner-entered
      Reserve allocation — once the ownership, confirmation, funding and reconciliation safeguards
      in the U14 decision (section 11) are met;
  - database change approval for plan history (U1);
  - U2, U3, U4, U4a, U12 and U13 are decided;
  - U6 and U11 are still open;
  - PBSRx bucket figures are excluded until stage 8 validates them (U12).
- **Scope:**
  - the section 3 rules, including Reserve and the separate floor;
  - recommendation → approval → recorded payment states;
  - unfunded-target display (only once a validated sales basis exists, S2);
  - the informational receipts view, including the material warnings and their effects (S3) and
    future-dated treatment (S4);
  - plan history;
  - the over-allocated warning;
  - P3-1;
  - the monthly destination, progress and trading days (P1-3);
  - the historical assessment report, built once enough data exists.

  **Non-goals:**
  - automatic payments;
  - changing targets without approval;
  - changing PBSRx's calculation;
  - the evidence-based floor calculation (stage 9).
- **Tests:**
  - **U13 hold:**
    - with no validated sales basis, no live targets or allocation recommendations are produced;
    - recorded receipts are shown only as informational, labelled "recorded receipts, not
      validated sales";
    - changing the receipts changes no recommendation;
  - **S2:**
    - an unfunded-target test runs only with a validated sales basis present. It compares a
      target on validated sales against cash collected;
    - without such a basis, the test checks only that informational receipts and any virtual
      targets are never shown as funded cash or available-to-spend money;
  - **S3, material warnings:**
    - a misclassified-income (D4 pattern) receipt, an income record with an unexpected From
      account, a future-dated receipt and a possible duplicate are each flagged;
    - each marks the informational receipts provisional, with the entries named;
    - none drives a live recommendation;
    - with a validated sales basis present (later), the affected days' recommendations are
      withheld until the warning is resolved;
  - **S3, duplicates:**
    - a possible duplicate receipt is counted once in the informational total and shown
      separately as "possible duplicate, not added";
    - it is never counted as a separate cash movement without evidence;
    - it is never deleted or merged automatically;
    - resolving it is the owner's reviewed action;
  - **S4:**
    - a future-dated receipt is excluded from current-period totals and labelled "future-dated"
      until its date;
    - from its date it appears as an informational recorded receipt, still not a sales basis;
    - it is never counted as current cash, pharmacy-available money or allocation funding before
      its date;
  - targets and receipts are never shown as available-to-spend money;
  - **revision 6, fixture tests (labelled test inputs, not live):**
    - targets are computed on validated or labelled test sales, separately from funding;
    - funding never exceeds available pharmacy cash;
    - an insufficient-funding warning appears when targets exceed funding;
    - an over-allocation warning appears;
    - a refund lowers the sales basis once and moves cash once;
    - a credit sale adds to the sales basis but not to funding;
    - a collection of an old debt adds to funding but not to the sales basis;
    - history reconciles to actual cash;
    - every fixture is labelled as a fixture on screen and in exports;
  - **U12:** an unvalidated PBSRx bucket figure is labelled "unvalidated", and changing it changes
    no recommendation or Director figure;
  - target versus actual versus balance versus committed versus paid, kept distinct;
  - unfunded target shown when a target on validated sales exceeds collection (conditional, S2);
  - the Inventory–Supplier pair;
  - Reserve use refused without approval, and the explanation (amount, reason, consequence,
    alternatives) shown first;
  - approval moves no balance;
  - urgent obligations still listed when only Reserve could cover them;
  - floor breach warned before recording, with no double counting of buckets;
  - every override recorded;
  - nothing moves silently;
  - a stale plan is disclosed;
  - restart and offline;
  - both builds.
- **Done:** the end-to-end scenarios in section 10 that involve buckets pass; review; device
  check.
- **Risks:**
  - confusion between allocation and payment;
  - the PBSRx basis inherits the collected-cash defect (E1). Excluded from recommendations until
    validated (U12).
- **Status:** partially complete. A manual floor, earmarks and linked earmarks exist; no buckets.
  Live allocation recommendations are on hold until a validated sales basis exists (U13).

#### Stage 8: PBSRx validation, supplier-obligation feed, reconciliation

- **Problem:** PBSRx figures are unreliable, and there is no interface.
- **Outcome:** a validated, read-only feed of supplier obligations and cash events. It
  reconciles, with no duplicates and no second ledger.
- **Dependencies:**
  - PBSRx-side fixes (a separate project and approval);
  - stages 5 and 6;
  - the origin and credential assessment (P2-3).
- **Scope:**
  - the export contract;
  - KoboFlow importer, idempotent by `sourceId`;
  - a reconciliation report (matched, unmatched, conflicting);
  - stale-feed disclosure (PBSRx data older than 24 hours, provisional and configurable, U9);
  - validation, and correction where needed, of the PBSRx bucket calculation, before any PBSRx
    bucket figure may feed live recommendations (U12);
  - document Cockpit as separate (P2-2);
  - **the revision 6 findings (section 8):**
    - document PBSRx's sales, discount, cash, change, refund, COGS, bucket and supplier definitions;
    - agree the smallest safe PBSRx fixes (a separate PBSRx task and approval);
    - validate them with fixture tests;
    - reconcile PBSRx figures against PBSRx source records (sales lines, refunds, GRNs, payments)
      before any becomes a validated basis.

  **Non-goals:** writing back to PBSRx; KoboFlow stock management.
- **Tests:**
  - re-import adds nothing;
  - a changed supplier obligation updates once, with history;
  - a KoboFlow payment and a PBSRx-reported payment reconcile to one;
  - a malformed or duplicate-id file is refused;
  - a fixture-based validation of PBSRx calculations, including the five-bucket basis;
  - feed age flagged after 24 hours;
  - bucket figures enabled for recommendations only after validation is recorded;
  - a PBSRx sales figure becomes the validated sales basis for stage 7 (U13) only after its
    validation is recorded;
  - change given is excluded from cash collected;
  - a short-paid sale is never silently a full cash sale;
  - a refund of an earlier sale adjusts the correct date;
  - a supplier rename keeps its balance;
  - multi-unit COGS is correct.
- **Done:** validation evidence recorded; review; owner acceptance.
- **Risks:** the dependency on PBSRx work; data residency and shared origin.
- **Status:** partially complete. The contract is documented only.

#### Stage 9: Financial Break-Even Calculator; evidence-based floor; inventory as an asset

- **Problem:** there is no trustworthy break-even figure or evidence-based floor.
- **Outcome:**
  - a period break-even with validated inputs, separate from cash;
  - a proposed floor calculated from validated costs, stock replacement needs, near-term
    obligations and history. It replaces the manual floor only after explicit approval, with the
    previous value and the decision history kept (U4, U4a);
  - stock in Net Worth once valued;
  - pharmacy performance shown, or "not available" until validated (P1-3).
- **Dependencies:**
  - stage 3 (pharmacy costs only, household excluded);
  - stage 8 (validated margin, COGS, stock replacement and valuation);
  - floor decision history in the existing setup history (section 3). There is no hard dependency
    on U1 unless implementation shows the setup history cannot hold or back up these records;
  - U7, U8.
- **Scope:**
  - the section 2A, section 3 (floor) and section 7 rules;
  - period spreading;
  - the "estimate / not available" states;
  - the restocking treatment change.

  **Non-goals:** pricing advice; presenting any figure as authoritative on unvalidated inputs.
- **Tests:**
  - hand-checked fixtures;
  - the proposed floor shows its inputs and changes nothing until approved;
  - approval replaces the floor and preserves the previous value and the decision;
  - each record holds the previous and new value, time, "you, on this device", inputs, reason and
    outcome;
  - rejection leaves the floor unchanged and is recorded;
  - an approved calculated floor stays fixed when its inputs later change; a new proposal appears
    instead;
  - restoring a previous floor from the history works and is recorded;
  - history survives restart and backup;
  - rent spread across its period, while the cash forecast still shows the payment on its date;
  - loan principal excluded;
  - a missing input gives "not available", never ₦0;
  - Net Worth with and without validated stock.
- **Done:** figures match independent hand calculations; review.
- **Risks:** a changed restocking treatment alters historical reports; disclose the change.
- **Status:** not started.

#### Stage 10: End-to-end acceptance, offline and reopen, release readiness

- **Problem:** no full-system acceptance yet, and production is still v2.
- **Outcome:** evidence that the whole system is safe for daily use; a separately approved
  release plan.
- **Dependencies:** all earlier stages.
- **Scope:**
  - the section 10 scenarios on the TEST build;
  - Android device acceptance;
  - an upgrade test with records created by the real production v2 `index.html` (P2-7);
  - retire the stale PR #1;
  - a release plan.

  **Non-goals:** releasing without approval.
- **Done:** every scenario passes on both builds and on the device, with results recorded; release
  separately approved.
- **Status:** not started.

## 10. End-to-end acceptance scenarios

All scenarios use fictional data on the TEST build (`KoboFlowDB-test`), then the Android device.
Scenarios that need bucket amounts (E2, E4, E6 and E40–E41, in their bucket parts) run in two
modes:
- **before a validated sales basis exists:** with validated or explicitly labelled fixture
  inputs, to test the rules (revision 6). On real data they check only that no live allocation
  recommendation is shown (U13);
- **after the validated sales basis is recorded (stage 8):** live.

Live use of recorded allocations before stage 8 follows the U14 decision (section 11).
Each scenario states expected figures in advance and checks that these screens agree: Director,
forecast, buckets, Net Worth, Calendar, loans and receivables.

| # | Scenario | Stages | Must show |
|---|---|---|---|
| E1 | **Normal day, before a validated sales basis.** The day's pharmacy receipts are recorded; rent is due in 10 days and covered from pharmacy-eligible cash | 2, 3, 4, 7 | No live five-bucket targets or recommendations (U13); receipts shown for information, labelled "recorded receipts, not validated sales"; cash collected, balances, committed money, payments and available-to-spend shown separately; rent covered once; the free amount is exact and explained only when no ownership or income-quality item is open |
| E2 | **Unexpected expense** (a generator repair) paid from cash | 2, 7 | The Expenses bucket falls; if it is insufficient, the Director proposes sources with consequences and waits for approval |
| E3 | **Missed expected inflow.** A receivable passes its expected date unpaid | 6, 2 | Stays on follow-up; the forecast marks it at risk; Cash Now unchanged; marking it seen changes nothing |
| E4 | **Changed PBSRx supplier obligation.** An invoice amount changes in the feed | 8 | Updated once, with history; no duplicate obligation; the forecast and Supplier bucket recomputed |
| E5 | **Competing urgent obligations.** Rent, a loan instalment and a supplier payment due the same week; cash covers two | 2, 7 | All three listed with the consequence of each; the owner chooses; no silent order |
| E6 | **Emergency bucket override.** Use Inventory or Reserve money for an urgent medical bill | 7 | Approval required; amount, reason, consequences and alternatives shown first; the shortfall and its timing shown; recorded in plan history; approval moves no money |
| E7 | **Early loan settlement for a larger stock facility** | 1, 7 | Quote previews only; comparison shown, labelled as estimate; settled only after confirmed and paid; the new facility is a separate agreement |
| E8 | **Failed payment.** The bank transfer fails after being planned | 1, 7 | The plan is still unpaid; no payment recorded; the obligation is still due; cancel or retry has no side effects |
| E9 | **Duplicate prevention.** Double-tap, re-import, a receipt entered twice, a PBSRx event matching a KoboFlow entry | all | Each event is recorded once; warnings where a human decision is needed |
| E10 | **Offline use.** Network off for a full day of entries | all | Everything works offline; nothing is lost or duplicated when back online |
| E11 | **Reopening the PWA.** Close and reopen (and restart the phone) mid-plan | all | Same figures, same approved plan, same pending items; stale data disclosed if any feed is old |
| E12 | **Pharmacy cash spent on household needs**, directly and by transfer | 3 | Pharmacy cash falls once; owner support, not pharmacy expense; shown in "pharmacy cash used for household" |
| E13 | **Household money funds a pharmacy expense**, directly and by transfer | 3 | A pharmacy expense plus an owner contribution, never sales; pharmacy cash unchanged for a direct payment |
| E14 | **Shared account** with and without a declared opening pharmacy portion, and with a portion larger than the balance | 3 | Only the declared portion, adjusted by pharmacy-purpose entries, counts; otherwise excluded and the free amount withheld or qualified; the discrepancy flagged; full balance in Net Worth |
| E15 | **Unknown classification.** An account with no "Used For" and an unclassified entry | 2, 3 | Flagged, never guessed; Director confidence lowered; nothing reclassified on restart or import |
| E16 | **Correction.** An entry's purpose is corrected from pharmacy to household | 3 | No money moves; no second entry; pharmacy and household totals recompute; edit history kept |
| E17 | **Floor breach.** A proposed supplier payment would take pharmacy liquidity below the floor | 7 | Warned before recording, with trade-offs; buckets not double-counted; the owner decides |
| E18 | **Stale data.** No balance confirmed today; obligations not reviewed for over 24 hours; a PBSRx feed over 24 hours old | 2, 8 | Each flagged with its last-current time; thresholds shown as provisional; figures qualified, not changed; confirming clears the flag without moving money; labelled "Confirmed by you, not independently verified" |
| E19 | **Calculated floor proposed** | 9 | The manual floor stays until approval; approval replaces it, with the previous and new value, time, "you, on this device", inputs and reason kept; rejection changes nothing and is recorded; later recalculations only create new proposals |
| E20 | **Unvalidated PBSRx bucket figures present** | 7, 8 | Labelled unvalidated; no recommendation uses them until validation is recorded |
| E21 | **Shortfall visible only conservatively.** Business accounts ₦50,000, household ₦200,000, rent ₦100,000 due | 2 | Shortfall of ₦50,000 shown on Business-only cash on all five screens; the broader figure is separate and labelled uncertain; no "covered" message |
| E22 | **Overdue while withheld.** An unconfirmed account makes the exact amount withheld, and a loan instalment is overdue | 2 | The overdue item, its consequence, alternatives and action stay visible; only the exact free amount is withheld |
| E23 | **Defaulted ownership.** An account saved as Business by default, never confirmed | 2, 3 | Flagged as unconfirmed; excluded from Business-only cash; the one-time confirmation offered; nothing reclassified silently |
| E24 | **Household money is not pharmacy cash.** Personal and Shared accounts with large balances | 2, 3 | They never appear in pharmacy-available cash, coverage or the floor check on any of the five screens; Net Worth still shows them |
| E25 | **Income quality and receipts.** A refund saved as income (D4), an income entry with an unexpected From account, a future-dated receipt and a possible duplicate | 2, 7 | Each flagged; informational receipts marked provisional; future-dated receipt excluded from current totals until its date; duplicate counted once and shown as "possible duplicate, not added"; no live recommendation produced (U13) |
| E26 | **Confirmation lifecycle.** Confirm a balance, then (a) edit an entry on that account, (b) pass local midnight, (c) move the clock back, (d) go offline and reopen, (e) restore a backup | 2 | (a)–(c) the confirmation lapses; (d) it persists and is re-evaluated; (e) no confirmation is restored; no money moves |
| E27 | **Restore a previous floor** from the decision history | 9 | The selected previous value becomes active only on the owner's action; the restore is recorded with the previous and new value |
| E28 | **Net Worth under H5.** A loan with future instalments, one instalment overdue, and an extra principal payment | 5 | The liability equals principal plus demonstrably due interest and fees; future interest appears only in the note and forecast; every instalment appears once in the forecast; extra principal counted once; disclosure shown; difference from the `cb5f209` result documented with its cause |
| E29 | **Earmarks outside pharmacy money.** A general and a linked earmark, each in a Personal, a Shared and an unconfirmed account; the linked one's obligation is overdue | 2 | None counts as pharmacy coverage or reduces pharmacy free-to-use; each is visible with its account; no "money is already set aside" for them; the overdue item still shown |
| E30 | **Five-screen agreement.** The same accounts, earmarks, obligations and floor | 2 | The Director, Calendar, Pressure, Autopilot and Opportunity Analyzer show the same pharmacy-eligible cash, coverage, shortfall and floor result; any all-account total separately labelled |
| E31 | **Used For lifecycle.** Confirm an account; change its Used For; add a new account; restore a backup | 2 | The change invalidates the marker; the new account is unconfirmed; every account is unconfirmed after the restore; none counts as Business until confirmed; no money moves |
| E32 | **Loan figures under H1 and H2.** An overdue instalment partly paid with a known split; another paid with "split not yet known"; future instalments | 5 | Only demonstrable due charges in the current liability; the unknown-split charges shown as uncertain, not invented; future interest in remaining scheduled payments only; loan screen, card, Loans summary, Brief and Net Worth agree |
| E33 | **Duplicate receipt.** The same receipt entered twice | 2, 7 | Flagged; counted once in informational receipts; never treated as a second cash movement without evidence; nothing deleted or merged automatically |
| E34 | **Future-dated receipt.** A receipt dated next week | 2, 7 | Excluded from current totals and labelled future-dated until its date; never current cash or allocation funding; from its date, an informational receipt only |
| E35 | **Credit sale.** A pharmacy sale on credit (recorded per U15) | 6, 7, 8 | Sales counted once (PBSRx source); receivable created; cash unchanged; available pharmacy cash unchanged; bucket funding unchanged |
| E36 | **Old debt collected.** A customer pays a debt recorded last month | 6, 7 | Cash up once; receivable closed; no new sale or income; funding may rise, the sales basis does not |
| E37 | **Partial payment.** A customer pays ₦4,000 of a ₦10,000 debt | 6 | Receivable down to ₦6,000; cash up ₦4,000 once; the rest still an expected inflow |
| E38 | **Pending transfer.** A customer says a transfer has been sent; it has not arrived | 2, 6 | Not cash; shown as expected, with date and "payment pending"; Director coverage unchanged |
| E39 | **Refund.** A cash refund for a sale made last week | 4, 7, 8 | Cash down once; the sales basis is reduced against the original sale's date (after the PBSRx fix); not misclassified as income (D4) |
| E40 | **Insufficient cash.** Targets on validated or labelled test sales exceed available pharmacy cash | 2, 7 | Insufficient-funding warning; no target shown as money; obligations and floor still prioritised; nothing spent automatically |
| E41 | **Bucket funding reconciliation.** Several days of fixture sales, collections, refunds and payments | 7 | Funded amounts reconcile to actual pharmacy cash; history explains every change; fixtures labelled |

## 11. Decisions

### Already decided

From the audit's "Already decided" list:
- Opay is the primary account.
- Coop is restricted by default.
- The 30-day free-cash horizon.
- The floor is manual. **Now refined by U4 and U4a:** it stays manual, labelled "not yet
  validated", until the owner explicitly approves an evidence-based replacement; the previous value
  and history are kept.
- Owner withdrawals are commitments, not expenses.
- 6 trading days per week.
- No PBSRx importer until a reliable interface exists.
- No Delete action.
- The destination-tracking scope.
- The duplicate rule.
- The bill frequencies.
- The release and branch policy.

Restated by the owner for this plan (2026-10-24):
- **H1:** personal accounts are excluded from pharmacy cash and the floor.
- **H2:** KoboFlow records receivables, including non-pharmacy ones.
- **H4, in principle:** stock is purchased as a cash outflow, not immediate COGS; it is an asset
  once valued.
- The five buckets at 35/25/20/15/5, provisional.
- Inventory and Supplier are interchangeable for stock.
- Cross-bucket use requires approval.
- KoboFlow owns break-even.
- PBSRx is authoritative for operations; supplier obligations start as a read-only feed.

Confirmed by the owner (2026-10-24, second revision); details in sections 3 and 4:
- **U2:**
  - PBSRx keeps its existing calculation against total daily sales;
  - the targets are unchanged;
  - KoboFlow keeps targets, actual collections, balances, committed money and real payments
    distinct;
  - KoboFlow does not change the PBSRx basis;
  - sustainability is validated with history before any target change.
- **U3:**
  - Reserve is protected;
  - other use needs explicit approval, after amount, reason, consequences and alternatives are
    explained;
  - approval is not a payment;
  - urgent obligations are still surfaced.
- **U4:**
  - a separate working-capital floor, not replaced by Inventory + Supplier;
  - evidence-based, never arbitrary;
  - measured against eligible real pharmacy liquidity without double counting;
  - breach warnings with trade-offs.
- **U5:**
  - account and purpose recorded separately (pharmacy, household, shared, unclassified);
  - household accounts excluded from pharmacy cash and the floor;
  - pharmacy-to-household is an owner withdrawal, household-to-pharmacy an owner contribution;
  - shared accounts count only an identified pharmacy portion;
  - unclassified items are flagged, never guessed;
  - transparent correction without duplicate movements;
  - separate accounts advised, not required;
  - explicit acceptance tests (stage 3, E12–E16).

Confirmed by the owner (2026-10-24, third revision):
- **U5b, high severity:** household or shared balances included in pharmacy cash without a
  resolved pharmacy portion withhold or qualify the exact free-to-spend amount. Uncertain money is
  never shown as available pharmacy cash.
- **U9, stale-data thresholds (provisional and configurable):** flag an account balance not
  reconciled today, PBSRx data older than 24 hours, and obligations not refreshed for 24 hours.
  Refined by correction 2 (fourth revision): "reconciled" here means **confirmed by the owner**,
  labelled "Confirmed by you, not independently verified", never an independent reconciliation.
- **U4a, floor replacement:** a calculated floor replaces the manual floor only after explicit
  owner approval; the previous value and the decision history are preserved.
- **U5a, shared accounts:**
  - an owner-declared opening pharmacy portion per shared account;
  - adjusted only by entries explicitly classified by purpose;
  - reconciled against the actual balance, with discrepancies flagged;
  - never the full balance by default.
- **U12, PBSRx bucket figures:** not used for live allocation recommendations until the
  calculation is validated and corrected where necessary; until then labelled unvalidated and
  kept out of live recommendations.

Confirmed by the owner (2026-10-24, fourth revision, after the financial-safety review):
- **Correction 1 (U12 refined):**
  - sales, cash collected, actual balances, virtual targets and available-to-spend money are kept
    distinct;
  - KoboFlow's pharmacy income is recorded receipts, not validated sales;
  - targets are provisional, and recommendations qualified or withheld, while income-quality
    warnings are open;
  - Stage 7 depends on Stages 2–4.
  - Superseded in part by U13 (fifth revision): live allocation recommendations are held until a
    validated sales basis exists, so receipts are informational only.
- **Correction 2 (U9 refined):**
  - confirmations go in separate `meta` records, are kept out of backups, and record the time and
    the confirmed amount;
  - they lapse on a balance change or a local date change, using the device's local date;
  - they are labelled "Confirmed by you, not independently verified";
  - they move no money;
  - behaviour across offline use, reopening, midnight, clock changes, edits and restores is
    defined.
- **Correction 3 (Stage 2 conservative view):**
  - Business-only cash for coverage, shortfalls and the floor check, with uncertain money shown
    separately;
  - nothing known hidden when the amount is withheld;
  - a one-time Used For confirmation;
  - Stage 3 adds "not chosen yet" and stops defaulting to Business.
- **Correction 4 (U4a refined):**
  - full decision records in the existing setup history ("you, on this device");
  - an approved calculated floor is fixed;
  - previous values are restorable;
  - no hard U1 dependency.
- **H5, Net Worth loan liability:**
  - outstanding principal plus interest and fees already due ("demonstrably due", H1, fifth
    revision);
  - future instalments and future interest only in the forecast, never double-counted;
  - extra principal once;
  - no invented schedules;
  - the higher Net Worth is disclosed;
  - implemented in Stage 5.

  This is a decision made at this revision, not one found in earlier records.

Confirmed by the owner (2026-10-24, fifth revision, after the final consistency review):
- **G1:** earmarks in Personal, Shared or unconfirmed accounts never establish pharmacy coverage
  or pharmacy free-to-use; they stay visible with their account.
- **G2:** one pharmacy-eligible cash definition on the Director, Calendar, Pressure, Autopilot and
  Opportunity Analyzer. The calculations change, not only the labels.
- **G3:** summary rows defined (Stage 2, item 10). No all-account figure is presented as pharmacy
  cash.
- **G4:**
  - the Used For marker records the confirmed value and time;
  - it is invalid on change;
  - new accounts need confirmation;
  - every account needs fresh confirmation after a restore;
  - a missing or invalid marker is never Business;
  - it is separate from balance confirmation.
- **G5:** Personal accounts are named alongside Shared and unconfirmed in Stage 2's problem and
  risk lists.
- **H1 (owner decision):** only demonstrably due interest and fees enter current liabilities. If a
  payment split is unknown, the amount is flagged as uncertain and never invented. No estimate
  enters current liabilities without separate owner approval.
- **H2:** the loan screen, card, Loans summary, Brief and Net Worth show "Current loan liability"
  and "Remaining scheduled payments" consistently.
- **H3:** the legacy comparison uses the engine at `cb5f209bc50224044435bf857b892c0ec62f0325`. The
  differences are documented, and the figures are not expected to match.
- **U13 (owner decision):** live five-bucket allocation recommendations are held until a validated
  sales basis is available. Recorded receipts / cash collected may be shown for information only
  and must not silently become the allocation basis. The percentages stay provisional.
- **S2:** unfunded-target tests only with a validated sales basis.
- **S3:** the material income-quality warnings and their effects are defined; duplicates are
  counted once and never merged automatically.
- **S4:** future-dated receipts are excluded from current totals until effective, and are then
  still informational only.

Owner direction (2026-10-25, sixth revision): recorded as the intended product direction. These
are not new answers to any open question unless stated:
- three distinct figures: sales, cash collected (including old-debt collections) and available
  pharmacy cash;
- sales-based five-bucket targets on validated sales; percentages provisional; target and funding
  separate;
- spending recommendations only on confirmed pharmacy-owned cash, with the Director inputs in
  §2C;
- the credit-sale, collection, partial, pending, failed and repeated-receipt rules (section 5);
- PBSRx remains the source of pharmacy sales and supplier debt, with no competing ledger;
- PBSRx definitions to be documented, validated and reconciled (section 8 findings);
- the five-bucket feature is built and tested before activation; live recommendations stay held
  (U13 unchanged);
- the integrated consistency rules (section 1).

Confirmed by the owner (2026-10-25, revision 6):
- **U14:** the whole five-bucket feature is built and fixture-tested before the sales basis has
  been validated (unchanged from the revision-6 narrowing above). Explicitly recorded, confirmed
  allocations of real money — for example an owner-entered Reserve allocation — may be tracked
  **live** before the sales basis has been validated, provided all of the following safeguards are
  applied:
  - **ownership:** the money is confirmed pharmacy-owned before it is tracked as an allocation;
  - **confirmation:** the allocation exists only after an explicit owner action, never an inferred
    or default state;
  - **funding:** the allocation is backed by actual recorded cash, never by an unfunded target or
    a figure derived from an unvalidated sales basis; and
  - **reconciliation:** the allocation reconciles to actual cash, with any mismatch disclosed, not
    assumed away.

  Live sales-based bucket targets and allocation recommendations are **not** activated by this
  decision: they still wait for the sales basis to be validated under stage 8 (U13 unchanged). A
  bucket target or allocation record is never itself cash, proof of collection, or permission to
  spend. An unconfirmed allocation must never be represented as funded cash. Reserve stays
  protected: using it still requires explicit owner approval, with the reason, consequences and
  alternatives made clear before any approval.
- **U15:** KoboFlow will track receivables, including pharmacy receivables, with stable source
  references where available and the duplicate and reconciliation safeguards in section 5. PBSRx
  remains the authoritative source for pharmacy sales; KoboFlow must not create a competing
  pharmacy sales ledger or present an unverified receivable as a validated sale. A credit sale does
  not increase cash. Collecting an existing debt increases cash and reduces the existing
  receivable; it does not create a new sale. A partial payment reduces the receivable only by the
  amount actually received. A pending or failed transfer is not a cash receipt. Duplicate receipts
  and duplicate payment allocations are prevented. A receivable without a reliable PBSRx source
  reference, or that cannot be reconciled, stays visibly unverified or awaiting reconciliation,
  never shown as validated. Any change to PBSRx itself remains a separate task requiring its own
  explicit authorization.

The owner's restated and confirmed requirements were given in the requests themselves. Apart from
the PBSRx bucket code noted in section 3, they are not verified against any earlier written
specification.

### Unresolved: need the owner's answer before the stage that depends on them

| Id | Question | Blocks |
|---|---|---|
| H3 | When extra principal is paid, does the lender usually shorten the term or lower the instalments? (The current placeholder assumes shortening) | Stage 1 refinement |
| H6 | Default priority among same-date obligations, or always ask? (Requirement: ask the owner when not all can be met) | Stages 2, 7 |
| U1 | Approve database version changes for receivables and plan history (with the same verified-safety-copy procedure as v4)? | Stages 6, 7 |
| U6 | How many months of history before the bucket targets are reassessed (3 proposed)? | Stage 7 |
| U7 | Until PBSRx stock valuation is validated, how should restocking be reported? (Proposed: an "inventory purchase" cash outflow, excluded from operating expense and runway, with stock "not valued" in Net Worth) | Stage 9, Analytics |
| U8 | Build an estimate-only break-even with owner-entered margin before PBSRx is validated? (If yes: labelled "estimate, not validated" and never used by the Director as fact) | Stage 9 ordering |
| U10 | Add a "refund" entry type, or route refunds to review only? | Stage 4 |
| U11 | Which bucket pays loan instalments, bills, rent and salaries, and how is an unspent Owner allocation treated? (Was part of the earlier U3 question; the confirmed U3 decision covers Reserve only) | Stage 7 |

### Implementation assumptions to verify at stage start

These are not open decisions. They are facts to check in the code before relying on them:
- **Stage 2:**
  - the exact `meta` record shapes for confirmations, thresholds and Used For markers;
  - whether adding them needs a database version change (expected not; not promised);
  - that export excludes them, and import ignores them.
- **Stage 2:** that `today()` (local date) is used for every "today" comparison.
- **Stage 2:** the interpretation of "obligations refreshed" for KoboFlow's own bills and loans.
- **Stage 5:**
  - that `remParts` gives a verifiable remaining interest and fees figure for partly paid
    instalments with known splits;
  - that every instalment with an unsplit (provisional) allocation is detected and reported as
    uncertain (H1);
  - that "due" means overdue or due today in local date terms.
- **Stage 2:** that one shared pharmacy-eligible cash function can serve all five screens (G2),
  and that `reservationPlan` can identify each earmark's account eligibility (G1).
- **Stage 2:** the exact shape of the Used For marker (account id, confirmed value, time) and its
  invalidation check (G4).
- **Stages 7–8:** what counts as a "validated sales basis" (the evidence to be recorded in
  stage 8) before live allocation recommendations start (U13).
- **Stage 9:** that the setup history can hold and back up the full floor decision records without
  a new store (otherwise U1 is needed).
- **Stage 6:** how a "payment pending" status and failure notes are stored. This is part of the
  receivables store (U1).
- **Stage 8:** that PBSRx sales lines, refunds, GRNs and supplier payments can be exported with
  stable ids for reconciliation. Today supplier invoices and returns are matched by name.

### Conflicts noted

- **Percentages and the Director.** The earlier Director blueprint said "no arbitrary percentages"
  (audit B4). The five buckets are percentage targets.
  - Reconciliation: the percentages are the owner's own protected targets, not KoboFlow
    rule-of-thumb advice. The Director applies them as the owner's plan and labels them
    provisional.
  - KoboFlow's own heuristic percentages elsewhere (Autopilot, P3-1) remain to be labelled or
    aligned.
- **"Total daily sales" and the PBSRx code.**
  - The owner describes the basis as total daily sales. PBSRx's Cash Desk applies the targets to
    the day's cash collected, and its summaries use cash, falling back to sales.
  - These differ on credit sales and when change is counted in. Recorded, not changed (U2).
  - Resolved for KoboFlow's purposes by U12: PBSRx bucket figures are not used for live
    recommendations until validated.
  - Further resolved by U13: KoboFlow holds live allocation recommendations until a validated
    sales basis exists, rather than using receipts as a substitute basis.
- **The floor: "manual" versus "evidence-based".** Resolved by U4a: the manual floor stays in
  force until the owner explicitly approves a calculated one; the previous value and the decision
  history are kept.
- **Restocking.** It is currently reported as an operating expense, which conflicts with section 7
  (U7).
- **Handoff document.** The "own origin" statement conflicts with the repository's PWA test
  (P2-3).
- **Owner support.** It is an owner commitment, not an expense (decided). The 15% Owner bucket and
  the household-spending lines (section 4) must respect the same classification. How unspent Owner
  allocation is treated is U11.

## 12. Audit traceability

Every finding in `docs/turnaround-readiness-audit.md` and where it is handled:

| Audit item | Stage |
|---|---|
| D2, D3 (P0-1) | 1 (awaiting verification) |
| DIR-1, DIR-3, DIR-5, DIR-6 (P0-2) | 2 |
| P0-4 warnings (negative, unknown type, Loan category, loan as bill, restricted-source earmark) | 2 |
| E1 PBSRx figures untrustworthy | 8 (validation); disclosed in 7 |
| E2 v2 income with a From account | Done earlier (read-only warning); kept in 2 |
| E3 mislabelled D4 quick entries | 2 (warning), 4 (fix) |
| E4 negative or unknown records | 2 |
| E5 loan entered as agreement and bill | 2 |
| D4 (P0-3) | 4 |
| DIR-4 (P1-1, H1) | 2 (conservative pharmacy-eligible cash on five screens, earmark eligibility, Used For confirmation; G1–G5), 3 (fix) |
| P1-2 receivables, expected inflows (H2) | 6 |
| P1-3 beyond-30-day note | 2 |
| P1-3 monthly destination, progress, trading days | 7 |
| P1-3 pharmacy performance | 9 ("not available" until validated) |
| D1 (P1-4) | 5 |
| DIR-2 (P1-5) | 5 |
| P2-1 PBSRx handoff | 8 |
| P2-2 Cockpit documentation | 8 |
| P2-3 handoff origin and credentials | 8 (before integration) |
| P2-4 bill reminders | 5 |
| P2-5 cross-tab protection | 5 |
| P2-6 settlement-reversal and amendment tests | 5 (settlement reversal is already covered by stage 1 tests) |
| P2-7 production release preparation | 10 |
| P3-1 Autopilot heuristics | 7 |
| P3-2 investment without a To account | 3 |
| P3-3 one "left after" horizon | 3 |
| P3-4 restocking as inventory (H4) | 9 (interim U7) |
| H3, H6 | Section 11 (unresolved) |
| H5 Net Worth future interest | Decided (fourth revision), refined by H1–H3 (fifth revision); implemented in 5 |
| U13 allocation basis (new, not an audit item) | Decided (fifth revision); live recommendations held in 7 until a validated sales basis from 8 |
| Audit G acceptance plan | 10, with the section 10 scenarios |

## 13. Change log

| Revision | Date | Change | Why |
|---|---|---|---|
| 1 | 2026-10-24 | Plan created from the readiness audit and the owner's requirements | Durable plan for the turnaround |
| 2 | 2026-10-24 | U2–U5 recorded; business/household separation moved to stage 3; Stage 2 fully specified | Owner decisions; separation made a critical priority |
| 3 | 2026-10-24 | U4a, U5a, U5b, U9 and U12 recorded | Owner decisions |
| 4 | 2026-10-24 | Corrections 1–4 (receipts are not sales, confirmation storage, conservative Business-only cash, floor history) and H5 | Financial-safety review |
| 5 | 2026-10-24 | G1–G5, H1–H3, S1–S4, U13; U14 recorded as open | Final consistency review |
| 6 | 2026-10-25 | Three money figures and provenance labels (§1); Director inputs (§2C); collections in cash collected, and bucket build-versus-activation, target versus funding (§3); credit-sale, collection, pending and failed rules (§5); PBSRx `344b565` findings and smallest safe fixes (§8); Stages 6, 7 and 8 scope and tests; scenarios E35–E41; U14 narrowed, then decided; U15 added, then decided; revision header corrected from 5 to 6 | Owner's continuation and integration direction; PBSRx inspection; the owner's U14 and U15 decisions (§11) |
| 7 | 2026-10-25 | Implementation-scope note added to the Stage summary (§9): records that an integrated, independently-audited implementation pass delivered Stage 1 in full plus the interim parts of Stage 2, Stage 3's core separation, and Stage 5's H5 Net Worth change, together as one unit; Stage 2/3/5 status cells updated to point to the note; no stage marked complete, no later-stage requirement touched | An independent Stage 1 financial-safety audit found the delivered work spans more of this plan's own stage sequence than its "Stage 1" status cell alone showed, which would mislead anyone using this document to track what is done |

---

*Planning document only. Each stage starts only on the owner's instruction, after the previous
stage is tested and reviewed.*
