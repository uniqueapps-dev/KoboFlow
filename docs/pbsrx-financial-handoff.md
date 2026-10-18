# PBSRx → KoboFlow financial handoff

Status: **not implemented, by design.** This document records what KoboFlow needs from PBSRx,
what PBSRx provides today, and why KoboFlow does not import from it yet.

## Ownership

- **PBSRx owns pharmacy operations:** products, stock, batches, expiry, stock movements, sales,
  supplier records, and its own operating and break-even calculations.
- **KoboFlow owns money:** account balances, transactions, earmarks, obligations, loans and the
  Daily Money Director.

KoboFlow must not rebuild PBSRx's inventory or supplier-debt ledger.

## What PBSRx provides today

This was checked read-only against the `pbsrx-phoenix-release` build (v7.6.7-RC3.9.4A).

- **Storage.** No IndexedDB. Everything is one JSON value in `localStorage` (`pbsrx_v2`) on its
  own origin, so KoboFlow cannot read it directly.
- **Integration.** No API, `postMessage`, URL handoff or shared channel.
- **Full backup.** `PBSRx_Backup_YYYY-MM-DD.json` holds the whole state. It has no schema
  version, and restoring it overwrites everything.
- **Sales CSV.** No id column. It is also broken for POS sales: it reads fields that only
  imported sales have.
- **Cash CSV.** Day totals only, with no ids.
- **Sale ids** are `Date.now()` (milliseconds), unique per device only in practice.
- **Day records (`cashDays`)** are deleted and rebuilt on every Cash Desk save, with a new id each
  time, so corrections cannot be traced.
- **Two revenue totals that can disagree:** `sales[]` and `cashDays[].sales`. Importing both would
  count the same money twice.
- **Collected cash is overstated.** `cash + transfer` is the amount tendered, including change
  given back.
- **Expenses** are `{cat, amt}` inside a day record, with no id, time or payment status.
- **Refunds** reduce the day totals; the original sale is left unchanged and the return is not
  linked to it.
- **"Net profit" is not net profit.** It is `sales − expenses`; cost of goods sold is not
  subtracted.
- **Break-even** is compared with raw sales, with no margin adjustment.
- **Dates are UTC.** Sales between 00:00 and 01:00 Nigeria time get the previous day's date.

**Conclusion:** there is no source with stable ids from which an import could be deduplicated, and
the values PBSRx calls profit and break-even have not been validated. Under the build rules, KoboFlow
does not import PBSRx data and does not let PBSRx figures drive recommendations.

## What KoboFlow does instead

KoboFlow counts only cash the user records, as income into a real account. The Daily Money
Director says so explicitly: a sale recorded in PBSRx is not treated as cash received.

## Minimum contract for a future integration (a PBSRx-side change)

PBSRx would need to export a versioned file, or offer a share action, of **financial events**:

| Field | Meaning |
|---|---|
| `schema` | e.g. `"pbsrx-finance-events/1"` |
| `sourceId` | Stable id: device id + event id, never reused, never regenerated on edit |
| `type` | `cash_collected`, `refund_paid`, `expense_paid`, `stock_purchase_paid`, `supplier_payment` |
| `date` | Local date (Africa/Lagos), `YYYY-MM-DD` |
| `amount` | Naira, 2 decimals, net of change given |
| `method` | `cash`, `transfer`, `pos` |
| `relatesTo` | `sourceId` of the event it corrects or refunds, if any |
| `status` | `active` or `voided`; a correction is a new event plus a void, never an overwrite |
| `salesRecorded` | Optional day summary, informational only: never imported as cash |
| `cogs` / `grossProfit` | Optional; used only after the method is validated |

On the KoboFlow side, the import would:

1. Store `sourceId` on each transaction and skip any `sourceId` already present. That makes
   re-imports, retries and offline syncs idempotent.
2. Import only `cash_collected` and the `*_paid` events as transactions. "Sales recorded" stays
   informational.
3. Apply a `voided` event by voiding the matching transaction, through the existing void path.
4. Refuse a file without a schema version, or with duplicate `sourceId`s inside it.
5. Warn when a manual entry on the same date has the same amount as an imported event, because it
   may be the same money.
