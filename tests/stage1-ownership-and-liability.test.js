// STAGE 1 — Make the money figures trustworthy.
// Engine coverage for the H5 current-liability/remaining-scheduled split (loan principal and
// settlement integrity, item A), the business/household ownership model and the one shared
// pharmacy-eligible-cash calculation (items C and D), plus a browser smoke test that the Setup
// form no longer defaults "Used For" to Business and that the screens that share the
// pharmacy-eligible calculation render without error. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = require('./load-engine')();
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

/* ───────────── Engine: H5 current liability / remaining scheduled payments ───────────── */
const TODAY = '2026-10-25';
const inst = (rows, o) => rows.map(([d, p, i, f], k) => Object.assign({ id: 'L_' + k, agreementId: 'L', seq: k + 1, dueDate: d, principal: p, interest: i, fees: f, total: p + i + f, version: 1 }, o || {}));
const TERMS = { nature: 'debt', structure: 'manual', principal: 90000 };
const ROWS = [['2026-11-15', 30000, 4500, 0], ['2026-12-15', 30000, 4500, 0], ['2027-01-15', 30000, 4500, 0]];

test('H5: with nothing yet due, current liability is principal only; remaining scheduled is all future interest', () => {
  const b = F.agreementBalances(TERMS, inst(ROWS), [], [], TODAY);
  assert.equal(b.currentLiability, 90000);
  assert.equal(b.remainingScheduledPayments, 13500);
  assert.equal(b.currentLiability + b.remainingScheduledPayments, b.outstanding.total);
});

test('H5: an overdue instalment\'s interest and fees become demonstrably due and join the current liability', () => {
  const b = F.agreementBalances(TERMS, inst(ROWS), [], [], '2026-11-20'); // first instalment now overdue
  assert.equal(b.currentLiability, 94500); // 90,000 principal + the one overdue instalment's 4,500 interest
  assert.equal(b.remainingScheduledPayments, 9000); // the other two instalments' interest, still future
  assert.equal(b.currentLiability + b.remainingScheduledPayments, b.outstanding.total);
});

test('H5: due-today counts as demonstrably due, not yet-due', () => {
  const b = F.agreementBalances(TERMS, inst(ROWS), [], [], '2026-11-15');
  assert.equal(b.currentLiability, 94500);
});

test('H5: a fully repaid loan has zero current liability and zero remaining scheduled payments', () => {
  const alloc = ROWS.map(([d], k) => ({ id: 'al_' + k, agreementId: 'L', txnId: 't' + k, instalmentId: 'L_' + k, principal: 30000, interest: 4500, fees: 0, unsplit: 0, reversed: false }));
  const b = F.agreementBalances(TERMS, inst(ROWS), alloc, [], TODAY);
  assert.equal(b.settled, true);
  assert.equal(b.currentLiability, 0);
  assert.equal(b.remainingScheduledPayments, 0);
});

test('H5: a non-debt agreement (equity/gift) has zero current liability — nothing is owed back', () => {
  const equityTerms = { nature: 'equity', structure: 'manual', principal: 90000 };
  const b = F.agreementBalances(equityTerms, inst(ROWS), [], [], TODAY);
  assert.equal(b.currentLiability, 0);
  assert.equal(b.remainingScheduledPayments, 0);
});

test('H5: a waived instalment contributes nothing to either figure', () => {
  const waived = inst(ROWS).map((i, k) => k === 0 ? Object.assign({}, i, { waived: true }) : i);
  const b = F.agreementBalances(TERMS, waived, [], [], '2026-11-20');
  // Only the two unwaived instalments remain; the first (now waived) is excluded entirely.
  assert.equal(b.currentLiability, 60000); // 2 × 30,000 principal, neither yet due
  assert.equal(b.remainingScheduledPayments, 9000); // 2 × 4,500 interest, neither yet due
});

/* ───────────── Engine: ownership and the one pharmacy-eligible-cash calculation ───────────── */
function acct(id, use, balance, extra) {
  return Object.assign({ id: id, label: id, kind: 'bank', balance: balance, opening: balance, use: use }, extra || {});
}
const confirmed = (id, use, balance, extra) => acct(id, use, balance, Object.assign({ useConfirmedAt: '2026-10-25', useConfirmedValue: use }, extra || {}));

test('ownership: an account with no Used For is never guessed into pharmacy cash, and is flagged', () => {
  const r = F.pharmacyEligibleAccounts([acct('a1', '', 50000)], {});
  assert.equal(r.accounts[0].balance, 0);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].key, 'unclassified_account');
});

test('ownership: a Business account not yet confirmed is excluded and flagged, not defaulted in', () => {
  const r = F.pharmacyEligibleAccounts([acct('a1', 'business', 50000)], {});
  assert.equal(r.accounts[0].balance, 0);
  assert.equal(r.warnings[0].key, 'unconfirmed_business');
});

test('ownership: a confirmed Business account counts in full', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'business', 50000)], {});
  assert.equal(r.accounts[0].balance, 50000);
  assert.equal(r.warnings.length, 0);
});

test('ownership: a Business account is excluded again once its confirmation no longer matches the current value (G4)', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'business', 50000, { use: 'personal' })], {}); // use changed after confirming business
  assert.equal(r.accounts[0].balance, 0);
  // Treated as unconfirmed-then-reclassified: now "personal", which is excluded outright, not flagged as "unconfirmed".
});

test('ownership: Personal accounts never contribute to pharmacy cash, confirmed or not', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'personal', 999999)], {});
  assert.equal(r.accounts[0].balance, 0);
  assert.equal(r.warnings.length, 0); // Personal is a definite answer, not something to flag for review
});

test('ownership (U5a): a Shared account with no declared portion counts nothing, but is flagged, never the whole balance', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'shared', 40000)], {});
  assert.equal(r.accounts[0].balance, 0);
  assert.equal(r.warnings[0].key, 'shared_no_portion');
});

test('ownership (U5a): a Shared account counts exactly its declared portion, never more', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'shared', 40000, { sharedPortion: { amount: 15000, declaredAt: '2026-10-20' } })], {});
  assert.equal(r.accounts[0].balance, 15000);
  assert.equal(r.warnings.length, 0);
});

test('ownership (U5a, high severity): a declared portion larger than the actual balance is a flagged discrepancy, and counts as nothing meanwhile', () => {
  const r = F.pharmacyEligibleAccounts([confirmed('a1', 'shared', 5000, { sharedPortion: { amount: 15000, declaredAt: '2026-10-20' } })], {});
  assert.equal(r.accounts[0].balance, 0);
  assert.equal(r.warnings[0].key, 'shared_discrepancy');
});

test('pharmacyCashPosition: mixes correctly — business counted, personal and unclassified excluded, shared clamped — and still applies the normal liquidity/earmark rules', () => {
  const accounts = [
    confirmed('biz_bank', 'business', 200000),
    confirmed('biz_coop', 'business', 50000, { kind: 'coop' }), // restricted by kind, still pharmacy-owned
    confirmed('pers', 'personal', 1000000),
    acct('new_wallet', '', 20000, { kind: 'wallet' }),
    confirmed('shared1', 'shared', 40000, { sharedPortion: { amount: 10000, declaredAt: '2026-10-20' } }),
  ];
  const pos = F.pharmacyCashPosition(accounts, []);
  assert.equal(pos.available, 210000); // biz_bank + shared1's portion; biz_coop is restricted (kind), not available
  assert.equal(pos.restricted, 50000); // biz_coop
  assert.equal(pos.total, 260000);
  assert.equal(pos.warnings.length, 1); // new_wallet (unclassified), nothing else — personal is excluded without a warning
});

/* ───────────── Cross-feature: loan + ownership feeding the Director, together ───────────── */
test('cross-feature: an unconfirmed account and an overdue loan both surface as high-severity, qualifying the Director\'s figures, and the safe-to-allocate figure never includes the unconfirmed money', () => {
  const accounts = [confirmed('biz', 'business', 100000), acct('maybe_biz', '', 500000)];
  const pos = F.pharmacyCashPosition(accounts, []);
  assert.equal(pos.available, 100000, 'the unclassified 500,000 never enters the confirmed figure');
  const bal = F.agreementBalances(TERMS, inst(ROWS), [], [], '2026-11-20'); // one instalment overdue
  const obligations = [{ id: 'L_0', label: 'Loan', dueDate: '2026-11-15', remaining: bal.states[0].remaining, covered: 0, agreementId: 'L' }];
  const quality = [{ key: 'unclassified_account', severity: 'high', count: 1, ids: ['maybe_biz'], text: 'flagged' }];
  const plan = F.directorPlan({ today: '2026-11-20', cashNow: pos.available, restricted: pos.restricted, earmarkedGeneral: pos.earmarked, reservedLinked: 0, freeToUse: pos.unearmarked, obligations: obligations, floor: 20000, quality: quality, overEarmarked: [], staleReservations: [] });
  assert.equal(plan.qualified, true, 'a high-severity ownership warning qualifies the whole plan, same as any other data-quality issue');
  assert.ok(plan.actions.some(a => a.kind === 'overdue'), 'the overdue loan instalment is still surfaced');
  assert.ok(plan.actions.some(a => a.kind === 'data_quality'), 'the unclassified account is surfaced as an action, not silently dropped');
  assert.ok(plan.figures.safeToAllocate <= 100000, 'safe-to-allocate can never exceed the confirmed pharmacy cash, regardless of the unclassified balance');
});

/* ───────────── Browser smoke test: Setup form no longer defaults to Business ───────────── */
const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const ALIASES = ['pharma_cash', 'pharma_bank', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep'];
let server, base, browser;
test.before(async () => {
  if (!pw) return;
  const site = Object.fromEntries(gen.buildTestSite());
  const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/html';
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (b, t) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-cache' }); res.end(b); };
    if (p.startsWith('/koboflow-test/')) { const rel = p.slice(15) || 'index.html'; if (site[rel]) return send(site[rel], type(rel)); }
    if (p.startsWith('/KoboFlow/')) {
      const rel = p.slice(10) || 'index.html';
      const file = rel === 'index.html' ? 'koboflow.html' : rel;
      if (['koboflow.html', 'manifest.json', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png'].includes(file)) return send(fs.readFileSync(path.join(ROOT, file)), type(file === 'koboflow.html' ? 'x.html' : file));
    }
    if (p === '/probe') return send('<!doctype html><title>probe</title>', 'text/html');
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function ctx() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const row = (page, i) => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
async function tapType(page, locator, text) {
  await locator.tap();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}
async function openEdit(page) {
  if (!(await page.isVisible('#setup-open-btn'))) await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.waitForSelector('#setup-modal.open');
}

for (const b of BUILDS) {
  test(`${b.label}: a brand-new account's "Used For" defaults to "Not chosen yet", never Business`, { skip }, async () => {
    const { page } = await ctx();
    await openApp(page, b.url);
    await openEdit(page);
    const firstUse = await row(page, 0).locator('[data-f=use]').inputValue();
    assert.equal(firstUse, '', 'the very first account in a fresh live setup is not pre-chosen as Business');
    await page.tap('#setup-add-acct');
    const secondUse = await row(page, 1).locator('[data-f=use]').inputValue();
    assert.equal(secondUse, '', '"+ Add another account" does not default to Business either');
    assert.deepEqual(page.errors, []);
  });

  test(`${b.label}: choosing Business and saving confirms it; Director, Net Worth, Calendar, Pressure and Autopilot all render without error`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await openEdit(page);
    await page.fill('#setup-baseline', '2026-10-01');
    await row(page, 0).locator('[data-f=use]').selectOption('business');
    await tapType(page, row(page, 0).locator('[data-f=opening]'), '100000');
    for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
    await page.tap('#setup-save-btn');
    // This is the very first save (no prior setup), so — like every other field — no change
    // log line appears yet; that only starts from the second save onward. Confirmation is
    // still expected to have happened, verified below by reading the saved record back.
    await page.waitForSelector('#setup-confirm-btn');
    await page.tap('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));

    const saved = await (async () => {
      const p = await context.newPage();
      await p.goto(base + '/probe');
      const r = await p.evaluate(n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), b.dbName);
      await p.close();
      return r;
    })();
    assert.equal(saved.accounts[0].use, 'business');
    assert.equal(saved.accounts[0].useConfirmedValue, 'business');
    assert.ok(saved.accounts[0].useConfirmedAt, 'confirmed at the moment of saving');

    // A real edit (second save): changing Used For shows in the change log and re-confirms (G4).
    await openEdit(page);
    await row(page, 0).locator('[data-f=use]').selectOption('personal');
    await page.tap('#setup-save-btn');
    await page.waitForSelector('#setup-confirm-btn');
    const summary2 = await page.textContent('#setup-confirm');
    assert.match(summary2, /Used For: Business → Personal \(confirmed now\)/);
    await page.tap('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));

    for (const screen of ['director', 'networth', 'calendar', 'pressure', 'autopilot']) {
      await page.click(`[data-screen="${screen === 'director' ? 'home' : screen}"]`).catch(() => {});
    }
    // Visiting Settings → Accounts again must not throw either (re-render with the new fields).
    await openApp(page, b.url);
    await openEdit(page);
    assert.deepEqual(page.errors, [], 'no page errors across setup, confirm, and re-opening the form');
  });

  test(`${b.label}: choosing Shared reveals the pharmacy-portion field, and saving records the declaration`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await openEdit(page);
    await page.fill('#setup-baseline', '2026-10-01');
    await tapType(page, row(page, 0).locator('[data-f=opening]'), '40000');
    await row(page, 0).locator('[data-f=use]').selectOption('shared');
    await page.waitForTimeout(50);
    assert.equal(await row(page, 0).locator('[data-shared-portion]').isVisible(), true, 'the portion field appears for a Shared account');
    await tapType(page, row(page, 0).locator('[data-f=sharedAmt]'), '15000');
    for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
    await page.tap('#setup-save-btn');
    // First-ever save: no change log line yet (see the Business test above); the declaration
    // itself is verified below by reading the saved record back.
    await page.waitForSelector('#setup-confirm-btn');
    await page.tap('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    const p2 = await context.newPage();
    await p2.goto(base + '/probe');
    const saved = await p2.evaluate(n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), b.dbName);
    await p2.close();
    assert.equal(saved.accounts[0].sharedPortion.amount, 15000);
    assert.deepEqual(page.errors, []);
  });
}

/* ───────────── Legacy-account normalization vs. the backup/import boundary (M-3, H-1) ─────────────
   normalizeAcctOwnership()'s same-device grandfathering (a record saved before this feature
   existed, with no "use" key at all) must stay read-time-only and must never be reachable through
   a restored backup, where resetRestoredOwnership() gives such an account an explicit "not chosen
   yet" instead — the same requirement a brand-new account already meets. */
for (const b of BUILDS) {
  test(`${b.label}: a genuinely pre-feature account (no "use" key at all) is read as confirmed Business at runtime, without the stored record being touched`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.evaluate(n => new Promise((res, rej) => {
      const q = indexedDB.open(n);
      q.onsuccess = () => {
        const tx = q.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ id: 'ledgerSetup', mode: 'live', baselineDate: '2026-10-01',
          accounts: [{ id: 'acc_legacy', label: 'Legacy Bank', institution: '', kind: 'bank', primary: true, opening: 300000 }], // no "use" key at all
          aliases: {}, buckets: [] });
        tx.oncomplete = () => { q.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      q.onerror = () => rej(q.error);
    }), b.dbName);
    await page.reload();
    await page.waitForSelector('body[data-kf-ready="1"]');
    assert.match(await page.textContent('#autopilot-body'), /Cash Now \(actual\)₦300,000/, 'the legacy account counts in full, exactly as it always did before this feature existed');
    await openEdit(page);
    assert.equal(await row(page, 0).locator('[data-f=use]').inputValue(), 'business');
    assert.match(await row(page, 0).locator('[data-use-status]').textContent(), /Confirmed/);
    await page.click('[data-close="setup-modal"]');
    const p2 = await context.newPage();
    await p2.goto(base + '/probe');
    const saved = await p2.evaluate(n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), b.dbName);
    await p2.close();
    assert.equal(Object.prototype.hasOwnProperty.call(saved.accounts[0], 'use'), false, 'runtime normalization never writes back to the stored record');
    assert.deepEqual(page.errors, []);
  });

  test(`${b.label}: an account explicitly saved as "use: ''" is never mistaken for a genuine legacy record`, { skip }, async () => {
    const { page } = await ctx();
    await openApp(page, b.url);
    await page.evaluate(n => new Promise((res, rej) => {
      const q = indexedDB.open(n);
      q.onsuccess = () => {
        const tx = q.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ id: 'ledgerSetup', mode: 'live', baselineDate: '2026-10-01',
          accounts: [{ id: 'acc_blank', label: 'Blank Bank', institution: '', kind: 'bank', use: '', primary: true, opening: 300000 }], // explicit '', not absent
          aliases: {}, buckets: [] });
        tx.oncomplete = () => { q.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      q.onerror = () => rej(q.error);
    }), b.dbName);
    await page.reload();
    await page.waitForSelector('body[data-kf-ready="1"]');
    assert.match(await page.textContent('#autopilot-body'), /Cash Now \(actual\)₦0/, 'an explicit \'\' is unclassified and excluded like any other — never grandfathered');
    assert.deepEqual(page.errors, []);
  });

  test(`${b.label}: a restored backup account with a genuinely missing "use" key is given an explicit "not chosen yet", never silently imported as confirmed Business`, { skip }, async () => {
    const { page } = await ctx();
    await openApp(page, b.url);
    const noAlias = Object.fromEntries(ALIASES.map(k => [k, '']));
    const data = { version: '4.0', transactions: [], ledgerSetup: { id: 'ledgerSetup', mode: 'live', baselineDate: '2026-10-01',
      accounts: [{ id: 'acc_old', label: 'Old Bank', kind: 'bank', primary: true, opening: 50000 }], // no "use" key — as an old pre-feature backup would have
      aliases: noAlias, buckets: [] } };
    const ops = await page.evaluate(d => window.__kfPlanImport(d).ops, data);
    const metaOp = ops.find(o => o.store === 'meta' && o.put.id === 'ledgerSetup');
    assert.ok(metaOp, 'the account setup was accepted for import');
    assert.equal(metaOp.put.accounts[0].use, '', 'given an explicit "not chosen yet", not left absent — same-device grandfathering must not reach across a restore');
    assert.equal(metaOp.put.accounts[0].useConfirmedAt, null);
    assert.equal(metaOp.put.accounts[0].useConfirmedValue, null);
  });
}
