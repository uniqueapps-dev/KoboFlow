# Loan principal and settlement integrity

This fixes audit item P0-1 (defects D2 and D3 in `docs/turnaround-readiness-audit.md`).

## The defects

- **D2: extra principal left every instalment due.** An extra principal payment was stored as an
  allocation with no instalment. The liability went down, but each instalment kept its full
  remaining amount. The Director, free cash, Calendar, the Loans summary and loan-linked earmarks
  therefore still expected money that had already been repaid. After paying off all the principal,
  the loan was not settled and all instalments stayed due.
- **D3: an amendment subtracted it twice.** The app advised amending the schedule after an extra
  payment. But `agreementBalances` always subtracted every extra payment from the remaining
  instalments, including instalments the lender had already reduced to reflect it. The liability
  was understated by the extra amount, and net worth was overstated by the same amount.

## The rule now (`kobo-finance-engine`)

- **Before the lender confirms new instalments:**
  - the agreed instalments stay as they were (same rows, same amounts);
  - the extra principal is counted against the principal of the **last** instalments first;
  - so the next instalments still show what the lender expects;
  - the forecast total equals what is still owed;
  - nothing is counted twice.
  The loan shows **Schedule needs review**. KoboFlow does not invent revised terms.
- **Amend Schedule:** when any extra principal is not yet reflected, the form asks a required
  question: do the lender's new instalments already take it into account?
  - **Yes:** each new row stores the ids of the extra payments it reflects (`extraAbsorbed`).
    Those payments are never subtracted again.
  - **No:** the extra keeps counting once, against the new rows.

  The preview warns when the principal in the new rows does not match what is expected.
- **Older amendments** have no `extraAbsorbed` list. Extra payments recorded before such an
  amendment are treated as already reflected in it, because the app advised amending after an
  extra payment. This is marked for review ("check against the lender's statement"). The stored
  records are not changed. An extra payment made after the amendment still counts against the
  new rows.
- **Paying off all the principal** marks the principal **Fully repaid** (`principalSettled`).
  - Scheduled interest and fees that are still unpaid stay owed and visible.
  - The loan is settled only when nothing is left.
  - If the lender confirms a lower payoff, record it with Early Settlement. The difference is
    recorded as waived.
- **Early Settlement saves only when two boxes are ticked:**
  - the lender confirmed this is the full amount that closes the loan;
  - the money has already left the account.

  It also still needs the lender's confirmation text, a date that is not in the future, and the
  final confirmation.
  - Entering a quote shows its effect without saving. This covers comparing a payoff to qualify
    for a larger facility; nothing is assumed beneficial or carried out.
  - An unticked box, a cancelled confirmation or a closed window saves nothing.
  - Reversing a settlement reopens the loan and lifts its waivers (unchanged behaviour).
- **Figures the loan screen distinguishes:**
  - principal, interest and fees, each scheduled, paid and outstanding;
  - the outstanding total, split into principal and scheduled interest and fees;
  - the extra principal: how much is reflected in an amendment and how much is still awaiting the
    lender;
  - for each instalment, its agreed total, what was paid (including any extra principal counted
    against it) and what is left.
- **Planned, recorded, paid, verified:**
  - a schedule is a plan and moves no money;
  - a payment is recorded only with a date that is not in the future;
  - a settlement additionally needs the lender's confirmation;
  - a loan becomes Settled only from recorded payments, never from a quote or an intention.

## One source for every screen

- The loan screen, Loans summary, Net Worth, Director, free cash, Calendar, Brief and loan-linked
  earmarks all read the same instalment states (`instalmentStates` / `agreementBalances`), so they
  agree.
- **Net Worth** shows each loan's total still owed, as before. It now also gives the split:
  principal, and scheduled interest and fees.
- **Principal is counted once.** It is never shown both as a current liability and again as a
  separate future liability.
- **Future interest is not included as principal.** Whether Net Worth should include future
  scheduled interest at all is still open (decision H5 in the audit).

## Records and compatibility

- No database version change and no migration.
- The only new stored field is `extraAbsorbed` on instalment rows created by new amendments.
  Backups (format "4.0") carry it. Older backups import unchanged.
- **Unchanged figures:** without extra principal, every figure matches the previous release
  (tested against the engine at `740ded1`). With extra principal and no amendment, the liability
  and principal outstanding are unchanged; only the per-instalment amounts now reflect the
  payment.

## Known limits

- **Old amendments:** if an old amendment did **not** reflect an earlier extra payment, the
  liability is now overstated by that amount. It is flagged; correct it by amending again with the
  lender's figures.
- **Reversed extra payment:** if an extra payment that an amendment reflects is later reversed,
  the amended rows may be too low. It is flagged (`absorbed_reversed`) and not adjusted
  automatically.
- **Extra principal beyond the schedule:** extra principal above the principal left in the
  schedule is flagged (`extra_unapplied`), not spread elsewhere.
- **Not in scope:** Director wording, receivables and PBSRx were not touched.

## Tests

`tests/loan-principal.test.js`:
- **Engine:**
  - extra principal, then an amendment (reflected and not reflected);
  - several extra payments;
  - full payoff with and without remaining interest;
  - partial and normal instalments;
  - recomputation, reordering and reversal;
  - failed, cancelled and reversed settlement;
  - older amendments;
  - an exact comparison with the previous release over 40 cases.
- **Both builds:**
  - one figure on the loan screen, Loans summary, Net Worth, Calendar and Director, before and
    after an amendment and a restart;
  - the amendment refused without the extra-principal answer;
  - principal payoff with interest left;
  - settlement refused unless confirmed and paid, or when the confirmation is cancelled; then
    saved, then reversed;
  - an older backup imported unchanged and not double-subtracted.
