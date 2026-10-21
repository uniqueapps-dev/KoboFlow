# KoboFlow
Track Every Kobo. KoboFlow is a financial command center for managing income, expenses, cash flow, obligations, loans, budgets, and financial decisions

## Files

- `koboflow.html` — the candidate app (v3.2): single file, offline-first, IndexedDB storage. Adds Loans & Financial Obligations, the redesigned Opportunity Analyzer, repayment reminders, loan-aware forecasting, and real accounts with opening balances (Settings → Accounts & Opening Balances). Until accounts are set up it runs in demo mode with sample figures.
- Open `koboflow.html?db=test` to use a separate test database (a purple "TEST DATABASE" banner shows). Without `?db=` it uses the real `KoboFlowDB` and upgrades it to v4, after making a verified safety copy (see `docs/bills-and-database-v4.md`); the old v2 `index.html` cannot save to an upgraded database.
- Saved entries can be edited from History and the Financial Inbox (EDIT). The record is changed in place; entries owned by a loan agreement are corrected in Loans. See `docs/transaction-editing.md`.
- `index.html` — the earlier v2 build, left unchanged.

## Tests

```
npm test            # all tests
npm run test:engine # finance engine unit tests (Node only, no dependencies)
npm run test:e2e    # browser tests (needs Playwright + Chromium)
```

The engine tests load the `kobo-finance-engine` script block straight from `koboflow.html`, so they always test the shipped code.
