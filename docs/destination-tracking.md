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

- **Format:** names are trimmed. Spaces are collapsed, control and text-direction characters are
  removed, and the limit is 80 characters. An empty name is not stored.
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
  - These are refused with a reason, and nothing is saved: more than one ` @ `, nothing after it,
    a name over 80 characters, a name on a transfer, or a negative amount.
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

The possible-duplicate warning also matches on the names, ignoring capitals and spacing:

- the same amount on the same day to **different** places is two payments, not a repeat;
- the same place repeated, even typed with different spacing or capitals, is flagged;
- entries without names match exactly as before;
- nothing is ever blocked: the warning is advice only.

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
entries made with this app before the fix, can contain income with a From account. Balances move
money out of `fromAcct` and into `toAcct` for every type. Such an entry therefore moves money
between your accounts like a transfer, while reports still count it as income.

**Flagged** (`incomeFromFindings`, reported by `dataQuality` as `income_with_from`, severity
high): type `income`, a non-empty `fromAcct`, not reversed and not a sample.

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

**What it does to balances now** (from the existing rule, shown for each entry):
- From and To are the same account: it adds nothing.
- It takes the amount out of From and adds it to To: total cash does not go up.
- There is no To: it takes the amount out of From.
- From is not set up: nothing is taken out.
- Dated before the baseline: balances are unaffected, but reports still count it.

**Where it appears:** the Director shows the warning and lists up to 20 entries. Each shows its
date, description, amount, From and To accounts, the reason and the effect, with a **REVIEW**
button. REVIEW opens the normal edit form, and the correction is the user's choice, made through
the review and CONFIRM AND SAVE: same id, recorded in `edits[]`.

**What the warning never does:**
- rewrite, reverse, delete or reclassify anything;
- change a balance, cash flow, loan record or any Director figure.

A high-severity item only adds "review these entries" advice and marks recommendations as
qualified.

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
