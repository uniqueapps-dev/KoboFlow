# Editing a saved entry

## Where

- **History:** tap an entry, or its **EDIT** button.
- **Financial Inbox:** the **EDIT** button on the entry.
- Entries that belong to a loan agreement show **LOAN** (Inbox) or "tap to open the loan"
  (History) instead, and open the agreement.

The form (`openEdit`, `saveEdit` in `koboflow.html`) is prefilled with the saved values: type,
amount, category, description, date, time, From and To account.

## What happens on save

- **The original record is changed in place.** It keeps its id; no second record is created, so
  nothing is counted twice.
- **Cancel writes nothing.** So do the close button and tapping outside: the form only ever holds
  a copy. Saving without changing anything writes nothing either.
- **Saving takes two taps.** SAVE CHANGES checks the values and shows a review inside the form,
  listing each changed field (old → new). Nothing is written until CONFIRM AND SAVE is tapped.
  BACK TO EDITING returns to the fields with the typed values kept. CANCEL, the close button or
  tapping outside closes the form without saving. If the new date crosses the baseline, the
  review also says whether the entry will start or stop changing account balances.
  - The review is part of the page, not a browser dialog. An earlier version used the browser's
    `confirm()`. On the Android acceptance test the edit saved with no confirmation shown, and
    whether a browser dialog appears is up to the browser.
  - For a moment (600 ms) after the review appears, its buttons ignore taps. The buttons move
    when the review replaces the fields, so the second tap of a double tap on SAVE CHANGES would
    otherwise land on one of them.
- **Every figure is recalculated from the entries,** so all of them follow the edit: account
  balances, Cash Now, free cash, the Director, Cash Flow, budgets, Net Worth, runway and bills.
- **The record keeps its history** in `edits[]`: `{at, changes: {field: {from, to}}, prevSig}`.
  `updatedAt` is also set.
- **It saves only if the stored record is unchanged since the form opened.** `db.atomicIf`
  compares it inside the same database transaction. If it was changed elsewhere (for example in
  another tab), nothing is written and the form says so.
- **A failed write changes nothing,** either in storage or on screen. The form stays open with the
  new values, so the user can retry.

No database version change was needed: records are stored whole, so the new fields need no
schema change.

## Rules by type

The From and To accounts must suit the type:

| Type | From | To |
|---|---|---|
| Expense, Bill paid | required | must be empty |
| Income, loan received | must be empty | required |
| Transfer | required | required, and different |
| Owner withdrawal, Investment | required | optional |
| Capital injection | optional | required |

The amount must be above zero, the description must not be empty, and the date must be valid
and not in the future.

- **Changing the type** is allowed between Expense, Income, Transfer, Owner withdrawal,
  Investment, Capital injection and (unlinked) Bill paid. The accounts must be set again to suit
  the new type.
- **Capital injection:** it is never relabelled as a loan here (category "Loan" is refused). Its
  `fundingKind` is kept.
- **Bill payment** (linked with `billId` / `billOcc`):
  - it stays linked to the same bill date, and its type cannot change;
  - its amount cannot exceed what is due on that date, counting this payment;
  - its `idemKey` is kept, so a Bills-screen payment can still be reversed there;
  - to move it to another bill or date, unlink it on the Bills screen;
  - if its bill date no longer exists, the amount is locked.
- **Loan received, not yet linked to an agreement:** amount, description, date, time and account
  can be corrected. It stays a loan receipt.
- **Vehicle category:** the vehicle follows the category, as in an Inbox category correction.

## Not editable here, and why

| Entry | Why | What to do instead |
|---|---|---|
| Loan receipt or repayment linked to an agreement | The agreement keeps its own copy: the repayment split (`allocations`, `alloc`) and the receipt fields | Use **Correct** or **Reverse** on the agreement in Loans |
| Reversed entries | Kept unchanged as history | — |
| Sample entries (demo mode) | Not saved | — |

Asked to edit one of these, the app shows the reason and changes nothing.

## Import

Import never overwrites (see `planImport`):

- **A newer-format backup holding the pre-edit version** (same id): counted as a conflict, and the
  edit is kept.
- **An old v2 backup:** matched by signature only. The edited record also claims its earlier
  signatures (`edits[].prevSig`), so the old version is skipped, not added as a duplicate.
- **An edit made on another device** does not arrive by import. The local version is kept, as for
  every conflict.

## Delete

Not added. Removing a record would also remove its history, and there is no undo. The existing
reversal paths (loan agreements, Bills-screen payments) keep the record, marked reversed. A
general "reverse this entry" for other types would be a separate change.

## Tests

`tests/transaction-edit.test.js`:

- Editing amount, description and category from History, against the TEST site and the
  production candidate. Checks:
  - the form is prefilled;
  - the record keeps its id and count;
  - `edits[]` is written;
  - balances, Director, Cash Flow, History and Inbox follow the edit;
  - the edit survives a restart;
  - the TEST build never touches the live database.
- The confirmation path, against both builds:
  - SAVE CHANGES shows exactly the changed fields and writes nothing;
  - BACK TO EDITING keeps the typed values;
  - a double tap on SAVE CHANGES does not save;
  - CANCEL from the review leaves the original unchanged;
  - CONFIRM AND SAVE, even double-tapped, applies the edit once;
  - no browser dialog is used.
- Cancel, the close button, tapping outside and "no changes".
- Transfers, owner withdrawals, investments, capital injections and a change of type:
  - each account moves once;
  - invalid account choices are refused.
- A bill payment: type locked, capped at what is due, link and `idemKey` kept, the bill follows
  the edit.
- Loan-agreement, reversed and sample entries are refused with a reason. An unlinked loan receipt
  is editable but stays a loan receipt.
- Invalid values (negative, zero, empty, future) are refused. A failed write and a record changed
  elsewhere both leave everything as it was. A date moved before the baseline is explained, and
  the balance follows.
- Re-importing an older backup (current format and v2) adds no duplicate and does not undo the
  edit.
