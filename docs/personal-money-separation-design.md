# KoboFlow: personal money management and pharmacy/personal separation

- **Status:** revision 6 — complete architecture specification, ready for review and staged
  implementation authorisation. Incorporates the owner's decisions D1–D14, Q1–Q5 and R1–R4, resolves
  design problems P1–P8, and includes the final consistency and readiness review (section 24). **Documentation only:
  nothing described here as design is implemented.** No application code, test, database schema or
  version, master plan, PBSRx, deployment or Git history was changed to write it. Revision 6 has been
  committed locally.
- **Code basis:** branch `claude/koboflow-loan-management-qn2vql` at
  `03d8dee190b000457b25e298f323af8976668389` (also what the isolated TEST site serves).
- **Relationship to the master plan:** details and extends section 3 (Owner bucket) and section 4
  ("Business and household money") of `docs/financial-turnaround-master-plan.md` (revision 8). The
  master plan's decided items (U2–U5, U4a, U5a, U5b, U9, U12, U13, H5, G1–G5) stay in force; section 21
  lists where this document refines them. The master plan itself is not edited here.

**Governing principle (owner):** KoboFlow manages two distinct financial positions — **Pharmacy
Money** and **Personal Money** — while keeping one accurate consolidated picture of wealth. Money
becomes personal when it is actually transferred, or otherwise legitimately received, into the
personal position.

**Labels used throughout:**

| Label | Meaning |
|---|---|
| **[Existing]** | Verified in the code at `03d8dee` (function or line named) |
| **[Owner-approved]** | An owner decision: Option C, D1–D14, Q1–Q5, R1–R4, or an earlier decided master-plan item |
| **[Design]** | This document's technical design implementing the approved direction; not yet built |
| **[Open]** | A question still needing the owner's answer (section 20.3) |
| **[Future]** | Implementation work, sequenced in section 23 |

---

## 1. Executive summary

**The problem [Existing].** KoboFlow classifies income and expenses by transaction type alone
(`classifyTxn`). The paying account plays no part, so personal groceries, fuel and breakfast are
counted as pharmacy spending in Analytics, Cash Flow, budgets, daily totals and the pharmacy
spending runway. The Director treats every bill and loan as a pharmacy obligation. There is no
monthly allocation record, no personal view, one global baseline date for every account, no way to
record a historical expense as paid from pocket cash, and the Shared pharmacy portion is a static
ceiling.

**What already protects the pharmacy [Existing]:** confirmed account ownership; confirmed pharmacy
cash that excludes personal, unconfirmed and unresolved money; owner withdrawals that are never
expenses; transfers that are never income or expense; outside and unresolved sides that never invent
a balance; the working-capital floor; the Director's conservative `safeToAllocate`; and imports that
are planned in full before one atomic write.

**The final design [Design]:**
1. **Two layers, never mixed:** a **cash-movement layer** (which accounts gained or lost money —
   unchanged, `accountDeltas`) and a **classification layer** (`scopeOf`: which position an entry
   belongs to and whether it is opex, personal spending, a withdrawal, a contribution, internal or
   unclassified). A central **measures table** (section 6) defines exactly which parts each figure
   uses, so no screen invents its own rule.
2. **`scopeOf` precedence:** explicit split → explicit purpose → Shared payer needs explicit purpose
   → confirmed-ownership default → vehicle default only when it agrees → otherwise unclassified.
   Conflicts are never resolved silently and stay visible after the owner resolves them (Q4).
3. **Per-account opening dates (Q1):** an account moves only with entries dated on or after the later
   of the global baseline and its own confirmed opening date. Existing accounts are unchanged.
4. **Conservative pharmacy figures:** unclassified outflows from pharmacy accounts reduce pharmacy
   cash (as cash movements always do) and count in the pharmacy burn rate, but never become pharmacy
   opex (Q5). Unclassified and unsplit obligations count in full against the safe withdrawal amount
   until reviewed, each counted exactly once (Q2).
5. **Running Shared portion (U5a)** from exact kobo splits, with uncertainty counting 0 (U5b).
6. **Monthly owner plans** (`ownerPlan` in `meta`), actual `owner_withdrawal` entries linked by
   `ownerPlanId`, a safety check with an audited override (D10).
7. **Versioned backup format (Q3, R2)** with the `transactions` collection kept in its normal shape,
   whole-file validation before any write, and a refusal guard. Builds already deployed (up to
   `03d8dee`, and production `main`) cannot detect a newer format, so **each site** must have the guard
   deployed and verified before that site writes any new financial field or new-format backup
   (section 15, site-by-site sequence).
8. **Historical reconciliation** through the existing Edit path (same id, `edits[]`), previewed,
   nothing reclassified automatically, no invented balances.

**Owner decisions:** D1–D14, Q1–Q5 and R1–R4 are all decided. **No owner decision is open, and none
blocks any stage.** The final consistency review (section 24) found seven inconsistencies across
revisions 4–6, all resolved in the design by applying already-decided rules.

---

## 2. Approved financial principles

### 2.1 Option C [Owner-approved]

1. A monthly personal allocation is a planned or approved amount.
2. Creating an allocation does not move money or reduce pharmacy cash.
3. Only an actual, recorded owner withdrawal moves money from a pharmacy account to a personal
   account.
4. The withdrawal reduces pharmacy cash and increases personal cash.
5. An owner withdrawal is not a pharmacy operating expense.
6. Personal expenses paid from personal accounts are personal expenses, not pharmacy operating
   expenses.
7. Transfers between personal accounts are transfers, not expenses.
8. An allocation that has not been withdrawn remains in the pharmacy.
9. Personal money management must not compromise pharmacy working capital, stock availability,
   supplier obligations or the working-capital floor.

### 2.2 D1–D14 [Owner-approved]

| Id | Decision |
|---|---|
| D1 | Personal accounts need explicit confirmation; confirmed Personal balances count in Personal Money and Net Worth, never in Pharmacy cash |
| D2 | Pocket-cash expenses stay unclassified until confirmed; distinct sources for Personal Cash, Outside, Unresolved |
| D3 | Approving a plan is separate from saving it; Draft → Approved → (partially/fully withdrawn) → Closed, or Cancelled |
| D4 | Month-end closes the period; the unwithdrawn amount stays in the pharmacy and never rolls forward silently |
| D5 | The remaining allocation appears in the Pharmacy Director as a planned commitment only |
| D6 | Each vehicle has an explicit purpose (Pharmacy, Personal, Shared, Unclassified) giving a default; transaction override allowed and audited |
| D7 | A controlled, editable personal category list; savings and investments are not expenses; loan principal reduces liability, interest and fees are expenses |
| D8 | Existing bills and loans are Unclassified until reviewed; new ones need a purpose; shared ones need an explicit split |
| D9 | A dedicated Personal Cash account is supported, alongside Outside; no invented historical balance |
| D10 | A withdrawal above the safe amount is allowed only with explicit owner override, recorded with full context |
| D11 | Plans live in the existing `meta` store, with stable ids, schema version, timestamps, status, history and reliable links |
| D12 | When a Shared account pays, an explicit purpose is required; a genuinely shared payment needs an exact split |
| D13 | Business→Personal and Personal→Business movements are not blocked; they are classified as owner withdrawal / contribution |
| D14 | Monthly plans are independent of the Owner bucket target but linked for visibility; never two claims on the same cash |

### 2.3 Q1–Q5 and R1–R4 [Owner-approved — resolved]

| Id | Decision |
|---|---|
| Q1 | **Approved.** Every account may have its own opening date; its opening balance is the real amount at that date, explicitly confirmed and audited; pre-opening history is never deducted again; existing accounts keep their calculations; the global baseline is not altered |
| Q2 | **Approved.** Unclassified and unsplit obligations count in full against the pharmacy safe-withdrawal amount until reviewed, shown in a review area, counted once |
| Q3 | **Approved as versioned compatibility** (not permanent omission of the `transactions` key): explicit format version, compatible build required, refusal before any write, whole-backup validation, older backups still accepted where safe, defined future-version handling |
| Q4 | **Approved.** Vehicle purpose vs confirmed payer ownership conflict → unresolved until the owner states the purpose; no automatic cross-boundary flow; resolution recorded and the conflict stays visible |
| Q5 | **Approved.** Confirmed pharmacy-account outflows reduce pharmacy cash even when their purpose is unresolved; they stay unclassified, are not pharmacy opex, are visible for review, affect the runway conservatively, and are never deducted twice |
| R1 | **Approved — yes.** Opening balances already saved through the existing review-and-confirm process count as confirmed; no re-confirmation; original history preserved; existing confirmed openings distinguished from unconfirmed ones; a newly introduced account's opening is not confirmed until a confirmation process is completed; ownership confirmation safeguards unchanged |
| R3 | **Approved — reset confirmation after restore.** When a backup is restored, opening-balance confirmations of Pharmacy, Personal and Shared accounts are reset and need explicit reconfirmation on the restored installation; opening date, opening amount and the original confirmation history are preserved; nothing is recalculated; historical transactions are untouched; unconfirmed restored openings never count as confirmed available cash; opening and ownership confirmation stay distinct; consistent with the H-1 restore principle |
| R4 | **Approved.** On restore, the previous account ownership confirmation is preserved as history (origin: source installation); the restored ownership is marked awaiting reconfirmation; the source confirmation is never treated as current; explicit reconfirmation on the restored installation is required and recorded in the account and setup history; the original ownership selection is preserved where available and never invented; nothing is erased; existing cash, balance and ownership safeguards are unchanged; applies to Pharmacy, Personal and Shared accounts; independent of opening confirmation (R3) |
| R2 | **Approved, subject to site-by-site guard requirements.** No site (TEST, production or any other) may create new-format backups until that site has a verified compatible reader guard; TEST success never establishes production compatibility; refusal before any write; older valid backups stay restorable; normal `transactions` collection kept; malformed and unsupported backups refused; no partial imports; creation and restoration use compatible rules; newer financial data is never restored with older meaning |

### 2.4 Earlier decisions that still apply [Owner-approved]

- PBSRx is authoritative for sales, stock, batches, expiry, supplier invoices and supplier debt;
  KoboFlow does not create a duplicate sales ledger (master plan section 8).
- Sales earned, cash collected, confirmed pharmacy cash, owner withdrawals, personal cash, personal
  expenses and pharmacy operating expenses are different figures (U2, U13).
- Uncertain money is never available money (U5b).
- Corrections go through the existing Edit flow; changing a classification never creates or removes
  a cash movement (master plan section 4).
- The working-capital floor is the owner-set figure until a calculated one is approved (U4, U4a).
- A Shared account counts only its declared, confirmed portion; the portion changes only through
  entries explicitly classified by purpose and is reconciled against the balance (U5a).
- Loan current liability is principal plus interest and fees already due; future interest is not a
  liability (H5).

---

## 3. Current architecture assessment (verified at `03d8dee`)

### 3.1 Transactions, accounts and storage [Existing]

| Fact | Where |
|---|---|
| Transaction fields: `id, type, amount, desc, cat, date, time, fromAcct, toAcct, state`; optional `paidTo`/`receivedFrom`, `vehicle`, `vehicleCat`, `billId`/`billOcc`, `agreementId`, `alloc`/`allocMode` (loan repayment split), `idemKey`, `edits[]`, `reclassified[]`, `voided`/`voidedAt`/`voidReason` | capture save, `EDIT_FIELDS`, `paymentOps`, `reversalOps` |
| Types: `expense, obligation, income, transfer, owner_withdrawal, investment, loan_receipt, loan_repayment, capital_injection` | `classifyTxn`, `TYPE_ACCTS` |
| Required sides: expense From only; income To only; transfer both; owner withdrawal From required, To optional; capital injection To required, From optional | `TYPE_ACCTS` |
| Balances move only through mapped `fromAcct`/`toAcct`; outside and unresolved sides invent nothing | `accountDeltas`, `accountBalances`, `sideStatus` |
| **One global baseline date** for all accounts: the opening balance is the balance at the start of that date; earlier entries never move a balance | `accountBalances`, `SETUP.baselineDate` |
| Setup save keeps **only listed account fields** (`id, label, institution, kind, use, useConfirmedAt, useConfirmedValue, sharedPortion, primary, opening, removed, access`); anything else is dropped | `confirmSetup` |
| Setup history records opening-balance and baseline changes with old and new values and a time | `saveSetup` change log, `ledgerSetup.history` |
| Account ownership `use` ∈ `''`/`business`/`personal`/`shared`; confirmation for any chosen value; Shared `sharedPortion {amount, declaredAt}` | `accountOwnership`, `ownershipConfirmed`, `resolveUseAndSharedPortion` |
| **Shared portion is a static ceiling** `min(declared, balance)`; payments do not lower it | `sharedPortion`, `pharmacyEligibleAccounts` |
| Account kinds wallet, bank, cash, coop, investment; access immediate/restricted | `ACCOUNT_KINDS`, `accountAccess` |
| Vehicles are a **hard-coded constant** (three named vehicles), not stored records | `VEHICLES` |
| Duplicate handling: `possible_duplicates` warning; import skips identical signatures (`txSig`, including pre-edit signatures); loan payments carry an `idemKey`; nothing merged automatically | `dataQuality`, `planImport`, `paymentOps` |
| Correction: Edit keeps the id and appends `edits[]`; reversal (`voided`) only for loan and bill payments | `saveEdit`, `reverseTxn`, `reverseBillPayment` |
| Database version 4; stores include `transactions`, `agreements`, `instalments`, **`allocations`** (loan payment allocations), `agreementEvents`, `opportunities`, `bills`, `meta` | `DB_VERSION`, `V3_STORES`, `V4_STORES` |

**Naming constraint (P7):** "allocation" is already used by the `allocations` store and the `alloc`
field on loan repayments. The monthly plan uses **owner plan** (`ownerPlan`, `ownerPlanId`).

### 3.2 Backups and import [Existing]

- **Export** writes `version: '4.0'`, `ledgerSetup` (the only `meta` record exported), and the
  transactions, agreements, instalments, allocations, events, opportunities and bills collections.
- **`planImport(data)`** is a pure planning step: it builds a list of writes and a report and writes
  nothing. It throws (refusing the whole file) only when there is no `transactions` array. `version`
  is read only to tell v3+ files (keep ids) from older ones; **there is no upper version check**.
  Individual invalid records are counted as rejected and skipped; the rest are planned.
- **`importJSON`** shows the plan's counts and notes, asks for confirmation, then calls `commit(ops)`,
  which writes **all planned records in one atomic IndexedDB transaction** (`db.atomic`). A refusal
  or a cancel before that leaves stored data untouched; a failed write stores nothing.
- A `ledgerSetup` in a backup is restored only into a device with no setup; a different setup is
  reported as a conflict and the current one kept.
- **H-1 restore rule:** `resetRestoredOwnership` clears every restored account's ownership
  confirmation (`useConfirmedAt`, `useConfirmedValue` set to `null`), so restored accounts are
  excluded from confirmed pharmacy cash until "Used For" is reconfirmed. It keeps the stored `use`
  (setting it to `''` — not chosen — only when it is missing). It does **not** keep the previous
  confirmation as history (it is overwritten), and it does not touch `opening` or `sharedPortion`
  (the declared portion is preserved but excluded until reconfirmed). R4 (section 7.5) adds the
  history without changing this financial behaviour.
- **Production `main` (`2f4ab03`)** is the older v2 app: its import replaces the in-memory transaction
  list with the file's `transactions` without a confirmation step and has no setup concept.

### 3.3 Classification and reporting [Existing]

- `classifyTxn` derives `income`, `expense`, `financeCost`, `ownerOut`, `internal`, `capitalIn`,
  `investment` **from the type alone.**
- Consumers that therefore count personal expenses as pharmacy spending: `cashFlowSummary`
  (operating), `spendingRunway` (shown against confirmed pharmacy cash), `budgetProgress`, Analytics,
  Home/Timeline daily totals, Owner Impact's income denominator.
- Owner withdrawals are already excluded from expenses and from runway spending (tested).
- `spendingRunway` = available cash ÷ average daily spending (expenses + interest and fees) over the
  history window from the baseline, minimum 30 days, maximum 90.

### 3.4 Cash, Director, Net Worth [Existing]

- **Recorded balances:** every account, any ownership.
- **Confirmed pharmacy cash:** confirmed Business balances, plus `min(declared portion, balance)` for
  a confirmed Shared account, less money received from an unresolved side (capped at the balance).
- **Director (`directorPlan`):** free-to-use confirmed cash − uncovered part of every obligation due
  in 30 days (overdue included) − floor = `safeToAllocate` (never below 0). Obligations are **every**
  bill occurrence and **every** loan instalment; linked earmarks cover them once. The Director is
  **qualified** when no floor is set or a high-severity data-quality finding exists.
- **Staleness signals that exist:** stale reservations (earmarks whose target is fully paid), the
  concurrent-change guard on writes, and high-severity data-quality findings. There is **no**
  general "data is out of date" timer.
- **Supplier and stock obligations:** none of KoboFlow's own; PBSRx data unvalidated (U12/U13).
- **Net Worth:** every account's recorded balance once, minus current loan liabilities, overdue bills
  and unlinked loan receipts; "Pharmacy-eligible cash (confirmed)" shown alongside.
- **Owner Impact:** withdrawals this month, last month, YTD, average, and a labelled ratio to income.

### 3.5 Tests protecting these behaviours [Existing]

`engine.test.js` (withdrawals and transfers not expenses; cash position; 5 runway tests; budgets;
3 Director tests), `stage1-ownership-and-liability.test.js`, `movement-rules.test.js`,
`mapping-impact.test.js`, `stage0-truthfulness.test.js`, `integrated-build.test.js`, `e2e.test.js`
(Shared restore), `bills.test.js` (floor once), `transaction-edit.test.js`, `save-export.test.js`.
All must keep passing; section 19 lists expectations that would change.

### 3.6 Historical data finding [Existing, from the earlier read-only investigation]

- Expenses captured in live mode **before `03d8dee`** while Personal Cash was "Not used" were stored
  with an **empty** source (`fromAcct: ''`), state Needs Review; no mapping change can reach them.
  Owner-confirmed examples (personal expenses paid from personal cash): Breakfast ₦2,000 (20 Oct
  2026), Breakfast ₦500, Shaving stick ₦500, Window Repair ₦1,500 (21 Oct 2026) — ₦4,500.
- Expenses captured **before live setup** kept the legacy id `pers_cash` (fuel kia black, ₦3,000,
  20 Oct); they follow the Personal Cash mapping.
- All are counted as expenses in every report; none moves a balance.
- "Personal Test." is a personal **bank** account (₦10,000), not personal cash.

### 3.7 Conflicts with the approved direction [Existing]

| # | Conflict |
|---|---|
| C1 | Reports classify by type only |
| C2 | No per-entry purpose |
| C3 | A Business→Personal `transfer` is "internal" (D13) |
| C4 | All bills and loans are pharmacy obligations (D8, Q2) |
| C5 | No owner plan (D3, D4, D11) |
| C6 | Vehicles are not stored (D6, P8) |
| C7 | No outside source for an expense in Edit; Personal Cash only as a legacy mapping (D2, D9) |
| C8 | Budgets by category only (D7) |
| C9 | Static Shared portion (D12, P3) |
| C10 | One global baseline (Q1, P1) |
| C11 | No upper backup-version check in import (Q3, P6) |

---

## 4. The financial concepts, kept apart [Design]

| Concept | What it answers | Where it lives | Changes balances? |
|---|---|---|---|
| **Account ownership** | Whose money an account holds | account `use` + confirmation | No |
| **Account opening baseline** | From which date, and with what confirmed amount, the account is tracked | account `openingDate`, `opening`, opening confirmation (section 7) | Defines the starting balance |
| **Transaction purpose** | Who an entry was for (Pharmacy, Personal, Shared + split, Unclassified) | optional `purpose` / `split` | No |
| **Transaction type** | What kind of event it was | `type` | Indirectly (which sides exist) |
| **Cash movement** | Which accounts gained or lost money | `fromAcct`/`toAcct` via `accountDeltas` | **Yes — the only thing that does** |
| **Income / expense classification** | Income, expense, finance cost, internal, capital… | `classifyTxn` (type) | No |
| **Scope** | Which position the classification belongs to | `scopeOf` (section 5) | No |
| **Obligation purpose** | Which position a bill or loan burdens | optional `purpose` / `split` on bills and agreements | No |
| **Monthly owner plan** | How much the owner intends to take this month | `meta` record `ownerPlan` | **Never** |
| **Actual owner withdrawal** | Money that actually left a pharmacy account for the owner | `owner_withdrawal` transaction | Yes |

Changing ownership, purpose, scope, obligation purpose or a plan never moves money. Only cash
movements change balances; only `scopeOf` assigns a position; only `classifyTxn` decides the nature;
only the measures table (section 6) decides which figure counts what.

---

## 5. The classification engine: `scopeOf` [Design]

### 5.1 Output

One result per live (non-voided, non-sample) entry; nothing else classifies.

```json
{
  "kind": "pharmacy | personal | owner_withdrawal | owner_contribution | pharmacy_internal | personal_internal | cross_pharmacy_paid_personal | cross_personal_paid_pharmacy | unclassified",
  "parts": { "pharmacy": 12000, "personal": 8000, "unclassified": 0 },
  "basis": "explicit_split | explicit_purpose | account_ownership | vehicle_default | movement_rule | none",
  "payer": { "side": "from", "status": "mapped | outside | unresolved | none", "ownership": "business | personal | shared | unconfirmed | none", "acct": "acc_opay" },
  "flags": ["purpose_differs_from_payer", "default_conflict_resolved", "defaults_disagree", "shared_needs_purpose", "split_does_not_reconcile", "outside_needs_purpose", "unresolved_source", "missing_source", "unconfirmed_account"]
}
```

`parts.pharmacy + parts.personal + parts.unclassified` equals the amount exactly, in kobo (`toK`).

### 5.2 Precedence for income, expense, obligation and loan-repayment entries

The **payer** is the paying side for money out, the receiving side for money in. Evaluated in order;
the first applicable rule decides:

1. **Explicit split** (D12): reconciling amounts per position → `parts` from the split
   (`basis: explicit_split`). A non-reconciling split is ignored and the entry is **unclassified**
   (`split_does_not_reconcile`); it never applies "nearly".
2. **Explicit purpose** (`pharmacy` / `personal`), set only by the owner (`basis: explicit_purpose`).
   - Agrees with the payer's confirmed ownership, or the payer is outside, Personal Cash or missing →
     applies as is.
   - **Differs** from the payer's confirmed ownership → **cross-boundary** (5.4), flagged
     `purpose_differs_from_payer`.
   - `purpose: 'shared'` without a valid split → unclassified (`shared_needs_purpose`).
   - If the explicit purpose resolved a **default conflict** (rule 4), the flag
     `default_conflict_resolved` is kept permanently (Q4: the override stays visible).
3. **Shared payer** without explicit purpose or split → **unclassified** (`shared_needs_purpose`).
   The account's declared pharmacy portion is never applied per entry (D12).
4. **Defaults** when there is no explicit purpose (`basis: account_ownership` or `vehicle_default`):
   - payer's **confirmed** ownership: Business → pharmacy, Personal → personal;
   - **vehicle** purpose (D6) when the entry names a vehicle: Pharmacy or Personal;
   - only one default available → use it; both available and **agree** → use them;
   - both available and **disagree** → **unclassified** (`defaults_disagree`) until the owner states
     the purpose (Q4). Two defaults never create a cross-boundary flow.
   - A vehicle purpose of Shared or Unclassified supplies no default.
5. **No usable default** → **unclassified**: payer outside (`outside_needs_purpose`, D2), unresolved
   (`unresolved_source`), missing (`missing_source`), unconfirmed or not chosen
   (`unconfirmed_account`).

### 5.3 Two-sided movements (D13)

Transfers, owner withdrawals, contributions and investments are classified by the **confirmed
ownership of both sides**; purpose does not apply to a movement between accounts.

| From | To | Kind |
|---|---|---|
| Business | Business | `pharmacy_internal` |
| Personal | Personal | `personal_internal` (Option C 7) |
| Business | Personal (incl. Personal Cash) | `owner_withdrawal` (whether stored as `transfer` or `owner_withdrawal`) |
| Business | outside | `owner_withdrawal`, destination untracked |
| Personal | Business | `owner_contribution` |
| outside | Business | `owner_contribution` (capital injection), source untracked |
| Shared | anything that changes position, or anything → Shared | per explicit treatment (`split` of the movement: pharmacy part / personal part, section 9); missing → unclassified |
| any | unresolved, unconfirmed, not chosen | unclassified |

- The stored `type` is never changed automatically. A stored `transfer` Business→Personal is scoped
  as an owner withdrawal and listed with a suggestion to edit the type. New entries: Add Entry saves a
  Business→Personal movement as `owner_withdrawal` and says so before saving.
- An owner withdrawal is never pharmacy opex and never personal income.

### 5.4 Cross-boundary flows (explicit purpose differs from the payer)

| Explicit purpose | Payer (confirmed) | Kind | Pharmacy | Personal |
|---|---|---|---|---|
| Personal | Business | `cross_pharmacy_paid_personal` | pharmacy cash falls (cash layer); counted as an **owner withdrawal (direct)**, linkable to the month's plan; **not** pharmacy opex | personal expense |
| Pharmacy | Personal (incl. Personal Cash) | `cross_personal_paid_pharmacy` | **pharmacy opex**; pharmacy cash **unchanged** | personal balance falls; counted as an **owner contribution (implicit)** |

Both are flagged and listed in a "paid from the other side this month" panel. They are deliberate
owner statements, never inferred.

### 5.5 Historical entries with missing information

- Empty source (`fromAcct: ''`): cash layer — no account moves; classification — unclassified
  (`missing_source`), unless the owner gives a purpose; the existing `missing_account` high-severity
  finding stays and keeps the Directors qualified.
- Legacy id: resolved through the mapping exactly as today (`sideStatus`), then the rules above.
- Nothing is inferred from category, description, cash-ness or the parser's defaults.

### 5.6 Examples

- **A — explicit personal, paid from pharmacy.** Gas refill ₦8,000 from Opay, purpose Personal:
  Opay −₦8,000; confirmed pharmacy cash −₦8,000; pharmacy opex unchanged; personal expenses +₦8,000;
  owner withdrawals (direct) +₦8,000.
- **B — vehicle conflict (Q4).** Fuel ₦15,000 for a vehicle whose purpose is Personal, paid from
  confirmed Business Opay, no explicit purpose: Opay −₦15,000; confirmed pharmacy cash −₦15,000;
  **unclassified** (`defaults_disagree`); in the unresolved-spending panel; in pharmacy burn (section
  6), not pharmacy opex. The owner later states Personal: the edit records the conflict and the
  choice in `edits[]`; the entry becomes `cross_pharmacy_paid_personal` with
  `default_conflict_resolved` still shown.
- **C — pocket cash (D2).** Lunch ₦1,200 from Outside, no purpose: no balance moves; unclassified;
  listed. Owner states Personal → personal expense ₦1,200; still no balance moves.

---

## 6. Cash movement versus classification: the central measures table [Design]

**Two layers.**
- The **cash layer** answers "where did money go?" It is `accountDeltas`/`accountBalances`, unchanged
  except for per-account opening dates (section 7). Every mapped side of every live entry moves its
  account **once**, whatever its classification.
- The **classification layer** (`scopeOf`) answers "whose activity was it, and what kind?" It never
  moves money.

Every figure is defined once, here, and every screen reads it from one function:

| Figure | Source | Definition |
|---|---|---|
| **Account balance** | cash layer | opening (as at the account's effective opening date) + mapped sides of entries dated on/after it |
| **Confirmed pharmacy cash** | cash layer + ownership | confirmed Business balances + running Shared pharmacy portions (section 9) − held unresolved inflows (capped) |
| **Pharmacy operating expenses** | classification | `parts.pharmacy` of expense/obligation entries (incl. `cross_personal_paid_pharmacy`) + finance cost of pharmacy-purpose loans |
| **Unresolved spending (pharmacy accounts)** | classification + cash layer | `parts.unclassified` of expense/obligation entries whose cash movement left a pharmacy account (Business, or the pharmacy-treated part of a Shared account) |
| **Unresolved spending (other)** | classification | `parts.unclassified` of entries with no pharmacy-account cash movement (outside, missing, personal-account) |
| **Pharmacy cash burn** (runway denominator) | measures above | pharmacy operating expenses + **unresolved spending (pharmacy accounts)** + pharmacy finance cost |
| **Pharmacy runway** | measures above | confirmed pharmacy cash (available) ÷ average daily pharmacy cash burn over the existing window rules |
| **Personal expenses** | classification | `parts.personal` of expense/obligation entries (incl. `cross_pharmacy_paid_personal`) + personal-purpose finance cost |
| **Owner withdrawals (actual)** | classification | `owner_withdrawal` kind + `cross_pharmacy_paid_personal` |
| **Owner contributions** | classification | `owner_contribution` kind + `cross_personal_paid_pharmacy` |
| **Pharmacy sales / receipts** | unchanged | never affected by personal flows or withdrawals |

**Why Q5 never deducts twice.** An unresolved ₦20,000 outflow from Opay reduces the **stock** of cash
once, in the cash layer (Opay balance, confirmed pharmacy cash). Separately, it is one item in the
**rate** of spending (pharmacy cash burn), exactly as a classified expense would be; it is never also
pharmacy opex, and no "adjustment" is added anywhere. The partition `pharmacy + personal +
unclassified = amount` guarantees each naira is in exactly one classification bucket.

**Example 15 — Q5.** ₦20,000 leaves confirmed Pharmacy Opay, purpose unknown:

| Figure | Before | After |
|---|---|---|
| Opay balance | ₦400,000 | ₦380,000 |
| Confirmed pharmacy cash | ₦400,000 | ₦380,000 |
| Pharmacy operating expenses (month) | ₦85,000 | ₦85,000 (not included) |
| Unresolved spending (pharmacy accounts) | ₦0 | ₦20,000 (panel, for review) |
| Pharmacy cash burn over the window | includes classified spending | + ₦20,000 |
| Runway | — | lower: smaller cash ÷ higher burn |

When the owner later classifies it as Pharmacy, it moves from "unresolved" to opex (burn and cash
unchanged); as Personal, it becomes `cross_pharmacy_paid_personal` (an owner withdrawal, leaving the
burn, as withdrawals are not spending today), and the preview shows the runway change before saving.

**Historical entries with a missing payer** (the four ₦4,500 entries): no pharmacy-account cash
movement, so they are "unresolved spending (other)": not in pharmacy opex, not in pharmacy burn, not
in any balance. The existing `missing_account` finding keeps the Directors qualified while they
exist; they are listed for review.

---

## 7. Account opening dates and opening balances (Q1, P1) [Design]

### 7.1 Rule

- New optional account fields: `openingDate` (ISO date) and opening confirmation
  (`openingConfirmedAt`, `openingConfirmedValue: {date, amount}`), alongside the existing `opening`.
- **Effective opening date** of an account = the later of the global `baselineDate` and its
  `openingDate` (if set). Its balance = `opening` (the real amount at the **start** of that date) +
  mapped sides of live entries dated **on or after** it.
- **Existing accounts:** no `openingDate` → effective date = the global baseline → every balance is
  exactly as today. The global baseline is not altered.
- Entries dated before an account's effective opening date never move that account (they are already
  inside its opening amount, or the account was not tracked then). They stay in history and reports
  under the normal classification rules; an informational notice lists them (as the existing
  `pre_baseline` notice does for the global baseline).
- Validation: `openingDate` must be on or after the global baseline and not in the future.

### 7.2 Opening balance confirmation

- An opening is **confirmed** when the owner saves it through the setup review with an explicit
  "Opening balance confirmed at <date>" step; `openingConfirmedValue` records the date and amount
  confirmed, `openingConfirmedAt` the time.
- If the current `opening`/`openingDate` differ from the confirmed value, the opening is
  **unconfirmed**: the account is flagged, and its money is excluded from the available figures of its
  position (pharmacy or personal) until confirmed — the same pattern as ownership confirmation (G4).
- **R1 (owner-approved — yes):** openings already saved on this device through the existing two-step
  setup review ("Review & Save" then "Confirm & Save") **are confirmed**. The design:
  - **Source of the confirmation is recorded** in `openingConfirmedSource`:
    `'setup_review'` (an opening saved through the existing review before this feature, recognised
    from the stored setup, whose `updatedAt` and `history` already record when it was saved) or
    `'explicit'` (confirmed through the new opening-confirmation step). Both count as confirmed.
  - **No re-confirmation prompt** for those openings, and **no write is needed to recognise them**:
    an account with a stored `opening`, no `openingDate`, no `openingConfirmedValue` **and no restore
    marker** (`openingConfirmationState` absent, and the setup not marked as restored — section 7.5)
    is read as confirmed with source `setup_review`. A restored opening is never recognised this way
    (readiness finding F5). Its effective date stays the global baseline, so its balance
    is exactly today's. The original setup history is kept untouched; the first later setup save
    records `openingConfirmedValue` from the unchanged stored values (an audit addition, never a
    balance change).
  - **Distinguished from unconfirmed:** the account screen shows "Opening confirmed (setup review,
    <date>)" versus "Opening not yet confirmed". There are no inferred openings: KoboFlow never derives
    an opening amount from entries.
  - **A newly introduced account** (for example Personal Cash) is unconfirmed until the owner completes
    the setup review, which for a new account includes the explicit "Opening balance confirmed at
    <date>" line, so the existing process and the new step are the same act.
  - **Changing** an opening amount or date (section 7.3) makes it unconfirmed until reviewed again.
  - **Ownership confirmation is separate** (`useConfirmedValue`/`useConfirmedAt`, G4, and the
    post-upgrade reconfirmation decided in master plan revision 8); its rules are unchanged, and R4
    adds only its restore history (section 7.5).
  - **Restored backups:** confirmation is reset and must be given again on this installation (R3,
    section 7.5).

### 7.3 Corrections without double counting

- Balances are always **recomputed** from opening + entries on/after the effective date; nothing is
  accumulated, so a correction cannot double-count.
- **Changing the opening amount:** reviewed in setup with before → after balance; recorded in the
  setup history (existing mechanism) and requires reconfirmation.
- **Moving `openingDate` earlier:** entries between the new and old dates start moving the account;
  the review lists them and their effect, and requires the owner to restate the opening amount **as
  at the new date** (never derived automatically).
- **Moving it later:** entries between the dates stop moving the account; the review lists them; the
  opening must be restated as at the new date.
- Every change is in the setup history with old and new values and time.
- **Implementation fact:** `confirmSetup` keeps only listed account fields; `openingDate` and the
  confirmation fields must be added to that list, or they would be dropped on save.

### 7.4 Backups and consistency

- The new fields travel inside `ledgerSetup.accounts`, which export already includes.
- An older build would ignore `openingDate` and deduct pre-opening entries again — one of the reasons
  for the format guard and the site-by-site write gate (section 15).
- **Every baseline consumer uses the effective per-account date** (readiness finding F3, section 24):
  `accountBalances`, `mappingImpact`, `unreconciledInflows`, `movementReview`, the `pre_baseline` and
  `income_with_from` checks (`incomeFromFindings`), and the setup preview. A consumer left on the
  global baseline would disagree with balances.

### 7.5 Confirmations after a backup restore (R3 openings, R4 ownership) [Owner-approved R3, R4; Design]

**Two independent confirmations.**

| | Ownership confirmation | Opening-balance confirmation |
|---|---|---|
| Establishes | whether the account is Business, Personal, Shared or not chosen | that the account's opening date and opening amount were reviewed and confirmed |
| Fields | `use`, `useConfirmedValue`, `useConfirmedAt` (existing); `ownershipConfirmationState`, `ownershipConfirmationHistory[]` (R4) | `opening`, `openingDate`, `openingConfirmedValue`, `openingConfirmedAt`, `openingConfirmedSource`, `openingConfirmationState`, `openingConfirmationHistory[]` (Q1, R1, R3) |
| Governs | which position the account's money belongs to, and `scopeOf`'s ownership default | whether the opening balance may count in available figures |
| Current when | `useConfirmedValue === use` and `useConfirmedAt` set, and no restore marker (existing `ownershipConfirmed`) | `openingConfirmedValue` matches `{openingDate, opening}`, or R1 `setup_review` recognition, and no restore marker |

- **Both must be current on this installation** before an account's money contributes to confirmed
  available cash (pharmacy) or available Personal Money. Neither substitutes for the other; each is
  given, recorded and displayed separately, even when one setup review covers both.
- Recorded balances and Net Worth do not depend on either confirmation (an account with any
  unconfirmed state stays in the Unconfirmed subtotal).

**Restore rule.** When a backup's setup is restored (today: only into a device with no setup), every
restored account — Pharmacy, Personal and Shared alike — has **both** confirmations reset and needs
both given again on this installation. The restore **resets confirmations, never information**.

**What the restore does to each account, inside the planned import (one atomic write, section 15):**

| Field | After restore |
|---|---|
| `use` (ownership selection) | **preserved** as in the backup; set to `''` (not chosen) only if missing — never invented or guessed from the label, kind or history (existing H-1 behaviour) |
| `useConfirmedValue`, `useConfirmedAt` | copied into `ownershipConfirmationHistory[]` as `{value, at, origin: 'source_installation', restoredAt, currentAtSource}` (`currentAtSource` false if the source confirmation no longer matched `use`, or was absent), then cleared to `null` (existing H-1 reset) |
| `ownershipConfirmationState` | `'restored_awaiting'` (R4) |
| `sharedPortion` | **preserved** with its original `declaredAt` (existing behaviour); counts ₦0 until ownership is reconfirmed |
| `opening`, `openingDate` | **preserved exactly** (byte-identical to the backup) |
| `openingConfirmedValue`, `openingConfirmedAt`, `openingConfirmedSource` | copied into `openingConfirmationHistory[]` as `{value, at, source, origin: 'source_installation', restoredAt}`, then cleared |
| `openingConfirmationState` | `'restored_awaiting'` (R3) |
| Format-1 accounts with no opening or ownership confirmation fields | both markers set; history records `{origin: 'source_installation', note: 'no confirmation recorded in the backup', restoredAt}` |
| Setup record | `restoredAt`, and a setup-history entry "restored from backup" |
| Transactions | **untouched** |

- A source confirmation is kept **only as history** and is never treated as current here. The R1
  `setup_review` recognition never applies to an account carrying a restore marker or restored with a
  setup that has `restoredAt` (F5).
- **Ambiguous or missing source information** (an empty `use`, a confirmation that no longer matched
  `use`, a missing opening date) is recorded as it was; nothing is completed or inferred.
- **Nothing is recalculated:** no replacement opening, no derived ownership, no transaction edit.

**Lifecycle (both confirmations):**

| Step | Ownership | Opening | Money counted as confirmed available? |
|---|---|---|---|
| 1. Source installation confirms | current (`useConfirmed*`) | current (`openingConfirmed*`) | yes |
| 2. Backup exported | exported with current fields and any history | exported with current fields and any history | (unchanged on source) |
| 3. Backup restored on a new installation | source confirmation → history; `null`; `restored_awaiting` | source confirmation → history; cleared; `restored_awaiting` | **no** (₦0) |
| 4. Awaiting reconfirmation | "Restored — awaiting reconfirmation" | "Restored — awaiting reconfirmation" | no |
| 5. Owner reviews in setup | sees the selection and source history | sees date, amount and source history | no |
| 6a. Owner confirms ownership only | current; marker cleared; history + setup history "confirmed on this installation" | still awaiting | **no** |
| 6b. Owner confirms opening only | still awaiting | current (`explicit`); marker cleared; history + setup history | **no** |
| 7. Both confirmed on this installation | current | current | **yes** |
| Re-export before step 7 | exported with `null` confirmation, marker and history | exported with cleared confirmation, marker and history | — |
| Restore of that re-export | stays awaiting; a further history entry `{currentAtSource: false}` is added; never upgraded to current | stays awaiting; history kept; never upgraded | no |

- **Reconfirmation** uses the existing setup save: saving a "Used For" value records
  `useConfirmedValue`/`useConfirmedAt` (`resolveUseAndSharedPortion`, existing) and now also clears
  `ownershipConfirmationState` and appends to `ownershipConfirmationHistory[]`; the opening is confirmed
  by its explicit line in the same review (7.2). Changing a value during review is a correction (7.3;
  ownership changes are already logged by the existing change log).
- **Implementation fact:** `confirmSetup` keeps only listed account fields, so the state and history
  fields of both confirmations must be added to that list.

**Effects while either confirmation is awaiting** (no double deduction, nothing erased):

| Figure | Effect |
|---|---|
| Recorded account balance | computed normally from the preserved opening and effective date; shown, labelled with the awaiting state(s) |
| Confirmed pharmacy cash | ₦0 from the account (Business, and a Shared account's portion) until both confirmations are current |
| Personal Money available | ₦0 from the account until both are current |
| Shared portion | declared and running portion preserved and computed, but count ₦0 until both are current |
| Net Worth | recorded balance in the **Unconfirmed** subtotal (no money disappears or doubles) |
| Directors and reports | qualified, listing the accounts awaiting reconfirmation (F7 below) |
| Classification of entries | `scopeOf` uses **ownership** confirmation only (F6): while ownership awaits reconfirmation, entries paid from the account have no ownership default and are unclassified unless they carry an explicit purpose or split; reconfirming the opening alone changes no classification |

**F7 — reports while ownership awaits reconfirmation.** Under the decided rules (D1; 5.2 rule 5),
entries whose classification depended only on the account's ownership become unclassified after a
restore until ownership is reconfirmed. Pharmacy opex and personal expense totals would therefore look
smaller during that period. Safeguard (no new policy): every report and both Directors show
"Classification incomplete: N accounts await ownership reconfirmation; ₦X of entries are unclassified
until then" and are qualified; no figure is presented as complete while any account awaits.

**Interface states** (per confirmation, on the account screen and in the setup review):
- **"Confirmed on the source installation (<date>)"** — history only;
- **"Restored — awaiting reconfirmation"** — current state after restore;
- **"Confirmed on this installation (<date>)"** — current state after the owner confirms.

**Example 18 — restore.** A backup holds Opay (Business, confirmed 15 Oct; opening ₦500,000 at 15 Oct,
confirmed 15 Oct) and Personal Cash (Personal, confirmed 1 Nov; opening ₦12,000 at 1 Nov, confirmed
1 Nov). After restoring on a new phone:
- `use`, openings and dates are byte-identical; both accounts show both confirmations as "Restored —
  awaiting reconfirmation", with the source confirmations in history;
- recorded balances equal the source device's (no entry counted twice);
- confirmed pharmacy cash ₦0 from Opay and Personal Money ₦0 from Personal Cash; both in Net Worth
  (Unconfirmed); reports and Directors show the F7 notice;
- the owner reconfirms Opay's ownership only: still ₦0; then its opening: Opay counts again;
- the audit history shows the restore, the source confirmations and each new confirmation.

### 7.6 Example 16 — Personal Cash with its own opening date

Global baseline 15 Oct 2026. The owner adds Personal Cash on 1 Nov 2026 and counts ₦12,000 in hand;
confirms opening ₦12,000 at 1 Nov.
- Historical breakfast ₦2,000 (20 Oct) and the other group-A entries are dated **before** 1 Nov: they
  cannot be assigned to Personal Cash (the form refuses: "before this account's opening date"; the
  ₦12,000 already reflects anything spent before). Their correct source is **Outside** (section 14).
- 5 Nov: owner withdrawal ₦30,000 Opay → Personal Cash: Opay −₦30,000; Personal Cash ₦12,000 →
  ₦42,000.
- 6 Nov: ₦2,000 personal expense from Personal Cash → ₦40,000.
- No historical expense is deducted from the ₦12,000 a second time, and no balance is invented.

---

## 8. Accounts and sources: Personal Cash, Outside, Unresolved (D1, D2, D9) [Design]

### 8.1 Ownership rules (D1)

| Ownership | Pharmacy cash | Personal Money | Net Worth subtotal |
|---|---|---|---|
| Business, confirmed (opening confirmed) | full balance (less held unresolved inflows) | — | Pharmacy |
| Business, unconfirmed | 0, flagged | — | Unconfirmed |
| Personal, confirmed (opening confirmed) | 0 | full balance | Personal |
| Personal, unconfirmed | 0 | 0, flagged | Unconfirmed |
| Shared, confirmed (opening confirmed), running portion certain | running pharmacy portion | the remainder | Shared (split shown) |
| Shared, other states | 0, flagged | 0, flagged | Shared, "split uncertain" |
| Not chosen | 0, flagged | 0, flagged | Unconfirmed |

Confirmation is owner-confirmed, not bank-verified (D1). Ownership confirmation already exists for
any chosen value; existing Personal accounts saved through the form are already confirmed.

### 8.2 The four kinds of source

| Source | What it is | Balance | Available money? |
|---|---|---|---|
| **Personal Cash account** (D9) | A Personal account of kind `cash`, with a confirmed opening at its own opening date | yes | Personal Money only |
| **Outside / untracked** | Money KoboFlow deliberately does not track (`'__outside'` side) | none | **never** |
| **Unresolved** | A side KoboFlow cannot place (legacy "Not used", removed account) | none | **never**; inflows from it are held out of pharmacy cash |
| **Missing** | Empty side (historical) | none | never |

"Unclassified" is not a source; it is a classification result (section 5).

**Outside is not a bypass:** it never adds to available cash; an Outside inflow into a pharmacy account
must be a capital injection or income; choosing Outside is an explicit, audited owner statement
(`edits[]` or mapping history) with the confirmed-cash effect previewed; the `outside_account` notice
stays; physical cash never implies ownership (D2).

### 8.3 Personal Cash (D9)

- Created in Settings → Accounts as kind `cash`, Used For Personal, ownership and opening confirmed,
  with its own opening date (section 7).
- **Example 6.** Owner withdrawal ₦30,000 from Opay to Personal Cash (opening ₦0 confirmed at its
  opening date): Opay −₦30,000; Personal Cash ₦0 → ₦30,000. A ₦2,000 personal expense: Personal Cash
  → ₦28,000; pharmacy unaffected.
- The legacy `pers_cash` quick-capture mapping is **not** pointed at the new account until the
  historical `pers_cash` entries are reviewed; entries dated before the account's opening date would
  not move it anyway (section 7), so the mapping-impact review shows only post-opening entries.

---

## 9. Shared accounts and splits (D12, U5a, P3) [Design]

### 9.1 Splits

- When a Shared account pays or receives, the entry needs an explicit purpose or a **split**:

```json
"purpose": "shared",
"split": { "pharmacy": 12000, "personal": 8000, "method": "amount" }
```

- `method: percent` is converted to amounts **once, at entry**, in kobo; any rounding remainder goes
  to the larger part; the stored amounts reconcile **exactly** to the entry amount.
- Missing → unclassified (`shared_needs_purpose`). Incomplete or non-reconciling → refused by the
  form; if found stored (for example after the amount was edited), unclassified
  (`split_does_not_reconcile`) until corrected. A purpose and a split together: the split wins only if
  it reconciles.
- The declared portion is never applied as a per-entry percentage.

### 9.2 Running Shared pharmacy portion (U5a — decided, **not implemented today**)

Today the portion is a static ceiling. The design:
- **Running pharmacy portion** = declared opening portion (at `declaredAt`, on/after the account's
  effective opening date) + pharmacy parts of inflows − pharmacy parts of outflows dated on/after
  `declaredAt`, in kobo.
- **Personal portion** = account balance − running pharmacy portion.
- **Transfers involving a Shared account** use the movement's split:
  - Shared → Business: pharmacy part = `pharmacy_internal` (portion −), personal part =
    `owner_contribution`;
  - Shared → Personal: pharmacy part = `owner_withdrawal` (portion −), personal part =
    `personal_internal`;
  - Business → Shared: pharmacy part = `pharmacy_internal` (portion +), personal part =
    `owner_withdrawal`;
  - Personal → Shared: personal part = `personal_internal`, pharmacy part = `owner_contribution`
    (portion +).
- **Certainty (U5b):** the portion counts toward pharmacy cash only while it is certain: no
  unclassified movement on the account since `declaredAt`, portion ≥ 0, portion ≤ balance. Otherwise it
  counts **0**, flagged high severity, until the movements are classified or the portion is
  re-declared.
- **No duplicate deduction:** each entry's cash moves the account once (cash layer); its pharmacy
  part moves the portion once (classification layer); the two are different quantities (a balance and
  its ownership split), never added together.

**Example 9 — shared electricity.** Shared account: declared pharmacy portion ₦100,000, balance
₦300,000. Electricity ₦20,000 split pharmacy ₦12,000 / personal ₦8,000.
- Balance ₦300,000 → ₦280,000; pharmacy opex +₦12,000; personal expenses +₦8,000.
- Running portion ₦100,000 → ₦88,000; personal portion ₦200,000 → ₦192,000; confirmed pharmacy cash
  from this account ₦88,000.
- A split of ₦12,000 + ₦7,000 (= ₦19,000) is refused; stored that way, the entry is unclassified and
  the portion becomes uncertain (counts ₦0) until corrected.

---

## 10. Monthly owner plan lifecycle (D3, D4, D5, D11, D14) [Design]

### 10.1 Record in the existing `meta` store

```json
{
  "id": "ownerPlan:2026-11:k3f9a1",
  "kind": "ownerPlan",
  "schemaVersion": 1,
  "period": "2026-11",
  "draftAmount": 300000,
  "approvedAmount": 300000,
  "status": "approved",
  "createdAt": "2026-10-30T09:00:00Z",
  "approvedAt": "2026-10-30T09:05:00Z",
  "cancelledAt": null,
  "closedAt": null,
  "ownerBucketReference": null,
  "notes": "School fees month",
  "history": [
    { "at": "2026-10-30T09:00:00Z", "action": "created", "draftAmount": 300000 },
    { "at": "2026-10-30T09:05:00Z", "action": "approved", "approvedAmount": 300000 }
  ]
}
```

- Stable unique id `ownerPlan:<period>:<random suffix>`; at most one non-cancelled plan per period
  (checked on save and import).
- **Stored:** `draft` / `approved` / `cancelled`, timestamps, `closedAt`, history.
- **Derived, never stored:** `withdrawn` = the owner-withdrawal amount of every non-voided entry
  linked by this `ownerPlanId` — that is, entries whose `scopeOf` kind is `owner_withdrawal`, plus the
  personal part of `cross_pharmacy_paid_personal` entries, plus the owner-withdrawal part of Shared
  movements (readiness finding F1: direct personal spending from pharmacy money counts against the
  plan, as section 5.4 says),
  `remaining = max(0, approvedAmount − withdrawn)`, `overPlan = max(0, withdrawn − approvedAmount)`,
  displayed status partially / fully withdrawn / over plan.
- `ownerBucketReference` (D14): optional informational figure from the Owner bucket when it is live
  (held under U13 today). Never a second claim on cash.

### 10.2 Lifecycle

| Step | Effect on money |
|---|---|
| Save draft | none |
| Approve (D3: separate one-tap step with confirmation) | none |
| Record withdrawals linked to it, after the money has moved | balances move (section 11) |
| Edit approved amount (history) | none |
| Cancel (linked withdrawals stay; shown as unplanned) | none |
| Close (D4) from the month-end summary; shown "ended, not yet closed" until then | none |

At month end the unwithdrawn amount **stays in the pharmacy**; it is not personal cash, a receivable
or a claim; nothing rolls forward; the next month needs its own plan. A withdrawal dated inside a
closed period but recorded later is accepted, linked, and flagged "recorded after closure".

### 10.3 Example 1 — monthly allocation (non-negotiable)

The owner approves ₦300,000 for November. Nothing withdrawn.

| Figure | Before | After |
|---|---|---|
| Approved plan | — | ₦300,000 |
| Actual withdrawn | ₦0 | ₦0 |
| Remaining planned | — | ₦300,000 |
| Pharmacy Opay (confirmed Business) | ₦500,000 | ₦500,000 |
| Personal bank | ₦40,000 | ₦40,000 |
| Pharmacy operating expenses | ₦85,000 | ₦85,000 |
| Personal expenses | ₦20,000 | ₦20,000 |
| Consolidated net worth | unchanged | unchanged |

**Example 14 — month-end.** November approved ₦300,000, withdrawn ₦250,000: at close, ₦50,000
unwithdrawn stays in the pharmacy; December starts with no plan.

---

## 11. Actual withdrawal lifecycle (D10, D13) [Design]

### 11.1 Transaction

```json
{
  "id": 1203,
  "type": "owner_withdrawal",
  "amount": 100000,
  "desc": "Owner plan, November part 1",
  "cat": "Owner Withdrawal",
  "date": "2026-11-03",
  "time": "10:15",
  "fromAcct": "acc_opay",
  "toAcct": "acc_personal_bank",
  "ownerPlanId": "ownerPlan:2026-11:k3f9a1",
  "idemKey": "wd-1203-1730628900000",
  "state": "Manual"
}
```

- Recorded only after the owner confirms the money has moved; KoboFlow executes no bank transfer.
- Source: confirmed Business, or a Shared account with explicit pharmacy treatment. Destination:
  confirmed Personal (incl. Personal Cash), or none (outside, flagged). Personal → Personal is refused
  as a withdrawal (it is a personal transfer).
- Plan link defaults to the approved plan of the entry's month; removable ("unplanned").

### 11.2 Safety check and override (D10)

The form compares the amount with the Pharmacy Director's safe amount (section 12.3).
- Within it: "Safe: ₦A of ₦S after obligations and the floor."
- Above it: shortfall and reasons; options: withdraw the safe part, revise the plan, or **override**
  with a reason and explicit confirmation, stored immutably:

```json
"safetyCheck": {
  "at": "2026-11-03T10:14:52Z",
  "proposed": 300000,
  "safe": 120000,
  "shortfall": 180000,
  "reasons": ["Supplier bill ₦150,000 due 2026-11-10", "Loan instalment ₦50,000 due 2026-11-15", "Working-capital floor ₦150,000"],
  "qualified": true,
  "warnings": ["No supplier or stock data from PBSRx is included", "Unclassified obligations ₦80,000 counted conservatively"],
  "overrideReason": "School fees due",
  "confirmedByOwner": true
}
```

An override never changes the calculation; a qualified calculation is never presented as safe.

### 11.3 Integrity cases

| Case | Behaviour |
|---|---|
| Several withdrawals in a month | each linked; `withdrawn` derived (10.1), including linked direct personal spending from pharmacy accounts |
| Partial | partially withdrawn, remaining shown |
| No plan | allowed, "unplanned withdrawal" |
| Exceeds the plan | allowed; `overPlan` shown |
| Exceeds the safe amount | override flow |
| Correction | Edit, same id, `edits[]`; an amount increase re-runs the check and needs a new snapshot if above the safe amount (the old one stays in `edits[]`) |
| Reversal | extend the existing `voided` reversal to owner withdrawals; original kept; stops counting in balances and the plan |
| Duplicate on save | `idemKey` per save attempt (pattern of `paymentOps`); `possible_duplicates`; specific warning for same date and amount in one plan; never merged |
| Month-end closure | section 10.2 |
| Backup and restore | sections 15–16 |
| Offline | local ids; no network step |

### 11.4 Example 2 — partial withdrawal (non-negotiable)

₦100,000 from Opay to the personal bank, linked to November's ₦300,000 plan.

| Figure | Before | After |
|---|---|---|
| Pharmacy Opay | ₦500,000 | ₦400,000 |
| Personal bank | ₦40,000 | ₦140,000 |
| Actual withdrawn this month | ₦0 | ₦100,000 |
| Remaining planned | ₦300,000 | ₦200,000 |
| Pharmacy operating expenses | ₦85,000 | ₦85,000 |
| Pharmacy sales / recorded receipts | unchanged | unchanged |
| Confirmed pharmacy cash | ₦500,000 | ₦400,000 |
| Consolidated net worth | ₦640,000* | ₦640,000 |

*Test Bank ₦100,000, no liabilities: ₦500,000 + ₦100,000 + ₦40,000.

**Example 11.** Plan ₦300,000; withdrawals ₦100,000, ₦150,000, ₦80,000 → withdrawn ₦330,000,
remaining ₦0, over plan ₦30,000 (flagged).

**Example 12 — owner contribution.** ₦50,000 personal bank → Opay: personal bank −₦50,000, Opay
+₦50,000, `owner_contribution`, not sales, net worth unchanged.

---

## 12. Obligations and the two Money Directors (D5, D8, D10, D14, Q2, P2) [Design]

### 12.1 Obligation purpose and routing

- Bills and agreements gain optional `purpose` (`pharmacy` / `personal` / `shared` + `split` /
  `unclassified`). Existing ones are unclassified until reviewed; new ones require a purpose (D8).
- A single routing function partitions each obligation occurrence's **remaining** amount, exactly
  like `scopeOf`: `{pharmacy, personal, unclassified}` summing to the remaining amount.

| Obligation | Pharmacy Director | Personal Director |
|---|---|---|
| Pharmacy | counted | — |
| Personal | — | counted |
| Shared with a valid split | pharmacy part | personal part |
| **Unclassified, or Shared without a valid split** | **counted in full** against the safe amount, listed as "unclassified obligations (counted conservatively)"; Director qualified | listed in its review area only |

### 12.2 Q2: the conservative safe amount, counted once

**safe amount** = free-to-use confirmed pharmacy cash − uncovered (pharmacy part + unclassified part)
of obligations due within 30 days (overdue included) − working-capital floor, never below 0.

- **Counted once:** each occurrence contributes its routing partition; reclassifying it changes
  which part is non-zero, never adds a second copy. Nothing is stored: the safe amount is recomputed
  from current purposes every time, so a reclassification cannot leave a stale double count.
- **Coverage:** linked earmarks reduce an obligation's uncovered amount once, as today, whatever its
  purpose.
- **Window:** the same 30-day window and overdue rule as today; unclassified obligations due later
  appear in the review area and the forecast, not in the safe amount (exactly as pharmacy ones).
- **Staleness and qualification:** the Director is qualified while any unclassified obligation exists,
  alongside the existing reasons (no floor; high-severity data quality, which includes missing
  accounts and unresolved inflows). There is no separate "stale data" timer today; stale reservations
  remain an action. Unclassified obligations never make the Director look less qualified.
- **Cash forecast:** pharmacy forecast includes pharmacy parts and unclassified amounts (labelled);
  personal forecast includes personal parts.

**Example 17 — Q2 (owner example).** Confirmed free pharmacy cash ₦850,000; confirmed pharmacy
obligations due in 30 days ₦150,000; unclassified obligations ₦80,000; floor ₦500,000.
- Safe = ₦850,000 − ₦150,000 − ₦80,000 − ₦500,000 = **₦120,000**. (Omitting the unclassified ₦80,000
  would wrongly show ₦200,000.)
- Reviewed as **Personal**: pharmacy safe = ₦850,000 − ₦150,000 − ₦500,000 = ₦200,000; the Personal
  Director gains an ₦80,000 commitment. Counted once.
- Reviewed as **Shared** pharmacy ₦50,000 / personal ₦30,000: pharmacy safe = ₦850,000 − ₦150,000 −
  ₦50,000 − ₦500,000 = ₦150,000; personal commitment ₦30,000.

### 12.3 Pharmacy Money Director

- Confirmed pharmacy cash (held unresolved inflows shown); earmarks and reservations.
- Obligations due in 30 days per 12.1–12.2, unclassified listed separately.
- Stock and supplier obligations: KoboFlow bills until a validated PBSRx feed (stage 8); while none,
  "supplier and stock obligations from PBSRx are not included" and **qualified**.
- Working-capital floor (U4/U4a).
- Pharmacy opex, unresolved spending (pharmacy accounts) panel, pharmacy runway (section 6).
- **Safe amount for owner withdrawal** (12.2).
- **Owner plan panel (D5):** approved, withdrawn, remaining planned, labelled "planned commitment, not
  deducted"; never deducted, never an expense or obligation.
- Safety comparison: remaining planned vs safe amount, with any shortfall.
- D14: the Owner bucket figure, if live, shown for reference only; only the plan and actual
  withdrawals are used.

### 12.4 Personal Money Director

- This month's plan (approved, withdrawn, remaining planned — a plan is not money).
- Withdrawals received.
- Confirmed Personal balances (incl. Personal Cash), restricted savings and investments separately;
  the personal portion of confirmed Shared accounts when certain.
- Personal spending by D7 category; personal budgets.
- Savings and investments moved this month.
- Household commitments due in 30 days (personal and personal parts of shared obligations, personal
  loan instalments).
- **Remaining personal money** = available confirmed personal balances − personal commitments due in
  30 days; a negative result is a **personal shortfall**, with a note that the remaining plan helps
  only if actually withdrawn and safe for the pharmacy.
- Review area: unclassified expenses and obligations, unconfirmed Personal accounts or openings.

### 12.5 Example 5 — unsafe withdrawal (non-negotiable)

Planned ₦300,000. Confirmed pharmacy free cash ₦470,000; uncovered obligations due in 30 days
₦200,000 (supplier bill ₦150,000, loan instalment ₦50,000); floor ₦150,000.
- Free after obligations = ₦470,000 − ₦200,000 = ₦270,000.
- Safe = ₦270,000 − ₦150,000 = **₦120,000**.
- Shortfall = ₦300,000 − ₦120,000 = **₦180,000**.

The Director reports the shortfall and reasons; no withdrawal is created; the plan stays a plan;
personal cash is unchanged. A later ₦300,000 withdrawal with an override stores the 11.2 snapshot and
moves money only then.

---

## 13. Personal expenses, categories, transfers, loans and vehicles (D6, D7, P8) [Design]

### 13.1 Categories (D7)

- Controlled, editable list in `ledgerSetup.personalCategories` (with setup history). Initial:
  Household; Food and groceries; Utilities; Education; Healthcare; Transport; Housing; Clothing and
  personal care; Family support; Communication; Subscriptions; Recreation and travel; Debt servicing;
  Other.
- Entries keep the category **name as recorded**; renaming or retiring a list item never rewrites
  entries; retired names stay readable.
- Savings and investments are not categories (they are internal movements).

### 13.2 Rules

| Entry | Type | Scope | Effect |
|---|---|---|---|
| Household groceries from the personal bank | expense | personal | personal bank −; personal expense + |
| Personal transport and fuel | expense | per 5.2 (vehicle default, payer) | never pharmacy opex |
| Personal savings | transfer | personal_internal | no expense; net worth unchanged |
| Personal investment | investment | personal_internal | no expense; asset stays (restricted) |
| Personal loan repayment | loan_repayment, personal-purpose agreement | personal | principal reduces liability; interest and fees personal expense (Debt servicing); H5 unchanged |
| Household bill | bill, purpose Personal | personal | Personal Director commitment |

### 13.3 Vehicles (D6, Q4, P8)

- Vehicles stay a hard-coded constant; their purposes are stored in
  `ledgerSetup.vehiclePurposes: {vehicleId: 'pharmacy'|'personal'|'shared'|'unclassified'}` with setup
  history. No new store, no invented vehicle records.
- A vehicle purpose is a default only when it does not conflict with the payer's confirmed ownership
  (5.2.4, Q4). A transaction-level purpose overrides and is recorded; a resolved conflict stays
  flagged. No shared-use percentages are invented.

### 13.4 Examples 3, 4 and 13 (non-negotiable 3 and 4)

**Example 3 — ₦15,000 groceries from the personal bank (after Example 2).**

| Figure | Before | After |
|---|---|---|
| Personal bank | ₦140,000 | ₦125,000 |
| Personal expenses (month) | ₦20,000 | ₦35,000 |
| Pharmacy operating expenses | ₦85,000 | ₦85,000 |
| Pharmacy runway, confirmed pharmacy cash | unchanged | unchanged |

**Example 4 — ₦50,000 personal bank → personal savings.**

| Figure | Before | After |
|---|---|---|
| Personal bank | ₦125,000 | ₦75,000 |
| Personal savings | ₦0 | ₦50,000 |
| Expenses | unchanged | unchanged |
| Net worth | unchanged | unchanged |

**Example 13 — personal car loan instalment ₦45,000** (principal ₦40,000, interest ₦5,000) from the
personal bank: bank −₦45,000; personal liability −₦40,000; personal expense (Debt servicing)
+₦5,000; pharmacy unchanged.

---

## 14. Historical reconciliation (Part 4) [Design]

### 14.1 Safeguards

No automatic reclassification; stable ids; every change previewed, explicitly confirmed, saved through
the existing Edit path with `edits[]`, and reversible the same way; no invented balances or sources;
no inferred ownership; each naira counted once; unresolved items stay visible until resolved.

### 14.2 Groups

| Group | Today | Example |
|---|---|---|
| A. Expenses with an empty source | `fromAcct: ''`, Needs Review, unclassified, no balance effect | Breakfast ₦2,000, Breakfast ₦500, Shaving stick ₦500, Window Repair ₦1,500 (₦4,500) |
| B. Expenses with legacy `pers_cash` | follow the mapping | fuel kia black ₦3,000 |
| C. Purpose differs from the payer | counted by type | household item paid from Opay |
| D. Business↔Personal `transfer` | "internal" | Opay → personal bank recorded as transfer |
| E. Bills and loans without purpose | all pharmacy today; unclassified (counted conservatively) after the change | every existing bill and agreement |
| F. Vehicle conflicts | — | personal-vehicle fuel paid from Opay |
| G. Entries the owner cannot place | — | anything not recalled |

### 14.3 Workflow

1. **List** from `scopeOf` and the obligation router: every unclassified entry and obligation, every
   cross-boundary flow, every Business↔Personal `transfer`, every vehicle conflict.
2. **Owner chooses** per entry or a selected group: purpose (Pharmacy / Personal / Shared + split);
   for A and B the source — a confirmed account (only if the entry is on/after that account's
   effective opening date), **Outside**, or leave unresolved; for D a type change; for E the
   obligation purpose; or "I don't know" (stays unclassified).
3. **Preview** from the same engine: per entry and in total — pharmacy opex, unresolved spending,
   personal expenses, owner withdrawals per month and per plan, pharmacy burn and runway, each balance,
   confirmed pharmacy cash, the safe amount, net worth.
4. **Confirm:** each change saved as its own edit (same id, `edits[]`).
5. **Rollback:** any edit can be reversed by editing back, itself recorded.

### 14.4 Example 10 — the four group-A entries (owner-confirmed personal, paid from personal cash)

- Personal Cash did not exist as a tracked account on 20–21 October, and inventing its balance then is
  not allowed. The correct record is **source Outside, purpose Personal**, stored as `fromAcct:
  '__outside'`, `purpose: 'personal'`.
- Effect: no balance changes (they move none today); pharmacy opex −₦4,500 (they leave pharmacy
  reports); personal expenses +₦4,500; pharmacy burn unchanged (they never left a pharmacy account);
  Needs Review cleared by the owner's edit; `edits[]` records from/to values.
- If a Personal Cash account is later opened (Example 16), its confirmed opening already reflects
  whatever cash remained; these entries stay Outside and are never deducted from it.
- Window Repair is decided on its own; the parser's "Business Overhead" category is not evidence.

### 14.5 Group B — fuel kia black ₦3,000

Either map Personal Cash (the legacy quick-capture id) to Outside and state purpose Personal
(balances unchanged), or, if it was pharmacy fuel, edit its source to the pharmacy account that paid
(that account −₦3,000, previewed).

---

## 15. Backup format compatibility (Q3, P6) [Design]

### 15.1 What exists and why a version number alone is not enough

- `planImport` has **no upper version check** and refuses a file only when `transactions` is missing.
  Builds up to `03d8dee` (and the TEST site) would therefore **accept** a new-format backup and
  restore it with the wrong meaning (purposes, splits, opening dates and outside sides ignored).
  Production `main` (`2f4ab03`) would replace its transaction list with the file's without asking.
- **Already-deployed builds cannot be taught to refuse a format they do not know.** With the
  `transactions` collection kept in its normal structure (Q3), no field added to the file can make
  those builds refuse it. This is a real limitation, not solvable by a version bump.

### 15.2 Smallest safe design

1. **Explicit format block** in every export (the `transactions` collection unchanged):

   ```json
   { "app": "KoboFlow", "version": "4.0",
     "format": { "name": "koboflow-backup", "version": 2, "minReader": 2,
                 "features": ["purpose", "split", "ownerPlan", "openingDate", "outsideSide"] },
     "transactions": [ ... ], "ledgerSetup": { ... }, "ownerPlans": [ ... ], "bills": [ ... ] }
   ```

   A file without `format` is format **1** (all existing backups).
2. **Reader guard, first step of `planImport`:** `SUPPORTED_FORMAT` constant in the build. If
   `format.minReader > SUPPORTED_FORMAT` → throw "This backup was made by a newer KoboFlow and needs a
   newer version to restore. Nothing was changed." Because `planImport` writes nothing and the commit
   is atomic, refusal leaves stored data untouched.
3. **Whole-backup validation before restoring:** for format ≥ 2, validate every record's new fields
   (split reconciliation in kobo, purpose values, `ownerPlan` schema and uniqueness, `ownerPlanId`
   references, `openingDate` rules). Any structural error refuses the **whole file** (not a per-record
   skip); legacy per-record rejects keep their current behaviour for format-1 files.
4. **Older backups:** format 1 is accepted as today; entries get no purposes and are classified by the
   normal rules; nothing is invented.
5. **Future versions:** each format increment states its `minReader`. A reader accepts every version
   whose `minReader` ≤ its `SUPPORTED_FORMAT`; additive, ignorable changes keep `minReader` low;
   changes in financial meaning raise it. No downgrade export.
6. **No database version change** is needed for any of this.

### 15.3 R2: the site-by-site guard and write gate [Owner-approved R2, Design]

**R2 (owner-approved, subject to site-by-site requirements).** No site may create new-format backups
until **that site** has a deployed and verified compatible reader guard. This applies independently to
TEST, production and any other deployed KoboFlow site or build that may create or restore backups. A
successful TEST deployment never establishes production compatibility.

**The write gate covers data, not only backups (readiness finding F2, section 24).** A site that
writes new financial fields (purposes, splits, opening dates, `'__outside'` sides, plan links) but
exports them as a format-1 backup would hand those fields to an older build that misreads them. So the
gate is a single per-site switch, `NEW_FINANCIAL_FORMAT`, that controls **both**:
- writing any new financial field (stages 3–7 features stay hidden or read-only while it is off); and
- writing format-2 backups.

While it is off, the site behaves as today for stored data and exports format 1. It can only be
switched on in a build whose reader guard (`SUPPORTED_FORMAT ≥ 2`) is present. The switch is a
build-time setting per site (the TEST build script and the production build each set their own;
nothing a user does on one site changes the other). It is never switched off again once data has
been written in the new format on that site (a build with it off would hide that data).

**Invariant:** a build only writes formats it can read (`write format ≤ SUPPORTED_FORMAT`), and backup
creation and restoration use the same format rules.

### 15.4 Site-by-site deployment sequence [Design — to be followed at implementation; nothing deployed now]

| Step | Action | Evidence required before the next step |
|---|---|---|
| 1 | Implement and test the reader guard (stage 0) with `NEW_FINANCIAL_FORMAT` off in every build | Stage 0 matrix (15.5) passes on both builds; full suite; build check |
| 2 | Deploy the guard to **TEST** (separately authorised), still with the switch off | Pages run succeeded; `SOURCE.json` source commit recorded |
| 3 | Verify on the **deployed TEST build** that it refuses unsupported backups and accepts supported ones | Matrix rows 1–3, 5–10 and 14 run against the deployed TEST site on a disposable profile, with recorded results |
| 4 | Keep new-format writing disabled on TEST until step 3 is complete and accepted | Owner review of the step-3 evidence |
| 5 | **Separately authorise** and deploy the guard to **production**, switch off | Production deployment evidence |
| 6 | Verify production compatibility **independently** (same checks as step 3, on production) | Production verification record; TEST results are not accepted as evidence |
| 7 | Only then enable `NEW_FINANCIAL_FORMAT` on a site, by its own authorised build | Per-site enablement record |

- **Every future site or build** (another TEST origin, a new device build, a fork) must satisfy steps 3
  and 6 for itself before creating new-format backups or writing new financial fields.
- **Residual risk:** a device still running a build without the guard (up to `03d8dee`, or production
  `main` `2f4ab03`) can accept a format-2 file moved to it manually. Mitigations: guard-first order;
  file names that state the format (`koboflow-backup-v2-…json`); the export screen states the minimum
  build; never deploy an older build over a newer one. This residual risk is accepted under R2.

### 15.5 Stage 0 acceptance-test matrix [Design]

**Evidence of "no partial write"** (used in every row): before the operation, a full snapshot of every
object store (`transactions`, `agreements`, `instalments`, `allocations`, `agreementEvents`,
`opportunities`, `bills`, `meta`) is serialised; after it, the snapshot is taken again and compared
**byte for byte**, together with record counts per store. For accepted imports the comparison is
"before + exactly the planned records". The tests run on a disposable browser profile with fictional
data, on both the TEST build and the production candidate, using the existing write-failure and hold
switches pattern (`__fail.write`, `__hold`, `__holdFail` in the current tests).

| # | Input backup condition | Expected result | Accept / refuse | Data state after | Evidence of no partial write |
|---|---|---|---|---|---|
| 1 | **Older valid backup** (v2 `version: '2.0'`, and v3 `version: '3.x'`) | Restored as today (v2: ids reassigned; v3: ids kept); per-record rejects counted as today | Accept | Before + planned records only | Snapshot diff equals the plan's op list |
| 2 | **Current-format valid backup** (`version: '4.0'`, no `format` block = format 1) | Restored exactly as `03d8dee` restores it | Accept | Before + planned records | Snapshot diff equals the plan; the same fixture restored on `03d8dee` gives the identical result |
| 3 | **New-format backup, compatible reader** (`format.version 2`, `minReader 2`; reader `SUPPORTED_FORMAT 2`) | Whole-file validation passes; restored with new fields intact | Accept | Before + planned records, new fields byte-identical to the file | Snapshot diff equals the plan |
| 4 | **New-format backup, older reader** — (a) a guard build with `SUPPORTED_FORMAT 1`; (b) `03d8dee` | (a) refused: "This backup was made by a newer KoboFlow…Nothing was changed."; (b) **documented limitation**: accepted by `03d8dee` (test asserts and records this, so the risk stays visible) | (a) Refuse; (b) accepted (limitation) | (a) Unchanged | (a) Byte-identical snapshot; refusal occurs in `planImport` before any `commit` call (spy shows `commit` not called) |
| 5 | **Unsupported future version** (`format.version 9`, `minReader 9`) | Refused with the newer-version message | Refuse | Unchanged | Byte-identical snapshot; `commit` not called |
| 5b | Future version that is **additive** (`format.version 3`, `minReader 2`) on a `SUPPORTED_FORMAT 2` reader | Accepted; unknown additive fields kept as stored | Accept | Before + planned records | Snapshot diff equals the plan |
| 6 | **Missing format metadata** (no `format` key) | Treated as format 1 (rows 1–2 rules) | Accept | As rows 1–2 | As rows 1–2 |
| 7 | **Malformed format metadata** (`format` not an object; `version`/`minReader` not positive integers; `minReader > version`; unknown `name`) | Refused: "The backup's format information is damaged. Nothing was changed." | Refuse | Unchanged | Byte-identical snapshot; `commit` not called |
| 8 | **Missing transactions collection** (no `transactions` key) | Refused with the existing message "This is not a KoboFlow backup (no transactions list)." | Refuse | Unchanged | Byte-identical snapshot |
| 9 | **Invalid transactions collection** — (a) not an array; (b) format 2 with any structurally invalid record (bad split, unknown purpose, broken `ownerPlanId`); (c) format 1 with some invalid records | (a) refused (existing); (b) whole file refused, listing the first problems; (c) **unchanged existing behaviour**: invalid records counted as rejected, valid ones planned, owner confirms | (a) Refuse; (b) Refuse; (c) Accept with rejects | (a)(b) Unchanged; (c) before + valid planned records | (a)(b) byte-identical snapshot; (c) diff equals the plan; existing validation not weakened |
| 10 | **Truncated or corrupted file** (cut mid-JSON; random bytes; empty file) | "Import failed: … Nothing was changed." (JSON parse failure, existing path) | Refuse | Unchanged | Byte-identical snapshot |
| 11 | **Failed import** (valid file; the database write fails, simulated with `__fail.write`) | Existing failure message; nothing saved | Refuse (by failure) | Unchanged | Byte-identical snapshot: the single atomic transaction aborted |
| 12 | **Interrupted import** (valid file; the transaction is aborted mid-way with `__holdFail`, and separately the page is closed before completion) | Nothing saved; on reload the data are as before; the import can be repeated | Refuse (by interruption) | Unchanged | Byte-identical snapshot after reload; no store contains any record from the file |
| 13 | **Repeated import** of the same valid file | Second run adds nothing ("Nothing new to import", existing signature and id checks) | Accept (no-op) | Same as after the first import | Snapshot after run 2 = snapshot after run 1 |
| 14 | **Refusal leaves data unchanged** — every refusal row above, plus the owner cancelling at the confirmation prompt | No change | Refuse / cancel | Unchanged | Byte-identical snapshot for each row |
| 15 | **Successful import is all-or-nothing** — a large valid file, with a forced failure on its last record | Either all planned records are present or none | — | All or none | Count per store equals before or before + plan, never in between; checked for the forced-failure run (none) and the clean run (all) |
| 16 | **TEST and production enable writing independently** | TEST build with `NEW_FINANCIAL_FORMAT` on exports format 2; the production candidate built from the same commit with the switch off exports format 1 and writes no new fields; switching TEST does not change the production build output | — | Per build | Export files compared; production candidate's `index`/`koboflow.html` byte-identical whatever the TEST setting |

Additional checks in the same stage: a build never writes a format above its `SUPPORTED_FORMAT`; the
reader guard runs before any other import logic; the existing import tests (`save-export`,
`stage1-ownership-and-liability` restore tests, `e2e` restore, `bills` and `transaction-edit` import
tests) pass unchanged.

## 16. Offline-first, storage and integrity (D11) [Design]

- **No database version change** for any stage: optional fields on existing records (`purpose`,
  `split`, `ownerPlanId`, `safetyCheck`, `idemKey` on withdrawals, `'__outside'` sides), account fields
  in `ledgerSetup` (`openingDate`, opening confirmation), setup lists (`personalCategories`,
  `vehiclePurposes`), and `ownerPlan` records in `meta`.
- **Plans in `meta`:** keyed by stable id; `kind` and `schemaVersion` checked on read; an unknown newer
  `schemaVersion` is read-only with a warning, never rewritten.
- **Integrity checks** (data quality, never auto-repaired): broken `ownerPlanId`; two non-cancelled
  plans in one period; non-reconciling splits; Shared portion uncertainty; unconfirmed openings;
  entries before an account's opening date that name it.
- **Restore integrity:** plans not present are added; conflicting plans reported, never overwritten
  (as `ledgerSetup`); transaction ids and `ownerPlanId` links kept (v3+ rule); the whole file is
  validated first; one atomic write; restored openings are marked "awaiting reconfirmation" with
  their history preserved (R3), and restored ownership confirmations moved to history and marked
  awaiting (R4), all in the same atomic write (section 7.5).
- **Offline:** ids generated locally; no network step; the concurrent-change guard stays.
- **Audit:** plan `history`; entry `edits[]` (including purpose conflicts and resolutions);
  `safetyCheck`; setup history for openings, categories and vehicle purposes.

---

## 17. Consolidated Net Worth [Design]

- Each account counted once at its recorded balance; subtotals Pharmacy, Personal (incl. Personal
  Cash), Shared (running pharmacy portion and personal portion shown inside it), Unconfirmed — adding
  to the total.
- Restricted accounts stay in net worth, out of available cash.
- Internal movements net to zero: pharmacy internal, personal internal, owner withdrawal into a
  tracked personal account, owner contribution from a tracked personal account, investment into a
  tracked account.
- Movements to or from outside change tracked net worth and are labelled.
- Liabilities by obligation purpose (pharmacy, personal, shared by split, unclassified); H5 unchanged.
- Plans and Owner bucket targets never appear in net worth.

**Examples 1–4 in net worth** (Opay ₦500,000, Test Bank ₦100,000, personal bank ₦40,000, no
liabilities):

| After | Pharmacy | Personal | Total |
|---|---|---|---|
| Start | ₦600,000 | ₦40,000 | ₦640,000 |
| Example 1 (plan) | ₦600,000 | ₦40,000 | ₦640,000 |
| Example 2 (withdrawal ₦100,000) | ₦500,000 | ₦140,000 | ₦640,000 |
| Example 3 (groceries ₦15,000) | ₦500,000 | ₦125,000 | ₦625,000 |
| Example 4 (savings ₦50,000) | ₦500,000 | ₦125,000 | ₦625,000 |

---

## 18. Acceptance criteria [Design]

Each is testable with fictional data on both builds (TEST and production candidate).

1. **Account opening dates:** an account with `openingDate` 1 Nov moves only with entries dated on or
   after 1 Nov; accounts without one behave exactly as today (balances byte-identical on an existing
   fixture); `mappingImpact`, `unreconciledInflows`, `movementReview` and the baseline checks agree
   with the balances.
2. **Opening confirmation (R1):** an existing opening saved through the setup review is confirmed
   (`setup_review`) with no prompt and no balance change; a new account's opening is unconfirmed until
   its setup review is completed; a changed opening or opening date is unconfirmed until reviewed;
   while unconfirmed the account is excluded from its position's available figures and flagged; the
   setup history holds old and new values and time.
3. **No double deduction (Example 16):** Personal Cash opened ₦12,000 on 1 Nov; the 20–21 Oct entries
   cannot be assigned to it; after +₦30,000 and −₦2,000 its balance is ₦40,000.
4. **Personal confirmation (D1):** a confirmed Personal account counts in Personal Money and net worth
   and contributes ₦0 to pharmacy cash; an unconfirmed one contributes ₦0 to both available figures.
5. **Personal expense not pharmacy opex:** Example 3 — pharmacy opex stays ₦85,000.
6. **Personal expense not in pharmacy runway:** Example 3 leaves pharmacy burn and runway unchanged.
7. **Pharmacy outflow reduces pharmacy cash even when unclassified (Example 15):** Opay ₦400,000 →
   ₦380,000; confirmed pharmacy cash −₦20,000.
8. **Unclassified spending visible, not opex (Example 15):** opex unchanged; unresolved spending
   ₦20,000 in the panel; burn +₦20,000; no second deduction anywhere.
9. **Unclassified obligations conservative (Example 17):** safe ₦120,000; reviewed Personal → ₦200,000;
   reviewed Shared 50,000/30,000 → ₦150,000; each obligation counted once.
10. **Running Shared portion (Example 9):** portion ₦100,000 → ₦88,000; an unclassified movement on the
    account makes it count ₦0 and flagged.
11. **Shared splits in exact kobo:** a percentage split of ₦20,000.01 at 60/40 stores amounts summing to
    ₦20,000.01; ₦12,000 + ₦7,000 for ₦20,000 is refused.
12. **Vehicle conflict (Example B):** ₦15,000 personal-vehicle fuel from Opay is unclassified, in burn,
    not opex; after the owner states Personal, `edits[]` records the conflict and resolution and the
    `default_conflict_resolved` flag remains.
13. **Personal Cash (Example 6):** ₦30,000 in, ₦2,000 out → ₦28,000; pharmacy unaffected.
14. **Outside (Example C):** no balance moves; never available; an Outside inflow to a pharmacy account
    previews its effect and is audited.
15. **Plan lifecycle (Examples 1, 14):** draft → approve → close; nothing moves money; only
    draft/approved/cancelled and `closedAt` stored; withdrawn and remaining derived; ₦50,000
    unwithdrawn stays in the pharmacy.
16. **Multiple partial withdrawals:** Example 2 then ₦150,000 → withdrawn ₦250,000, remaining ₦50,000;
    Example 11 over plan ₦30,000 flagged; a linked ₦8,000 personal gas refill paid from Opay (Example A)
    adds ₦8,000 to the plan's withdrawn amount.
17. **Business→Personal (D13):** a stored `transfer` Opay → personal bank is scoped as an owner
    withdrawal, not opex, not personal income, listed with a type suggestion; Add Entry saves a new one
    as `owner_withdrawal`.
18. **Personal→Business (Example 12):** owner contribution, not sales, net worth unchanged.
19. **Internal transfers:** Business→Business and Personal→Personal (Example 4) create no expense; net
    worth unchanged.
20. **Safety warning and override (Example 5):** shortfall ₦180,000; nothing executed; an override
    stores the full `safetyCheck`; a qualified calculation is never shown as safe.
21. **Obligation routing (D8):** personal obligations only in the Personal Director, pharmacy only in
    the Pharmacy Director, shared by split, unclassified counted conservatively and listed; new bills
    and loans require a purpose.
22. **Both Directors:** figures of 12.3 and 12.4 for a fixture combining Examples 1–5, 9, 15 and 17;
    the plan panel never changes cash or the safe amount.
23. **Net Worth:** section 17 table; subtotals add to the total; outside movements labelled.
24. **Loans (Example 13):** principal reduces liability; interest is an expense; H5 rule unchanged.
25. **Backup format:** exports carry `format {version, minReader, features}` and the normal
    `transactions` collection; format-1 backups restore as today; the full Stage 0 matrix (15.5) passes
    on both builds.
26. **Older-build refusal:** a guard build refuses a file with `minReader` above its
    `SUPPORTED_FORMAT` with the stated message and **no stored record changes** (matrix rows 4a, 5);
    the known limitation (builds without the guard) is demonstrated on `03d8dee` in a scratch copy
    (row 4b), so the risk stays visible.
27. **Offline:** every flow works with the network disabled; save and reload agree.
28. **Audit history:** every purpose, source, split, type, opening, category, vehicle-purpose and plan
    change has an `edits[]` or history entry with before/after values and time; reversals keep the
    original.
29. **Duplicate prevention:** a double tap saves one withdrawal (`idemKey`); same-day same-amount
    withdrawals in one plan flagged, never merged; re-importing the same backup adds nothing.
30. **Restore integrity:** a format-2 file with one invalid split is refused whole, with no stored
    change; a valid file restores plans and links exactly; conflicting plans are reported, not
    overwritten; interrupted and failed imports leave a byte-identical snapshot (matrix rows 11, 12, 15).
31. **Site-by-site gate (R2):** with `NEW_FINANCIAL_FORMAT` off, a build writes no new financial field
    and exports format 1; enabling it on the TEST build does not change the production candidate
    (matrix row 16); no build writes a format above its `SUPPORTED_FORMAT`.
32. **Restore of a confirmed opening (R3, Example 18):** after restore, `opening` and `openingDate` are
    byte-identical to the backup; `openingConfirmationState` is `restored_awaiting`; the source
    confirmation is in `openingConfirmationHistory` with `origin: 'source_installation'`; the account
    contributes ₦0 to confirmed pharmacy cash or Personal Money and stays in Net Worth (Unconfirmed);
    its recorded balance equals the source device's.
33. **Restore of an unconfirmed opening (R3):** an opening that was unconfirmed (or awaiting) in the
    backup is restored awaiting, with its history; it is never shown as confirmed; a format-1 backup's
    accounts are restored awaiting with the "saved before opening confirmation existed" note — none is
    recognised as `setup_review` (F5).
34. **Reconfirmation (R3):** the owner's explicit confirmation records `openingConfirmedSource:
    'explicit'`, clears the marker, appends "confirmed on this installation" to the history and the
    setup history, and restores the account's available figures; no transaction changes; the interface
    shows the three states in section 7.5.
35. **Opening and ownership stay distinct (R3, H-1):** reconfirming only the opening leaves a restored
    Business account at ₦0 until "Used For" is also reconfirmed, and the reverse; each confirmation is
    recorded separately.
36. **Re-export before reconfirmation (R3):** exporting and restoring again keeps every opening awaiting,
    with the full history; nothing is upgraded to confirmed.
37. **Restore with confirmed ownership (R4):** a backup whose accounts have current ownership
    confirmations restores with `use` byte-identical, `useConfirmedValue`/`useConfirmedAt` `null`,
    `ownershipConfirmationState: 'restored_awaiting'`, and the source confirmation in
    `ownershipConfirmationHistory` with `origin: 'source_installation'`, `currentAtSource: true`; for
    Pharmacy, Personal and Shared accounts.
38. **Restore with unconfirmed ownership (R4):** an account whose ownership was unconfirmed or stale in
    the backup restores awaiting, its history entry has `currentAtSource: false`; an account with no
    `use` restores as not chosen (`''`), with nothing inferred from its label, kind or entries.
39. **Historical ownership confirmation preserved (R4):** no previous confirmation value or time is lost
    after restore, re-export or a second restore; the history only grows.
40. **Ownership reconfirmation required (R4):** after restore, no account contributes to confirmed
    pharmacy cash or Personal Money until its ownership is confirmed on this installation (the existing
    `ownershipConfirmed` check), with the existing restore note shown.
41. **New ownership confirmation recorded (R4):** saving "Used For" in the setup review sets
    `useConfirmedValue`/`useConfirmedAt`, clears the marker, appends "confirmed on this installation" to
    `ownershipConfirmationHistory` and an entry to the setup history; the interface shows the three
    states.
42. **Independent confirmations (R3, R4):** with ownership confirmed and opening awaiting, and with
    opening confirmed and ownership awaiting, the account contributes ₦0 in both cases; only both
    current gives its full contribution (Example 18); each confirmation has its own history entry.
43. **Re-export before ownership reconfirmation (R4):** the exported file carries `null` ownership
    confirmation, the marker and the history; no current confirmation appears in it.
44. **Restore again (R3, R4):** restoring that re-export leaves both confirmations awaiting, adds a
    history entry with `currentAtSource: false`, and never makes either current.
45. **No confirmed cash until all confirmations are current (D1, R3, R4):** across Examples 18 and the
    restore fixtures, confirmed pharmacy cash and Personal Money include an account only when its
    ownership and opening are both current on this installation; recorded balances and Net Worth are
    unchanged throughout; no transaction is modified.
46. **Reports while ownership awaits (F7):** after a restore, every report and both Directors show the
    "classification incomplete" notice with the unclassified amount and are qualified until all
    ownership confirmations are current.
47. **Cross-boundary flows identified (5.4):** Example A appears in the "paid from the other side"
    panel with `purpose_differs_from_payer`, counts as an owner withdrawal (direct) and a personal
    expense, and is not pharmacy opex; a Pharmacy-purpose entry paid from a Personal account counts as
    pharmacy opex and an implicit owner contribution, with pharmacy cash unchanged.

---

## 19. Test strategy [Design]

- **Engine:** `scopeOf` truth table (type × payer status × ownership × confirmation × purpose × split ×
  vehicle default), with the partition invariant; measures table figures; per-account opening
  arithmetic; running Shared portion; obligation router and safe amount; plan derivation; safety
  check; Net Worth subtotals; all numbered examples (1–17, A–C) with exact naira.
- **One-classification consistency:** a single fixture through every report, both Directors, runway
  and Net Worth, asserting identical scope parts per entry.
- **Browser, both builds:** opening dates and confirmation in setup; plan lifecycle with save/reload;
  withdrawals with link, override and reversal; reconciliation preview equals saved result; stored
  entries change only through edits.
- **Backup:** format block; guard refusal with no stored change; whole-file validation; format-1
  restore; old-build limitation demonstrated on `03d8dee` from Git history in a scratch directory.
- **Restore of confirmations (R3, R4):** confirmed, unconfirmed, stale and awaiting ownership and
  opening confirmations in format-1 and format-2 backups, for Pharmacy, Personal and Shared accounts;
  byte-identical `use`, opening fields, dates, Shared declarations and transactions after restore;
  histories preserved and only growing; ₦0 available until both confirmations are current; each
  confirmation given separately; re-export and second restore keep both awaiting; F7 notice
  (criteria 32–46).
- **Existing expectations that will change** (listed and justified at implementation; none weakened
  or removed): runway, cash-flow and budget fixtures with expenses paid from Personal accounts or with
  missing sources; Director fixtures whose bills become unclassified (counted conservatively — the
  safe amount does not rise).
- **Regression:** full suite, repeated focused browser runs, `node scripts/build-test-file.js --check`.

---

## 20. Decision register

### 20.1 D1–D14 [Owner-approved]

| Id | Decision | Rationale | Approval still required? | Dependencies | Implementation implications |
|---|---|---|---|---|---|
| D1 | Personal accounts need explicit confirmation; never in pharmacy cash | Mirrors the Business safeguard | No | Existing confirmation fields; Q1 openings | Personal Money uses ownership and opening confirmation |
| D2 | Pocket cash unclassified until confirmed; distinct sources | Cash does not prove ownership | No | D9 | `'__outside'` side; `outside_needs_purpose` |
| D3 | Approval separate from saving | A plan is a decision | No | D11 | stored draft/approved/cancelled, `approvedAt` |
| D4 | Close at month end; no carry-forward | Unwithdrawn money is not a claim | No | D3 | `closedAt`; late-recorded flag |
| D5 | Remaining plan shown as planned commitment only | Visibility without distortion | No | D3, D14 | panel "not deducted" |
| D6 | Vehicle purpose as a default; audited overrides | Ownership ≠ purpose | No | P8, Q4 | `ledgerSetup.vehiclePurposes` |
| D7 | Controlled personal categories; savings not expenses; principal vs interest | Consistent personal reporting | No | — | `ledgerSetup.personalCategories` |
| D8 | Bills/loans unclassified until reviewed; new need purpose; shared need split | Not every obligation is the pharmacy's | No (Q2 resolved) | Q2 | obligation router |
| D9 | Personal Cash account alongside Outside; no invented balance | Real tracking of pocket cash | No (Q1 resolved) | Q1 | per-account opening |
| D10 | Override above the safe amount, fully recorded | Owner control, warning kept | No | Q2 | `safetyCheck` |
| D11 | Plans in `meta`, derived totals, no "allocation" name | No version change | No (Q3 resolved) | Q3 | `ownerPlan`, `ownerPlanId` |
| D12 | Explicit purpose for Shared payers; exact splits | Ownership ≠ purpose | No | U5a running portion | `split`, section 9 |
| D13 | Classify, do not block, Business↔Personal | Movements must not vanish | No | D1 | movement table |
| D14 | Plans independent of the Owner bucket, linked for visibility | Bucket target held (U13) | No | U13 | `ownerBucketReference` |

### 20.2 Q1–Q5 and R1–R2 [Owner-approved — resolved]

| Id | Resolution | Where |
|---|---|---|
| Q1 | Per-account opening date and confirmed opening; effective date = later of global baseline and account opening; existing accounts unchanged | section 7 |
| Q2 | Unclassified and unsplit obligations count in full against the safe amount, once, until reviewed | section 12.2 |
| Q3 | Versioned format block, reader guard before any write, whole-file validation, transactions unchanged; limitation for builds without the guard documented | section 15 |
| Q4 | Vehicle vs payer conflict → unclassified until explicit purpose; conflict and resolution audited and still flagged | sections 5.2, 13.3 |
| Q5 | Cash layer reduces pharmacy cash; classification stays unclassified; counted in pharmacy burn, not opex; never twice | section 6 |
| R1 | Existing openings saved through the setup review are confirmed (`setup_review`), no re-confirmation, history kept; new accounts confirmed only through their setup review; ownership confirmation unchanged | section 7.2 |
| R2 | Per-site reader guard deployed and verified before that site writes any new financial field or format-2 backup; TEST never stands in for production; Stage 0 matrix | sections 15.3–15.5 |
| R3 | Restored opening confirmations reset to "awaiting reconfirmation"; opening date, amount and confirmation history preserved; explicit reconfirmation recorded; ₦0 in available figures until then; distinct from the ownership reset | section 7.5 |
| R4 | Restored ownership confirmations moved to history (origin: source installation) and marked awaiting; ownership selection preserved, never invented; explicit reconfirmation recorded in account and setup history; existing H-1 financial behaviour unchanged; independent of R3 | section 7.5 |

### 20.3 Remaining owner decisions [Open]

**None.** D1–D14, Q1–Q5 and R1–R4 are decided. No stage depends on an open decision. The final
consistency review (section 24) raised no new financial-policy question; its findings are resolved by
applying already-decided rules.

## 21. Design problems P1–P8: resolution

| # | Problem | Resolution |
|---|---|---|
| P1 | Personal Cash vs one global baseline | **Resolved by Q1** (section 7): per-account effective opening date; confirmed, audited openings; corrections recomputed, never accumulated; pre-opening entries never deducted again; historical group-A entries recorded as Outside, not on Personal Cash |
| P2 | Unclassified obligations could overstate the safe amount | **Resolved by Q2** (section 12.2): counted in full, once, via a partitioning router; recomputed, never stored |
| P3 | Static Shared portion | **Design specified** (section 9.2) per U5a with exact kobo splits, transfer treatment, certainty rule (U5b: uncertain → 0) and no duplicate deduction. **Not implemented today**; until stage 5 the static ceiling remains, and Shared splits are not enabled before the running portion ships |
| P4 | Conflicting defaults | **Resolved by Q4** (sections 5.2, 13.3) |
| P5 | Unclassified spending and the runway | **Resolved by Q5** (section 6): cash layer once, burn rate once, never opex |
| P6 | Older builds | **Resolved by Q3 and R2** (section 15): versioned format, reader guard, site-by-site write gate covering new fields and backups, Stage 0 matrix; the limitation for builds without the guard is stated and accepted under R2 |
| P7 | "allocation" naming | `ownerPlan` / `ownerPlanId` throughout (retained) |
| P8 | Vehicles not stored | `ledgerSetup.vehiclePurposes` (retained); no invented vehicle records |

**Refinements of the master plan** (not edits to it): the per-account opening date (Q1) refines the
single baseline of master plan sections 3–4; the conservative obligation counting (Q2) and the burn
definition (Q5) refine the Director and runway descriptions; the backup format block (Q3) adds to the
backup rules. The master plan should be updated separately if the owner approves this design.

---

## 22. Risks

- Visible figure changes once personal spending and unclassified obligations are separated; the first
  release shows "before / after separation" once.
- Builds without the format guard can still accept a format-2 file moved to them manually (accepted
  under R2; mitigated by the site-by-site sequence, section 15.4).
- Device rollback: an older build opening a database written by a newer one would misread new fields;
  never deploy an older build over a newer one.
- Supplier and stock obligations incomplete until PBSRx data is validated; the safe amount stays
  qualified.
- Many Shared-account entries need splits; until given, portions count 0 and Directors stay qualified.
- Conservative counting (Q2, Q5) can make the pharmacy look tighter than it is until review — intended.
- Quick Capture defaults can still suggest the wrong side; the review list catches disagreements but
  cannot know the truth.

---

## 23. Implementation roadmap [Future]

**Rules for every stage.**
- Each stage is implemented on the feature branch, then tested **as a complete integrated unit** on
  both builds (TEST and production candidate): its unit tests, its integrated acceptance tests, the
  full existing suite, repeated focused runs of its browser tests, and
  `node scripts/build-test-file.js --check`.
- It is reviewed and approved by the owner before the next stage starts. Stages are not combined to
  save time.
- No stage changes the database version.
- No stage is deployed to any site without separate authorisation, and stages 3–7 write new data only
  on a site whose `NEW_FINANCIAL_FORMAT` gate is enabled (section 15.4).
- **Likely affected files** for every stage: `koboflow.html` (engine block and app) and the generated
  `koboflow-test.html`; new or extended files under `tests/`; `scripts/build-test-file.js` only where
  stated; this document and the master plan updated when a stage changes behaviour (separately
  authorised).

### Stage 0 — Backup reader compatibility guard

1. **Scope:** `format` block reading; `SUPPORTED_FORMAT = 2` reader constant; refusal of unsupported
   or malformed formats as the first step of `planImport`; whole-file validation scaffolding for
   format 2; the per-site `NEW_FINANCIAL_FORMAT` switch (default **off** in every build). Export stays
   format 1.
2. **Dependencies:** Q3, R2 (decided). None technical.
3. **Areas:** `planImport`, `importJSON`, the export function, `scripts/build-test-file.js` (per-site
   switch), tests for import/export.
4. **Integrity risks:** rejecting a valid older backup (regression); a guard that runs after some
   planning side effect; the switch leaking between builds.
5. **Unit tests:** format parsing and validation for every malformed case; minReader comparison;
   write-format ≤ read-format invariant.
6. **Integrated acceptance tests:** the full Stage 0 matrix (section 15.5, rows 1–16) on both builds,
   with byte-identical snapshot evidence; criteria 25, 26, 31.
7. **Regression:** all existing import/export, restore and backup tests unchanged — including the
   existing H-1 restore behaviour (ownership confirmations reset, `use` and `sharedPortion` preserved),
   which stage 0 must not alter; full suite.
8. **Completion criteria:** matrix passes; existing tests pass unchanged; both builds export format 1;
   the switch is off in both outputs.
9. **Before stage 1:** owner approval. Before **any** site enables `NEW_FINANCIAL_FORMAT`: section
   15.4 steps 2–7 for that site (deployment and verification are separate authorisations).

### Stage 1 — `scopeOf` engine and central figures

1. **Scope:** pure engine functions `scopeOf`, the obligation router (read-only), and the measures
   table (section 6) as one function returning every figure; a read-only "pharmacy / personal /
   unresolved" summary. No report changes yet; no stored data.
2. **Dependencies:** D1, D2, D6 (defaults only; without stored vehicle purposes no vehicle default
   exists yet), D12 (split arithmetic), D13, Q4, Q5; stage 0 complete.
3. **Areas:** engine block (`classifyTxn` unchanged; `sideStatus`, `ownershipConfirmed` reused); a
   summary card.
4. **Integrity risks:** the partition not summing to the amount; misreading unconfirmed ownership;
   treating outside as a default.
5. **Unit tests:** full truth table (5.2, 5.3), partition invariant in kobo, Examples A–C, 15.
6. **Integrated acceptance tests:** the summary shows identical parts for every entry on both builds;
   nothing else on screen changes.
7. **Regression:** full suite unchanged (no figure changes in this stage).
8. **Completion criteria:** every report figure can be produced from the measures function on a
   fixture, matching the hand-calculated values.
9. **Before stage 2:** owner review of the summary on the TEST fixture.

### Stage 2 — Reports, runway, budgets, personal and unresolved views

1. **Scope:** Analytics, Cash Flow, budgets, Home/Timeline totals, Owner Impact and the runway read the
   measures; pharmacy runway uses pharmacy cash burn (section 6); new personal expense view and
   unresolved-spending panel.
2. **Dependencies:** stage 1; Q5.
3. **Areas:** `cashFlowSummary`, `spendingRunway`, `budgetProgress`, `renderAnalytics`,
   `renderOwnerImpact`, daily totals.
4. **Integrity risks:** a screen bypassing the measures; unresolved pharmacy outflows dropped from the
   burn; withdrawals entering the burn.
5. **Unit tests:** measures for Examples 3, 15, B; runway with and without unresolved outflows.
6. **Integrated acceptance tests:** criteria 5–8; one-classification consistency test across all
   screens.
7. **Regression:** full suite; changed expectations listed and justified (section 19).
8. **Completion criteria:** personal spending absent from every pharmacy figure; unresolved pharmacy
   outflows visible and in the burn; nothing counted twice.
9. **Before stage 3:** owner review of before/after figures on TEST.

### Stage 3 — Purpose capture, Outside source, vehicle purposes, categories, reconciliation

1. **Scope:** `purpose` (and `split` input, inactive for Shared until stage 5) in Add Entry, Edit and
   Quick Capture review; `'__outside'` entry side; `ledgerSetup.vehiclePurposes`;
   `ledgerSetup.personalCategories`; the reconciliation screen with preview (section 14); format-2
   export when the site's switch is on.
2. **Dependencies:** stages 0–2; D2, D6, D7, Q4; **the site's guard verified (15.4) before the switch
   is turned on there**.
3. **Areas:** `EDIT_FIELDS`, `saveEdit`, Add Entry, capture review, `confirmSetup` field list,
   export, data quality.
4. **Integrity risks:** writing new fields with the switch off; reconciliation saving without preview;
   edits not recorded in `edits[]`; legacy defaults treated as evidence.
5. **Unit tests:** purpose validation; Q4 conflict flags; reconciliation preview equals the saved
   result for Examples 10 and B.
6. **Integrated acceptance tests:** criteria 8, 12, 14, 28, 47; group A and B examples; switch-off build
   writes nothing new.
7. **Regression:** full suite; edit and capture tests; stage 0 matrix rerun.
8. **Completion criteria:** every reconciliation is previewed, confirmed, audited and reversible; no
   automatic reclassification.
9. **Before stage 4:** owner review.

### Stage 4 — Account-specific opening dates and Personal Cash

1. **Scope:** `openingDate`, opening confirmation (`openingConfirmedSource`, R1), effective-date
   balance rule in every baseline consumer (7.4), Personal Cash account support, D1 Personal Money
   rule, R3 and R4 restore behaviour (`openingConfirmationState`, `openingConfirmationHistory`,
   `ownershipConfirmationState`, `ownershipConfirmationHistory`, separate reconfirmation of each,
   interface states, F7 notice; section 7.5).
2. **Dependencies:** stage 3; Q1, R1, R3, R4 (all decided). The restore transformation is part of the
   import plan, so the stage 0 guard and matrix are prerequisites; new fields are written only where
   the site's `NEW_FINANCIAL_FORMAT` gate is on.
3. **Areas:** `accountBalances`, `mappingImpact`, `unreconciledInflows`, `movementReview`,
   `incomeFromFindings`, `dataQuality`, setup form, `confirmSetup` field list, `resetRestoredOwnership`
   (or its opening counterpart).
4. **Integrity risks:** double deduction of pre-opening entries; a consumer left on the global
   baseline; existing balances changing; openings inferred; a restored opening recognised as
   `setup_review` (F5); restore erasing opening or ownership values or history; opening and ownership
   confirmation conflated (F6); an ownership selection invented on restore; reports presented as
   complete while ownership awaits (F7); the restore transformation not atomic with the import.
5. **Unit tests:** effective-date arithmetic; Example 16; R1 recognition with no write; corrections in
   7.3; restore transformation for both confirmations (fields preserved, histories moved, markers set)
   for format-1 and format-2 setups, current, stale and missing source confirmations; Example 18.
6. **Integrated acceptance tests:** criteria 1–4, 13, 32–46; existing accounts byte-identical balances;
   restore on a disposable profile with byte-identical `use`, opening fields and transactions, then
   reconfirmation of each confirmation separately; stage 0 matrix rerun with confirmation histories in
   the file.
7. **Regression:** full suite; mapping-impact and movement-rules tests.
8. **Completion criteria:** no historical movement counted twice; every consumer agrees with balances.
9. **Before stage 5:** owner review.

### Stage 5 — Running Shared portion and Shared splits

1. **Scope:** running pharmacy portion (9.2) and Shared splits enabled together; certainty rule (U5b).
2. **Dependencies:** stages 1–4; D12, U5a, U5b.
3. **Areas:** `sharedPortion`, `pharmacyEligibleAccounts`, `scopeOf` split handling, entry forms.
4. **Integrity risks:** portion and balance double-counted; rounding drift; uncertain portion still
   counted.
5. **Unit tests:** Example 9; percentage rounding in kobo; each transfer treatment; certainty
   transitions.
6. **Integrated acceptance tests:** criteria 10, 11; Shared restore test still passes.
7. **Regression:** full suite; stage1 ownership tests.
8. **Completion criteria:** splits always reconcile; uncertain portions count ₦0 and are flagged.
9. **Before stage 6:** owner review.

### Stage 6 — Obligation purposes and the conservative safe amount

1. **Scope:** `purpose`/`split` on bills and agreements; router (12.1); safe amount (12.2); required
   purpose on new obligations; review area.
2. **Dependencies:** stages 1, 3, 5; D8, Q2.
3. **Areas:** bill and agreement forms, `allObligations`, `directorPlan` inputs, Calendar, Pressure,
   Opportunity.
4. **Integrity risks:** an obligation dropped or counted twice on reclassification; coverage applied
   twice.
5. **Unit tests:** Example 17 and its two reclassifications; coverage once.
6. **Integrated acceptance tests:** criteria 9, 21.
7. **Regression:** full suite; Director, bills and floor tests (safe amount never rises because of an
   unclassified obligation).
8. **Completion criteria:** every obligation counted exactly once in the right place.
9. **Before stage 7:** owner review.

### Stage 7 — Owner plans, withdrawal links, safety check, override and reversal

1. **Scope:** `ownerPlan` records in `meta`; approval and closure; `ownerPlanId` links; derived totals
   (10.1, F1); safety check and override snapshot; `idemKey`; reversal of withdrawals; integrity checks;
   plan export/import (format 2).
2. **Dependencies:** stages 0, 1, 6; D3, D4, D5, D10, D11, D13, D14.
3. **Areas:** owner-withdrawal form, `reverseTxn`/`reversalOps`, `meta` handling, export/import,
   Owner withdrawals screen.
4. **Integrity risks:** stored totals drifting; duplicate plans per period; override hiding a
   qualified calculation; double save.
5. **Unit tests:** Examples 1, 2, 5, 11, 14; plan uniqueness; F1 derivation.
6. **Integrated acceptance tests:** criteria 15, 16, 17, 20, 29, 30.
7. **Regression:** full suite; stage 0 matrix rerun with plans in the file.
8. **Completion criteria:** plans never move money; withdrawals always derived; overrides fully
   recorded.
9. **Before stage 8:** owner review.

### Stage 8 — Pharmacy and Personal Money Directors, Net Worth split

1. **Scope:** Pharmacy Director plan panel and safety comparison (12.3); Personal Money Director
   (12.4); Net Worth subtotals (17).
2. **Dependencies:** stages 1–7.
3. **Areas:** `renderDirector`, `directorPlan`, a new Personal Director screen, `renderNetWorth`.
4. **Integrity risks:** a plan deducted from cash; subtotals not adding up; shared money counted twice.
5. **Unit tests:** section 17 table; Director figures for the combined fixture.
6. **Integrated acceptance tests:** criteria 22, 23, 18, 19, 24, 27.
7. **Regression:** full suite; Director, floor and Net Worth tests.
8. **Completion criteria:** all 47 acceptance criteria pass on both builds.
9. **After stage 8:** master plan update (separately authorised); site enablement only per section
   15.4.

**Later:** supplier and stock obligations from a validated PBSRx feed (master plan stage 8; separate
PBSRx authorisation).

Nothing in this roadmap starts until the owner explicitly authorises a stage.

---

## 24. Final consistency and implementation readiness review

Every check below was made against the whole document after incorporating R1–R4 (revision 6).

### 24.1 Consistency checks

| Check | Result |
|---|---|
| D1–D14 intact | Yes (2.2, 20.1); no decision altered |
| Q1–Q5 resolved | Yes (2.3, 20.2) |
| R1–R4 resolved | Yes (2.3, 20.2); none open (20.3) |
| Ownership and opening confirmation independent | Yes: separate fields, histories, markers and UI states; both required for confirmed available cash; neither substitutes for the other; classification uses ownership only (7.5, F6) |
| Restored accounts require the correct confirmations | Yes: both reset and both re-given on this installation; source confirmations only as history; R1 recognition excluded (F5) |
| Personal Cash opening dates do not double-count | Yes: effective-date rule in every baseline consumer; pre-opening entries never moved onto the account (7, F3) |
| Shared portions conservative and exact | Yes: kobo splits reconciling exactly; uncertain portion ₦0; portion and balance never added (9) |
| Unclassified obligations count fully against safe pharmacy cash | Yes, once (12.2) |
| Unclassified confirmed pharmacy outflows reduce cash and affect runway once | Yes: cash layer once, burn once, never opex (6) |
| Personal expenses do not inflate pharmacy opex | Yes (6) |
| Owner withdrawals not pharmacy expenses | Yes (5.3, 5.4, 6) |
| Personal savings transfers not expenses | Yes (5.3, 13.2) |
| Monthly allocations not actual cash | Yes (10, 12.3, 17) |
| Cross-boundary transactions explicitly identified | Yes (5.4); acceptance criterion 47 added in this revision |
| `scopeOf` the single authoritative engine | Yes: every figure comes from the measures table (6); obligations use the same partition principle (12.1) |
| Both Directors use consistent rules | Yes: both read the measures table and the obligation router (12) |
| Net Worth does not double-count transfers | Yes (17) |
| Backup compatibility gated independently per site | Yes: one switch per site gating new fields and format 2; TEST never stands in for production (15.3–15.4) |
| No older build assumed to understand new fields | Yes: the limitation is stated; older builds that see restored data read `null` ownership confirmation as unconfirmed (safe); everything else is gated (15) |
| No stage depends on an unresolved decision | Yes: no decision is open (20.3) |

### 24.2 Findings across revisions 4–6 (all resolved; no new policy decided)

- **F1 — plan totals** (rev. 4): `withdrawn` includes every linked owner-withdrawal amount by scope (10.1).
- **F2 — gate scope** (rev. 4): one per-site switch gates new-field writing and format-2 export (15.3).
- **F3 — baseline consumers** (rev. 4): per-account opening dates apply in every baseline consumer (7.4).
- **F4 — restored openings** (rev. 4): raised as R3, decided by the owner (7.5).
- **F5 — R1 recognition vs restore** (rev. 5): restored openings are never recognised as `setup_review`.
- **F6 — opening vs ownership in classification** (rev. 5): classification uses ownership only.
- **F7 — reports while ownership awaits reconfirmation** (rev. 6): applying the decided rules (D1,
  5.2 rule 5) makes default-classified entries unclassified after a restore, so opex and personal totals
  would look smaller until ownership is reconfirmed. Safeguard added, no new policy: every report and
  both Directors show a "classification incomplete" notice with the amount and are qualified (7.5,
  criterion 46).
- **Missing acceptance criteria** found and added: cross-boundary identification (47), F7 notice (46),
  and the R4 restore cases (37–45). Every criterion 1–47 is assigned to exactly one stage's integrated
  tests (23).

### 24.3 Stage readiness

| Stage | Scope | Deps decided | Integrity risks named | Unit tests | Integrated tests | Regression | Completion criteria | Next-stage condition |
|---|---|---|---|---|---|---|---|---|
| 0 Backup guard + site gate | ✔ | ✔ (Q3, R2) | ✔ | ✔ | ✔ matrix + 25, 26, 31 | ✔ incl. existing H-1 | ✔ | ✔ owner approval; per-site 15.4 before any enablement |
| 1 `scopeOf` + measures | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2 Reports, runway, views | ✔ | ✔ | ✔ | ✔ | ✔ 5–8 | ✔ | ✔ | ✔ |
| 3 Purpose, Outside, vehicles, categories, reconciliation | ✔ | ✔ (+ site guard verified before its switch is on) | ✔ | ✔ | ✔ 8, 12, 14, 28, 47 | ✔ | ✔ | ✔ |
| 4 Opening dates, Personal Cash, restore confirmations | ✔ | ✔ (Q1, R1, R3, R4) | ✔ | ✔ | ✔ 1–4, 13, 32–46 | ✔ | ✔ | ✔ |
| 5 Running Shared portion + splits | ✔ | ✔ | ✔ | ✔ | ✔ 10, 11 | ✔ | ✔ | ✔ |
| 6 Obligation purposes + safe amount | ✔ | ✔ | ✔ | ✔ | ✔ 9, 21 | ✔ | ✔ | ✔ |
| 7 Owner plans, withdrawals, safety, reversal | ✔ | ✔ | ✔ | ✔ | ✔ 15–17, 20, 29, 30 | ✔ | ✔ | ✔ |
| 8 Directors + Net Worth | ✔ | ✔ | ✔ | ✔ | ✔ 18, 19, 22–24, 27 | ✔ | ✔ all 47 | ✔ master plan update separately |

- **Stage 0 is the first implementation stage.** It covers the backup reader guard and the
  site-by-site gate, and leaves every build exporting format 1 with the gate off.
- **No new-format financial field or backup** is enabled on any site until that site has independently
  verified the guard (15.4); TEST verification never establishes production readiness.
- **Each stage is completed and tested as an integrated unit** before the next begins; stages are not
  combined.

**Assessment:** the specification is complete and internally consistent, with no open owner decision.
It is ready for the owner's authorisation to commit the document; Stage 0 then needs its own separate
implementation authorisation.
