# Bills and database version 4

## Data model

The v4 upgrade adds one object store, `bills` (key `id`, index `status`). Nothing else changes:
existing stores and records are untouched.

A **bill** record is the definition only:

| Field | Meaning |
|---|---|
| `id` | `bill_…`, created when the form opens, so a retried save overwrites rather than duplicates |
| `name`, `cat` | What it is; the category comes from the Add Entry list |
| `amount` | The amount from the first due date |
| `firstDue` | The first (next) due date |
| `repeat` | `none`, `weekly`, `monthly`, `quarterly` or `yearly` |
| `until` | Optional last date |
| `status`, `cancelledFrom` | `active`, or `cancelled` from a date |
| `amountChanges[]` | `{from, amount}`: a new amount from a date onward |
| `overrides{dueDate}` | `{skipped, reason, at}`: one date marked "not owed" |
| `history[]` | Every change, with its time |

**Occurrences are derived, never stored.** The engine (`billOccurrences`) works them out from the
definition each time. Each occurrence's id is `billId@dueDate`, so a reload, restart or retry can
never create a second copy, and there is nothing to keep in sync.

**A payment is an ordinary transaction**: type `obligation` ("Bill paid"), carrying `billId` and
`billOcc`. What is paid on an occurrence is the sum of its non-voided payments. A bill payment
recorded on the Bills screen also carries an `idemKey`, so a double tap or retry saves it once.

## Financial rules

- **A bill falling due is not a cash outflow.** Only the recorded payment moves money, once.
- **Unpaid occurrences are obligations**, with the same shape as loan instalments. They feed
  `obligationsWithin()`, and so Home, Pressure, Calendar, Autopilot, `freeCash()`, the Opportunity
  Analyzer and the Daily Money Director. All use `cashCover()`: free-to-use cash minus only the part
  of each obligation not already covered by a linked earmark.
- **Earmarks can be linked to a loan (`agr:<id>`) or a bill (`bill:<id>`)**, through one
  reservation model (`reservationPlan`):
  - a linked earmark covers only what is still owed on its target, in due-date order;
  - partial payments shrink both the obligation and the reservation;
  - when everything is paid, the reservation stops counting automatically. It is never released
    twice, because nothing is stored for it;
  - money in a restricted account covers nothing;
  - one naira is never subtracted twice.
- **Dates:**
  - monthly, quarterly and yearly bills keep the first due day, clamped to the end of shorter
    months (31 Jan → 28/29 Feb → 31 Mar);
  - a yearly bill due 29 Feb falls on 28 Feb in other years;
  - weekly bills add 7 days.
- **Changes:**
  - a changed amount applies from its date; earlier occurrences keep their amount;
  - cancelling stops occurrences from the cancellation date, but earlier unpaid ones stay owed;
  - a single date can be marked "not owed", with a reason, and undone;
  - once a bill has a live payment, its first due date and repeat are fixed.
- **Missed dates stay owed.** They show as overdue, rank first in the Director, and count as
  liabilities in Net Worth. Bills not yet due are not liabilities.
- **Unlink and Reverse are different.** A payment recorded elsewhere and linked to a bill can be
  unlinked: it stays recorded as money spent, and the link history is kept on the entry. Only a
  payment recorded on the Bills screen can be reversed (voided, with the money back in its
  account).
- **Double counting is guarded:**
  - Add Entry → Bill paid can name the bill it pays;
  - a "Bill paid" left unlinked that matches an open bill is flagged, and the pay form offers to
    link it instead of recording it again;
  - a payment pointing at a date that no longer exists is reported.
- **Working-capital floor** (your own figure, optional) is applied once:
  - in the Director: free to allocate = free after 30-day commitments − floor;
  - in the Opportunity Analyzer: the same "before the commitment" figure, plus the lowest free
    cash while repaying ("after"), compared with the floor. "After" includes the unreserved part
    of your other known payments (bills, loan instalments) due after 30 days during the repayment
    period;
  - funding that would take free cash below the floor is rated BAD;
  - with no floor set, both say so. A floor is never invented.
  - Loan proceeds are never counted as income.

## Migration v3 → v4: how it works

When the app starts, the storage layer:

1. **Opens the database as it is**, without upgrading it.
   - If it doesn't exist, that probe is aborted, so no database is created.
   - If it is already v4, there is nothing to do.
   - If it is older but empty, there is nothing to protect.
2. **Reads every store and record** in one read-only transaction.
3. **Writes a complete copy** to a separate database, `<name>-pre-v4-<UTC timestamp>`, with the
   same old version number and the same store and index layout. It then reads the copy back and
   compares it with the original, store by store.
4. **Only if the copy matches** does it open the database at version 4. The upgrade only creates
   the `bills` store, and runs in one IndexedDB versionchange transaction: if anything fails part
   way, IndexedDB rolls the whole upgrade back.
5. **After the upgrade** it checks that every store still has the same number of records, then
   writes `meta/dbUpgradeV4` = `{from, to, at, copyDb, counts, verified}`.

**Failures stop the app and change nothing:**

| What fails | What happens |
|---|---|
| The copy cannot be created, written or verified | The upgrade does not happen; the database stays at its old version. The app explains why and offers **Download a copy of your data** (an ordinary backup file built from the records it just read). A half-made copy is removed **before** the failure is reported. If the browser refuses even that, the copy is listed as not verified. |
| The upgrade itself fails | It is rolled back whole. The app says so; the verified copy is kept. Reloading makes a new copy and tries again. |
| The database is from a newer version | It is refused with a clear message. Nothing is changed. |

**Copies are never deleted automatically.**

**Finding every copy.** Each verified copy is recorded with a fingerprint of its layout and
records. The record is kept in browser storage (`localStorage`, key
`kfRecoveryCopies:<database name>`), outside the database being upgraded, so the original is not
modified before its upgrade. The copy used for the upgrade is also recorded, with its
fingerprint, in `meta/dbUpgradeV4` in the upgraded database. Settings → Storage Check lists every
copy on the device: those recorded, plus any database named with the copy prefix. Each entry shows
its name, creation time (UTC), version and number of records, and one status:

- **Verified:** unchanged since it was verified.
- **Changed since it was made:** for example, opened and edited in an older KoboFlow.
- **Not verified:** there is no record that it was completed; for example, a tab was closed while
  it was being written.
- **Could not be read**, or **recorded but no longer on this device.**

Every readable copy can be downloaded as a backup file. Listing works even when the main database
cannot be opened. Where a browser cannot list databases, only the recorded copies are shown, and
the screen says so.

**Records added during the upgrade.** An older KoboFlow tab could write between the copy and the
upgrade. After the upgrade, every record that was copied must still be present: if any is
missing, KoboFlow stops, because that would be loss. Records added or edited in the meantime are
kept. The upgrade record then notes that the copy is a little older than the database, and
Storage Check advises exporting a current backup too.

## Recovery and rollback

None of these steps needs the older app to open the upgraded database:

1. **Open the copy directly in an older KoboFlow.** Add `?db=pre-v4-<timestamp>` to the older
   app's address. The exact name is shown in Settings → Storage Check. The copy has the older
   layout, so the older app opens it normally.
2. **Restore from a file.**
   - In the new app: Settings → Storage Check → **Download pre-upgrade copy**. The file is in the
     v3.2 backup format.
   - In any KoboFlow v3 or later, use an empty database (for example `?db=restore`), then
     Settings → Import that file. The import adds records, skips what is already there and never
     overwrites.
3. **Entries made after the upgrade** are not in the pre-upgrade copy. Export a current backup
   from the new app (format 4.0). An older app imports its transactions, loans and setup; bills
   are new and are ignored there.

The test build (`koboflow-test.html`) has a fixed database name and no `?db=` option, so for it
only the file route applies. Its isolation guard also refuses to open production's safety copies.

## Tests

| File | What it covers |
|---|---|
| `tests/database-v4.test.js` | A database that already holds the copy's name is left untouched and the copy takes the next name; fresh install; a realistic v3 database built with the previous release's own screens upgrading with every record preserved; the copy being identical, at v3, recorded and downloadable; the older app refusing the v4 database without changing it but opening the copy; restoring the downloaded copy into the older app, record for record; a copy failure leaving v3 unchanged with a download offered; an interrupted upgrade rolled back, then completed on retry with both copies kept; a newer version refused |
| `tests/bills.test.js` | Recurrence across screens; partial and full payments; double-tap idempotency; linked earmarks for bills; Add Entry linking; detecting and linking an unlinked payment; overdue, "not owed", amount changes, reversal, cancellation and history; failed saves with retry; the working-capital floor in the Opportunity Analyzer and the Director; HTML-looking bill names |
| `tests/engine.test.js` | Date rules (month end, leap years, weekly, quarterly, end date), occurrence states, amount changes, cancellation, validation, unmatched payments, bill and loan reservations, the floor in `analyzeOpportunity` |
