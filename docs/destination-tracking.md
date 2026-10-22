# Destination and source tracking

## What it records

Two optional names on an entry:

- **`paidTo`**: who or where the money went (a shop, a supplier, a staff member, the lender).
- **`receivedFrom`**: who or where it came from (customers, an investor, the lender).

They are **names only, never accounts**:

- No balance, cash, reservation, report or Director function reads them. That covers
  `accountDeltas`, `accountBalances`, `classifyTxn`, `cashFlowSummary` and `reservationPlan`.
- So a name cannot move money, create an account or be counted twice.
- Money still moves only through `fromAcct` and `toAcct`, which must be your own configured
  accounts.

| Type | Name field | Account rules (Add Entry and Edit) |
|---|---|---|
| Expense, Bill paid | Paid to | From required; no To (an expense can never credit an account) |
| Owner withdrawal | Paid to | From required; To optional |
| Investment | Paid to | From required; To optional (a real account, e.g. a fixed deposit) |
| Loan repayment | Paid to (the lender, set automatically) | Loan rules unchanged |
| Income | Received from | To required; no From |
| Capital injection | Received from | To required; From optional |
| Loan received | Received from (the lender, set automatically for agreement receipts) | To required; no From |
| Transfer | **none**: both sides are your accounts | From and To both required and different |

- **Format:** names are trimmed. Spaces are collapsed, and control and text-direction characters
  are removed. So are invisible characters (zero-width space, direction marks, word joiners, BOM,
  soft hyphen); zero-width joiners are kept only between visible characters. A name of only spaces
  or invisible characters is empty. The limit is 80 characters, and an empty name is not stored.
- **Older entries:** they have no name. Nothing is invented for them.
- **The engine functions** are `partyField`, `cleanParty`, `clipParty`, `partyKey` and
  `PARTY_MAX`, all in the `kobo-finance-engine` block.

## Where names come from

- **Add Entry:**
  - one "Paid to" or "Received from" field, labelled for the chosen type;
  - suggestions come from names already used;
  - only the accounts the type uses are shown, so an expense has no To account to fill by
    mistake;
  - the account rules above apply, and an amount must be above zero.
- **"Bill paid" in Add Entry, linked to a bill:** the name defaults to the bill's name unless you
  type one.
- **Bills screen payment:** paid to the bill's name.
- **Loans:**
  - a repayment (including an early settlement or a correction) is paid to the agreement's
    lender;
  - money received through an agreement is received from the lender;
  - the repayment split, allocations, schedule and balances are unchanged.
- **Quick entry:** `5000 fjr fuel @ Fuel station`.
  - The text after ` @ ` is split off **before** the entry is read, so a name such as "Transfer
    Hub" cannot change the type, category or account.
  - An `@` inside a word (an e-mail address) stays in the description.
  - The preview shows "Paid to: …" before saving.
  - These are refused with a reason, and nothing is saved:
    - more than one ` @ `;
    - a repeated marker (`@@ x`, `@@`);
    - nothing, or only spaces or invisible characters, after it;
    - a name over 80 characters;
    - a name on a transfer;
    - a negative amount.
- **Edit:**
  - the same field, prefilled;
  - adding, changing or clearing a name appears in the review ("Paid to: (none) → Fuel station");
  - it is written only by CONFIRM AND SAVE (same id, one `edits[]` entry);
  - changing the type moves the name to the field the new type uses; a transfer drops it, and the
    review shows that;
  - loan-agreement entries are still corrected in Loans, not here.

## Finding entries later

- **History and Inbox:** names appear after the category ("paid to Fuel station", "from Walk-in
  customers"). Entries without a name show nothing extra.
- **History search** matches description, category, Paid to and Received from, ignoring capitals.
- **History date range** (From and To): both days are included.
  - An entry belongs to the calendar date written on it, as everywhere else in the app (balances,
    baseline). A value with a time part, such as `2026-10-05T23:30`, belongs to the date written
    in it, so late-evening entries on the end date are included.
  - A missing or impossible date (e.g. `2026-02-31`) is never shown inside a range. The line
    under the range says how many such entries are hidden.
  - A start after the end is reported and not applied: all dates stay shown.
  - **Clear dates** removes the range. With no range set, History behaves as before.
  - The range combines with search and the type chips.
- **Day headers** now read the date as a local calendar date. Before, it was read as UTC
  midnight, which could show the previous day west of UTC.

## Duplicates

The possible-duplicate warning matches entries as before: same date, amount, type, description and
accounts. The names refine it conservatively:

- **Both entries named, with different names** (ignoring capitals and spacing): two payments, not a
  repeat. For example, the same amount on the same day to two different places.
- **Same name, or a blank name on either side:** still a possible repeat. A blank name never hides
  a repeat, so a named and an unnamed copy of the same entry are flagged. This covers an older
  payment without a name next to one named automatically from its bill.
- **Order:** entries are judged in the order they were made (time, then id), so the later copy is
  the suspected repeat. A blank entry may repeat either of two differently named ones, so both
  named ones are then flagged.
- **Different amount, day, description or account:** never flagged.
- **Nothing is ever blocked:** the warning is advice only.

## Backup, import and CSV

- **JSON backups** save whole records, so the names are included. The format stays "4.0", and no
  database version change or migration was needed.
- **Older backups** (v2, v3, 4.0 without names) import unchanged, and their duplicates are
  matched exactly as before. `txSig` is unchanged.
- **Imported names are checked** (`importParties`):
  - only text is kept, and only in the field the entry's type uses;
  - names are cleaned and shortened to 80 characters;
  - anything else (a number, an object, a name on a transfer, a "received from" on an expense) is
    dropped;
  - the entry itself is still imported, and the import summary says how many names were
    changed.
- **CSV** has two new columns at the end, **Paid to** and **Received from**, so existing column
  positions are unchanged. A name that starts like a formula (`=`, `+`, `-`, `@`) gets a leading
  `'`, as for descriptions; ordinary names are unchanged.

## Also fixed

- **Quick entry for income** ("pharmacy sales", "salary") kept the default From account. With
  both From and To set, it counted as a transfer instead of income. Income now has no From
  account.
- **Entries already saved that way:** they are not changed automatically. A read-only warning
  finds them (next section). Editing one asks for From to be set to None.

## Warning: income recorded with a From account

The production v2 app's quick entry has the same default. So real data upgraded from it, and
entries made with this app before the fix, can contain income with a From account. Income normally
only adds to the account it is received in, so such entries **may be misclassified** and are listed
for review. The warning does not say they are errors, and it does not say every one changes the
figures.

**Flagged** (`incomeFromFindings`, reported by `dataQuality` as `income_with_from`): type
`income`, a non-empty `fromAcct`, not reversed and not a sample.

**Never flagged:**
- transfers;
- income without a From account;
- capital injections (a From account is optional for them);
- expenses, owner withdrawals, and reversed or sample entries.

**Why each entry was flagged:**
- **"quick"**: category "Pharmacy Sales" or "Income", with From set to personal cash
  (`pers_cash`, or the account it is mapped to). This matches the quick-entry default, so it was
  almost certainly money received: From should be None.
- **"chosen"**: any other From, picked when the entry was typed. It may be money received (From →
  None) or a move between your own accounts (change it to a Transfer).

**What it does to balances now.** This uses the same accounts the balance engine moves (only
accounts that are set up, after the baseline) and is shown for each entry, compared with income
received:

| Effect | What the engine does now | Differs from income received? |
|---|---|---|
| `none` | From and To are the same account: no change | yes (income would add the amount) |
| `moved` | out of From, into To; total cash does not go up | yes |
| `out_only` | out of From only (To is empty or not set up) | yes |
| `to_only` | From is not set up: only adds to To | no (the same as income) |
| `no_account` | neither account is set up: no change | no |
| before the baseline | no change either way | no |

**Severity** follows that last column (`balanceDiff`):
- **High:** at least one entry leaves balances different from income received. The headline says
  how many, the Director adds its "review these entries" advice, and recommendations are marked
  qualified.
- **Info:** no entry does. The headline says the balance figures are not affected, and there is
  no Director advice or qualification.
- **Either way,** reports count these entries as income.

**Where it appears:** the Director shows the warning and lists up to 20 entries. Each shows its
date, description, amount, From and To accounts, the reason and the effect, with a **REVIEW**
button. REVIEW opens the normal edit form, and the correction is the user's choice, made through
the review and CONFIRM AND SAVE: same id, recorded in `edits[]`.

**What the warning never does:**
- rewrite, reverse, delete or reclassify anything;
- change a balance, cash flow, loan record or any Director figure.

A high-severity item only adds "review these entries" advice and marks recommendations as
qualified. The list shows up to 20 entries, in stored order, followed by "and N more" when there
are others.

**Possible false flags:**
- **An income entry where the From account really was meant.** For example, interest credited
  between two of your accounts. Under the current rules this double counts as income, so it still
  needs a decision. The "chosen" wording offers both fixes.
- **A "quick" entry the user typed on purpose with From = personal cash.** It is still
  inconsistent with the income rule. The wording says "most likely", not "certainly".
- **Aliases changed since the entry was made.** The "quick" label uses the current mapping of
  `pers_cash` and the raw `pers_cash` id. An entry made under an older mapping may be labelled
  "chosen"; it is still flagged.
- **Entries before the baseline** affect only reports, not balances, and say so.
- **Negative quick-entry amounts** are refused.

## Tests

`tests/destination.test.js`:

- **Engine:**
  - names never change balances, classification or cash flow, for every type;
  - field rules, cleaning, safe shortening, normalised matching;
  - duplicates;
  - inclusive date range, including late evening, time parts and impossible dates.
- **Both builds:** an expense paid to a fuel station:
  - only the paying account moves and no account is created;
  - Director and Cash Flow count it once;
  - income received from customers;
  - display, search, restart;
  - the TEST build never touches the live database.
- **Transfers:** no name; missing or identical accounts refused. Owner withdrawal, investment and
  capital injection move each account once. An expense without its account, or with a negative
  amount, is refused.
- **Bills and loans:**
  - bill payments are paid to the bill or a typed name;
  - a loan receipt is received from the lender and a repayment paid to the lender;
  - one repayment even when tapped twice, with allocations and outstanding unchanged;
  - loan entries are still not editable here.
- **Editing names:** add, change, clear; review, back, cancel, confirm; a type change moves or
  drops the name; a bill payment keeps its links.
- **Quick entry:** `@` parsing with existing aliases and categories; a keyword-looking name;
  e-mail text; refusals and preview; income without a From account.
- **History range:** both ends, a single day, late evening, time parts, impossible dates; combined
  with search; start after end; clear.
- **Duplicates:** repeated payments to different places are not flagged; the same place repeated
  is flagged and still saved.
- **Income with a From account** (`tests/income-from.test.js`):
  - engine: legitimate transfers, correct income, capital with a From account, reversed and
    sample entries are never flagged;
  - every pattern and effect, with and without aliases;
  - the warning lists exactly the affected ids;
  - no financial effect: records unmodified; balances, cash flow and Director figures identical;
  - screens, both builds: the list shows reason and effect; nothing changes across a restart;
    REVIEW and cancel write nothing; the user's correction goes through the review and fixes the
    balance; the list updates.
- **Import and CSV:**
  - an older backup imports;
  - every kind of bad name is cleaned;
  - re-import adds nothing;
  - HTML-looking names are shown as text;
  - CSV columns, formula neutralisation, ordinary names unchanged.
