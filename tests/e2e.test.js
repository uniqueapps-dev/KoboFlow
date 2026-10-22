// End-to-end tests: real Chromium, real IndexedDB, the shipped koboflow.html.
// Requires Playwright (uses a local install, or the global one if present).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}
const pw = loadPlaywright();
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'koboflow.html'));

let server, base, browser;
test.before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/koboflow.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HTML); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const opts = fs.existsSync('/opt/pw-browsers/chromium') ? {} : {};
  browser = await pw.chromium.launch(opts);
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const skip = !pw && 'Playwright not installed';

async function newPage(ctx) {
  const context = ctx || await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  // No network beyond the local server: proves the app does not depend on it.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.dialogs = [];
  page.answers = [];
  page.on('dialog', async d => {
    page.dialogs.push({ type: d.type(), message: d.message() });
    const a = page.answers.length ? page.answers.shift() : true;
    if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : undefined);
  });
  return { context, page };
}
// Poll a Node-side condition (e.g. a dialog the page raised) instead of sleeping.
async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Timed out waiting for: ' + what);
}
// Wait until the app has no save in flight, so a late duplicate write would already be visible.
const idle = page => page.waitForFunction(() => !window.__kfSaving);
async function open(page) {
  await page.goto(base + '/koboflow.html');
  await page.waitForSelector('body[data-kf-ready="1"]');
}
const dbAll = (page, store) => page.evaluate(s => new Promise((res, rej) => {
  const r = indexedDB.open('KoboFlowDB');
  r.onsuccess = () => { const db = r.result; const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = rej; };
  r.onerror = rej;
}), store);
const dbVersion = page => page.evaluate(() => new Promise(res => { const r = indexedDB.open('KoboFlowDB'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; }));
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const acctBal = (page, label) => page.$$eval('.acct-card', (cards, l) => {
  const c = cards.find(x => x.querySelector('.acct-name').textContent.includes(l));
  return c ? Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, '')) : null;
}, label);
const plusDays = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);

async function createEasiMoni(page, { received = true, account = 'pharma_bank' } = {}) {
  await nav(page, 'loans');
  await page.click('#new-agr-btn');
  // Wait until the form has finished sliding open. Precaution: one full run once missed the "already
  // received" tick with "element is not stable"; the cause was not reproduced, see the commit message.
  await page.waitForFunction(() => document.getElementById('agr-modal').classList.contains('open') && document.querySelector('#agr-modal .modal-box').getAnimations().every(a => a.playState === 'finished'));
  await page.fill('#agr-name', 'EasiMoni Test');
  await page.fill('#agr-counterparty', 'EasiMoni');
  await page.fill('#agr-principal', '150000');
  await page.fill('#agr-cash', '150000');
  await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, 30));
  await page.fill('#agr-inst', '55455');
  if (received) {
    await page.check('#agr-funds-received');
    if (account) await page.selectOption('#agr-account', account);
    else page.defaultAccount = await page.$eval('#agr-account', s => s.options[s.selectedIndex].text);
  }
  await page.waitForSelector('#agr-preview .sched');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#screen-agreement.active');
}

test('existing v2 data survives the upgrade to v4, after a verified safety copy is made', { skip }, async () => {
  const { context, page } = await newPage();
  await page.goto(base + '/blank');
  // Build the exact v2 database the previous release created, with two real records.
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('KoboFlowDB', 2);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      ['transactions', 'loans', 'vlogs', 'ownerAnalytics', 'cashFlowSnapshots', 'roiSnapshots', 'runwaySnapshots'].forEach(n => {
        const s = db.createObjectStore(n, { keyPath: 'id', autoIncrement: true });
        if (n === 'transactions') { s.createIndex('type', 'type'); s.createIndex('date', 'date'); s.createIndex('state', 'state'); }
      });
    };
    r.onsuccess = () => {
      const tx = r.result.transaction('transactions', 'readwrite');
      tx.objectStore('transactions').add({ amount: 4321, desc: 'Old real entry one', cat: 'Food', type: 'expense', fromAcct: 'pers_cash', toAcct: '', state: 'AI Categorized', date: '2026-09-01', time: '10:00' });
      tx.objectStore('transactions').add({ amount: 98765, desc: 'Old real sales', cat: 'Pharmacy Sales', type: 'income', fromAcct: '', toAcct: 'pharma_cash', state: 'AI Categorized', date: '2026-09-02', time: '18:00' });
      tx.oncomplete = () => { r.result.close(); res(); };
      tx.onerror = rej;
    };
  }));
  await open(page);
  assert.equal(await dbVersion(page), 4);
  const txs = await dbAll(page, 'transactions');
  assert.equal(txs.length, 2, 'no records lost or duplicated');
  assert.deepEqual(txs.map(t => t.id).sort(), [1, 2]);
  // The safety copy keeps the v2 layout and the same two records.
  const copies = await page.evaluate(() => indexedDB.databases().then(d => d.filter(x => /^KoboFlowDB-pre-v4-/.test(x.name))));
  assert.equal(copies.length, 1);
  assert.equal(copies[0].version, 2);
  const copyTx = await page.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), copies[0].name);
  assert.deepEqual(copyTx.map(t => t.desc).sort(), ['Old real entry one', 'Old real sales']);
  for (const s of ['agreements', 'instalments', 'allocations', 'agreementEvents', 'opportunities', 'meta', 'bills']) assert.ok(Array.isArray(await dbAll(page, s)));
  // id 1 used to be hidden behind sample record #1; it must now be visible.
  await nav(page, 'timeline');
  const tl = await page.textContent('#timeline-list');
  assert.match(tl, /Old real entry one/);
  assert.match(tl, /Old real sales/);
  // Stored transactions now move balances from the opening figure.
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Pharmacy Cash'), 185000 + 98765);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('loan receipt, payment (double-tap), reversal and restart', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  const bank0 = await acctBal(page, 'Pharmacy Bank');
  const income0 = await page.textContent('#ana-in');
  await createEasiMoni(page);

  // Receipt: cash up, liability recorded, not income.
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Pharmacy Bank'), bank0 + 150000);
  assert.equal(await page.textContent('#ana-in'), income0, 'loan proceeds are not income');
  await nav(page, 'loans');
  assert.match(await page.textContent('#loan-summary'), /221,820/);
  let txs = await dbAll(page, 'transactions');
  assert.equal(txs.filter(t => t.type === 'loan_receipt').length, 1);
  assert.equal((await dbAll(page, 'instalments')).length, 4);

  // Payment, tapped twice.
  await page.click('#loan-active .agr-card');
  await page.click('[data-act="pay"]');
  assert.equal(await page.inputValue('#pay-amount'), '55455');
  await page.dblclick('#pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
  await page.click('#pay-save-btn', { force: true }).catch(() => {});
  await idle(page);
  txs = await dbAll(page, 'transactions');
  const pays = txs.filter(t => t.type === 'loan_repayment');
  assert.equal(pays.length, 1, 'double tap must not create two payments');
  assert.equal(pays[0].alloc.interest + pays[0].alloc.principal, 55455);
  assert.equal((await dbAll(page, 'allocations')).length, 1);
  assert.match(await page.textContent('#agr-detail'), /166,365/);
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Pharmacy Bank'), bank0 + 150000 - 55455, 'one outflow only');

  // Interest is a finance cost; principal is not spending.
  await nav(page, 'analytics');
  assert.match(await page.textContent('#cat-breakdown'), /Loan Interest & Fees/);
  assert.match(await page.textContent('#cat-breakdown'), /17,955/);

  // Reverse it: liability and cash restored; the record stays, marked voided.
  await nav(page, 'loans');
  await page.click('#loan-active .agr-card');
  page.answers.push('Entered on wrong loan', true);
  await page.click('#agr-detail .tl-item:has-text("Loan repayment") [data-reverse]');
  await page.waitForFunction(() => /Reversed: Entered on wrong loan/.test(document.getElementById('agr-detail').textContent));
  assert.match(await page.textContent('#agr-detail'), /Outstanding₦221,820/);
  txs = await dbAll(page, 'transactions');
  const voided = txs.find(t => t.type === 'loan_repayment');
  assert.equal(voided.voided, true);
  assert.equal(voided.voidReason, 'Entered on wrong loan');
  assert.ok((await dbAll(page, 'allocations')).every(a => a.reversed));
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Pharmacy Bank'), bank0 + 150000);

  // Restart: everything comes back from IndexedDB.
  await page.reload();
  await page.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await acctBal(page, 'Pharmacy Bank'), bank0 + 150000);
  await nav(page, 'loans');
  assert.match(await page.textContent('#loan-active'), /EasiMoni Test/);
  const ev = (await dbAll(page, 'agreementEvents')).map(e => e.type).sort();
  assert.deepEqual(ev, ['created', 'funds_received', 'payment', 'payment_reversed']);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('early settlement with lender figure, then agreement is settled', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await createEasiMoni(page);
  await page.click('[data-act="settle"]');
  await page.fill('#settle-amount', '160000');
  await page.fill('#settle-reason', 'Payoff quote in app');
  await page.waitForSelector('#settle-preview .form-ok');
  assert.match(await page.textContent('#settle-preview'), /61,820/);
  await page.click('#settle-save-btn');
  await page.waitForFunction(() => /Settled/.test(document.querySelector('#agr-detail .screen-sub').textContent));
  const inst = await dbAll(page, 'instalments');
  assert.equal(inst.filter(i => i.waived).length > 0, true);
  const agr = (await dbAll(page, 'agreements'))[0];
  assert.equal(agr.status, 'settled');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('accepted-but-unfunded agreement records no cash; funds confirmation is idempotent', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  const bank0 = await acctBal(page, 'Pharmacy Bank');
  await createEasiMoni(page, { received: false });
  assert.match(await page.textContent('#agr-detail .screen-sub'), /awaiting funds/i);
  assert.equal((await dbAll(page, 'transactions')).length, 0);
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Pharmacy Bank'), bank0);
  await nav(page, 'loans');
  await page.click('#loan-awaiting .agr-card');
  await page.click('[data-act="funds"]');
  await page.dblclick('#funds-save-btn');
  await page.waitForFunction(() => /Active/.test(document.querySelector('#agr-detail .screen-sub').textContent));
  await idle(page);
  assert.equal((await dbAll(page, 'transactions')).filter(t => t.type === 'loan_receipt').length, 1);
  assert.match(await page.textContent('#agr-detail .screen-sub'), /Active/);
  await context.close();
});

test('opportunity analysis → accept twice → exactly one agreement; decline records nothing', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await nav(page, 'opportunity');
  await page.fill('#opp-name', 'EasiMoni offer');
  await page.fill('#opp-received', '150000');
  await page.selectOption('#opp-structure', 'fixed_total');
  await page.fill('#opp-inst', '55455');
  await page.fill('#opp-count', '4');
  await page.fill('#opp-first-due', await plusDays(page, 30));
  await page.fill('#opp-profit', '90000');
  await page.click('#opp-calc-btn');
  const res = await page.textContent('#opp-result');
  assert.match(res, /\+₦18,180/);
  assert.match(res, /₦71,820/);
  assert.match(res, /REVIEW/);
  assert.match(res, /47\.88%/);
  assert.equal((await dbAll(page, 'transactions')).length, 0, 'analysis never touches the ledger');
  assert.equal((await dbAll(page, 'agreements')).length, 0);

  await page.click('[data-opp-act="accept"]');
  await page.waitForSelector('#agr-modal.open');
  assert.equal(await page.inputValue('#agr-inst'), '55455');
  assert.equal(await page.isChecked('#agr-funds-received'), false, 'acceptance is not proof of funds');
  await page.fill('#agr-counterparty', 'EasiMoni');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#screen-agreement.active');
  await nav(page, 'opportunity');
  await page.click('[data-opp-act="accept"]');
  await page.waitForSelector('#screen-agreement.active');
  const agrs = await dbAll(page, 'agreements');
  assert.equal(agrs.length, 1);
  assert.ok(agrs[0].opportunityId);
  assert.equal((await dbAll(page, 'opportunities'))[0].status, 'accepted');
  assert.equal((await dbAll(page, 'transactions')).length, 0);

  // A second, separate opportunity, declined: no liability, no cash.
  await nav(page, 'opportunity');
  await page.click('#opp-new-btn');
  assert.equal(await page.inputValue('#opp-name'), '');
  await page.fill('#opp-name', 'Expensive app loan');
  await page.fill('#opp-received', '100000');
  await page.fill('#opp-total', '160000');
  await page.fill('#opp-count', '2');
  await page.fill('#opp-first-due', await plusDays(page, 14));
  await page.fill('#opp-profit', '20000');
  await page.click('#opp-calc-btn');
  assert.match(await page.textContent('#opp-result'), /BAD DEAL/);
  await page.click('[data-opp-act="decline"]');
  await page.waitForFunction(() => /Declined/.test(document.getElementById('opp-saved').textContent));
  const opps = await dbAll(page, 'opportunities');
  assert.equal(opps.length, 2);
  assert.equal(opps.find(o => o.name === 'Expensive app loan').status, 'declined');
  assert.equal((await dbAll(page, 'agreements')).length, 1);
  assert.equal((await dbAll(page, 'transactions')).length, 0);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('supplier credit is never turned into a KoboFlow debt', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await nav(page, 'opportunity');
  await page.fill('#opp-name', 'Emzor consignment');
  await page.selectOption('#opp-type', 'supplier');
  await page.selectOption('#opp-receive-type', 'stock');
  await page.fill('#opp-received', '300000');
  await page.selectOption('#opp-structure', 'settle_after_sale');
  await page.fill('#opp-settle', '300000');
  await page.click('#opp-calc-btn');
  assert.equal(await page.isDisabled('[data-opp-act="accept"]'), true);
  assert.match(await page.textContent('#opp-result'), /PBSRx/);
  await context.close();
});

test('export then import is lossless and repeat imports add nothing', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await createEasiMoni(page);
  await page.click('[data-act="pay"]');
  await page.click('#pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  await page.click('#settings-nav-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')]);
  const file = await dl.path();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(backup.version, '4.0');
  assert.equal(backup.ledgerSetup, null, 'demo mode exports no account setup');
  assert.ok(backup.transactions.every(t => !t.demo), 'sample data is not exported');

  // Same device: importing again changes nothing.
  page.dialogs.length = 0;
  await page.setInputFiles('#import-file-input', file);
  await until(() => page.dialogs.some(d => /Nothing new to import/.test(d.message)), 'the "Nothing new to import" message');
  assert.equal((await dbAll(page, 'transactions')).length, 3);

  // Fresh device: restore, links intact, then a repeat import is a no-op.
  const fresh = await newPage();
  await open(fresh.page);
  await fresh.page.click('#settings-nav-btn');
  await fresh.page.setInputFiles('#import-file-input', file);
  await fresh.page.waitForFunction(() => document.getElementById('agr-store-count').textContent === '1');
  const txs = await dbAll(fresh.page, 'transactions');
  const allocs = await dbAll(fresh.page, 'allocations');
  const inst = await dbAll(fresh.page, 'instalments');
  assert.equal(txs.length, 3);
  assert.equal(inst.length, 4);
  assert.ok(allocs.every(a => txs.some(t => t.id === a.txnId) && inst.some(i => i.id === a.instalmentId)));
  fresh.page.dialogs.length = 0;
  await fresh.page.setInputFiles('#import-file-input', file);
  await until(() => fresh.page.dialogs.some(d => /Nothing new to import/.test(d.message)), 'repeat import to be refused as a no-op');
  assert.equal((await dbAll(fresh.page, 'transactions')).length, 3);
  await nav(fresh.page, 'loans');
  assert.match(await fresh.page.textContent('#loan-summary'), /166,365/);
  assert.deepEqual(fresh.page.errors, []);
  await fresh.context.close();
  await context.close();
});

test('existing features still work: capture persists, every screen renders, no network needed', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await page.fill('#capture-input', '15000 fuel green');
  await page.press('#capture-input', 'Enter');
  await page.fill('#capture-input', '700000 loan received');
  await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => new Promise(res => { const r = indexedDB.open('KoboFlowDB'); r.onsuccess = () => { const q = r.result.transaction('transactions').objectStore('transactions').count(); q.onsuccess = () => { r.result.close(); res(q.result === 2); }; }; }));
  await page.reload();
  await page.waitForSelector('body[data-kf-ready="1"]');
  const txs = await dbAll(page, 'transactions');
  assert.equal(txs.length, 2);
  assert.equal(txs.find(t => /loan/.test(t.desc)).type, 'loan_receipt');
  await nav(page, 'loans');
  assert.match(await page.textContent('#loan-unlinked'), /without an agreement/);
  for (const sc of await page.$$eval('.nav-btn', bs => bs.map(b => b.dataset.screen))) {
    await nav(page, sc);
    assert.ok(await page.isVisible(`#screen-${sc}`), sc + ' visible');
  }
  // Owner/Restock/Cash-flow screens now sit inside the scrolling area.
  assert.equal(await page.$$eval('#main > #screen-cashflow', x => x.length), 1);
  assert.match(await page.textContent('#screen-restockroi'), /not a return on investment/);
  assert.deepEqual(page.errors, []);
  await context.close();
});

async function fillSetup(page, { baseline, opay = '500000', gtb = '80000', rent = '150000', mapAll = true }) {
  await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', baseline);
  const row0 = page.locator('#setup-accounts [data-acct-row="0"]');
  assert.equal(await row0.locator('[data-f="label"]').inputValue(), 'Opay', 'Opay is offered explicitly');
  assert.equal(await row0.locator('[data-f="primary"]').isChecked(), true);
  await row0.locator('[data-f="opening"]').fill(opay);
  await page.click('#setup-add-acct');
  const row1 = page.locator('#setup-accounts [data-acct-row="1"]');
  await row1.locator('[data-f="label"]').fill('GTBank Personal');
  await row1.locator('[data-f="kind"]').selectOption('bank');
  await row1.locator('[data-f="use"]').selectOption('personal');
  await row1.locator('[data-f="opening"]').fill(gtb);
  await row1.locator('[data-f="opening"]').blur();
  await page.click('#setup-add-bucket');
  const b0 = page.locator('#setup-buckets [data-bucket-row="0"]');
  await b0.locator('[data-f="label"]').fill('Rent');
  await b0.locator('[data-f="parentId"]').selectOption('acc_opay');
  await b0.locator('[data-f="amount"]').fill(rent);
  if (mapAll) {
    const gtbId = await page.$eval('#setup-aliases [data-alias="pers_cash"]', s => [...s.options].find(o => o.text === 'GTBank Personal').value);
    const map = { pharma_cash: 'acc_opay', pharma_bank: 'acc_opay', pers_cash: gtbId, pers_bank: gtbId, coop: '', emergency: '', fixed_dep: '' };
    for (const [k, v] of Object.entries(map)) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, v);
  }
}

test('live setup: Opay as primary, real opening balances, earmarks not double-counted, sample data kept apart', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  assert.match(await page.textContent('#mode-note'), /Demo mode/);
  // A real entry recorded before going live, dated before the baseline.
  await page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('KoboFlowDB'); r.onsuccess = () => { const t = r.result.transaction('transactions', 'readwrite'); t.objectStore('transactions').put({ id: 5000, amount: 7000, desc: 'Old expense', cat: 'Food', type: 'expense', fromAcct: 'pharma_bank', toAcct: '', state: 'AI Categorized', date: '2026-01-05', time: '09:00' }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = rej; }; }));
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  const baseline = await plusDays(page, -3);

  // Required mapping is enforced: nothing is silently assigned.
  await fillSetup(page, { baseline, mapAll: false });
  await page.click('#setup-save-btn');
  assert.match(await page.textContent('#setup-preview'), /Choose where "Pharmacy Bank" entries belong/);
  assert.match(await page.textContent('#setup-result'), /Not saved yet/);
  assert.equal(await page.isVisible('#setup-confirm-btn'), false, 'no confirmation offered for an invalid setup');
  assert.equal(await page.isVisible('#setup-modal.open'), true);
  await page.click('[data-close="setup-modal"]');
  // Closing does not silently discard the edits: reopening shows them, marked unsaved.
  await page.click('#setup-open-btn');
  assert.match(await page.textContent('#setup-unsaved-note'), /Unsaved changes\. These edits from earlier have NOT been saved/);
  assert.equal(await page.inputValue('#setup-baseline'), baseline);
  await page.click('#setup-discard-btn'); // explicit choice to start again from the saved state
  assert.equal(await page.isVisible('#setup-unsaved-note'), false);
  assert.equal(await page.$$eval('#setup-accounts [data-acct-row]', r => r.length), 1, 'discard shows the saved (default) setup');
  await page.click('[data-close="setup-modal"]');

  await fillSetup(page, { baseline });
  assert.match(await page.textContent('#setup-preview'), /before the baseline/);
  await page.click('#setup-save-btn');
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => document.body.classList.contains('kf-live'));
  const setup = (await dbAll(page, 'meta')).find(m => m.id === 'ledgerSetup');
  assert.equal(setup.accounts[0].label, 'Opay');
  assert.equal(setup.accounts[0].primary, true);
  assert.equal(setup.baselineDate, baseline);

  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 500000, 'pre-baseline entry already inside the opening balance');
  assert.equal(await acctBal(page, 'GTBank Personal'), 80000);
  assert.equal(await acctBal(page, 'Pharmacy Bank'), null, 'no sample accounts in live mode');
  assert.match(await page.textContent('#bucket-list'), /Rent ₦150,000.*Free to use ₦350,000/);
  assert.match(await page.textContent('#autopilot-body'), /Cash Now \(actual\)₦580,000/, 'earmark not added on top');
  assert.equal(await page.textContent('#mode-note'), '');
  await nav(page, 'timeline');
  assert.doesNotMatch(await page.textContent('#timeline-list'), /Restock Emzor/, 'sample entries hidden');
  assert.match(await page.textContent('#timeline-list'), /Old expense/, 'real history kept');
  await nav(page, 'calendar');
  assert.doesNotMatch(await page.textContent('#calendar-list'), /IBEDC|Shop Rent/, 'sample bills excluded from forecast');

  // Quick capture goes where the user mapped it; a loan lands in the chosen account.
  await page.fill('#capture-input', '2500 lunch');
  await page.press('#capture-input', 'Enter');
  await page.fill('#capture-input', '150000 restock emzor');
  await page.press('#capture-input', 'Enter');
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'GTBank Personal'), 80000 - 2500);
  assert.equal(await acctBal(page, 'Opay'), 500000 - 150000);
  await createEasiMoni(page, { account: null });
  assert.match(page.defaultAccount, /^Opay/, 'receipt account defaults to the primary account and is shown before saving');
  const rec = (await dbAll(page, 'transactions')).find(t => t.type === 'loan_receipt');
  assert.equal(rec.toAcct, 'acc_opay', 'form defaults to the primary account, shown to the user before saving');
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 500000 - 150000 + 150000);

  // Survives restart.
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await acctBal(page, 'Opay'), 500000);
  // Backup carries the account setup; a fresh device restores live mode with Opay.
  await page.click('#settings-nav-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')]);
  const file = await dl.path();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ledgerSetup.accounts[0].label, 'Opay');
  const fresh = await newPage();
  await open(fresh.page);
  await fresh.page.click('#settings-nav-btn');
  await fresh.page.setInputFiles('#import-file-input', file);
  await fresh.page.waitForFunction(() => document.body.classList.contains('kf-live'));
  await nav(fresh.page, 'home');
  assert.equal(await acctBal(fresh.page, 'Opay'), 500000);
  assert.equal(await acctBal(fresh.page, 'GTBank Personal'), 80000 - 2500);
  await fresh.context.close();
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('?db=test uses a separate database and never touches the real one', { skip }, async () => {
  const { context, page } = await newPage();
  await page.goto(base + '/koboflow.html?db=test');
  await page.waitForSelector('body[data-kf-ready="1"]');
  assert.match(await page.textContent('#db-banner'), /TEST DATABASE "test"/);
  await createEasiMoni(page);
  const names = await page.evaluate(() => indexedDB.databases().then(d => d.map(x => x.name)));
  assert.ok(names.includes('KoboFlowDB-test'));
  assert.ok(!names.includes('KoboFlowDB'), 'real database not even created');
  await open(page);
  assert.equal(await page.isVisible('#db-banner'), false);
  assert.equal((await dbAll(page, 'agreements')).length, 0);
  await context.close();
});

test('partial payment, correction, schedule amendment and cash-flow screen stay consistent', { skip }, async () => {
  const { context, page } = await newPage();
  await open(page);
  await fillSetup(page, { baseline: await plusDays(page, -1) });   // live mode: no sample entries in the figures
  await page.click('#setup-save-btn');
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => document.body.classList.contains('kf-live'));
  await createEasiMoni(page, { account: null });
  await page.click('[data-act="pay"]');
  await page.fill('#pay-amount', '30000');
  await page.click('#pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
  assert.match(await page.textContent('#agr-detail'), /Partially paid/);
  // Correct it to 35,000: one live entry, the old one voided, nothing duplicated.
  await page.click('#agr-detail [data-correct]');
  await page.fill('#pay-amount', '35000');
  await page.click('#pay-save-btn');
  await page.waitForFunction(() => /Outstanding₦186,820/.test(document.getElementById('agr-detail').textContent));
  await idle(page);
  const reps = (await dbAll(page, 'transactions')).filter(t => t.type === 'loan_repayment');
  assert.equal(reps.length, 2);
  assert.equal(reps.filter(t => !t.voided).length, 1);
  assert.equal(reps.find(t => !t.voided).amount, 35000);
  assert.equal((await dbAll(page, 'allocations')).filter(a => !a.reversed).length, 1);
  // Amend: lender reschedules the three untouched instalments into two.
  await page.click('[data-act="amend"]');
  const d1 = await plusDays(page, 70), d2 = await plusDays(page, 100);
  await page.fill('#amend-rows', `${d1} 60000 20000 0\n${d2} 52500 20000 0`);
  await page.fill('#amend-reason', 'Lender rescheduled');
  await page.click('#amend-save-btn');
  await page.waitForFunction(() => /Schedule amended/.test(document.getElementById('agr-detail').textContent));
  const inst = await dbAll(page, 'instalments');
  assert.equal(inst.filter(i => i.supersededBy).length, 3, 'old rows kept, marked replaced');
  assert.equal(inst.filter(i => !i.supersededBy).length, 3);
  assert.match(await page.textContent('#agr-detail'), /Outstanding₦172,955/);
  // Historical cash flow shows actual cash only: +150,000 proceeds, −35,000 repaid.
  await nav(page, 'cashflow');
  const finText = await page.textContent('#cf-financing');
  assert.match(finText, /Loan proceeds received\+₦150,000/);
  assert.match(finText, /Loan principal repaid-₦17,045/);
  assert.match(finText, /Loan interest & fees paid-₦17,955/);
  const fin = await page.textContent('#cf-fin-total');
  assert.equal(fin, '+₦115,000');
  assert.deepEqual(page.errors, []);
  await context.close();
});

// Models Android viewers that suppress native dialogs: confirm() always "cancels".
async function blockDialogs(context) {
  await context.addInitScript(() => { window.confirm = () => false; window.prompt = () => null; window.alert = () => {}; });
}

test('account setup saves with native dialogs blocked, and every field survives close and reopen', { skip }, async () => {
  const { context, page } = await newPage();
  await blockDialogs(context);
  await open(page);
  const baseline = await plusDays(page, 0);
  await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.fill('#setup-baseline', baseline);
  await page.locator('#setup-accounts [data-acct-row="0"] [data-f="opening"]').fill('500000');
  await page.click('#setup-add-acct');
  const r1 = page.locator('#setup-accounts [data-acct-row="1"]');
  await r1.locator('[data-f="label"]').fill('Test Bank');
  await r1.locator('[data-f="kind"]').selectOption('bank');
  await r1.locator('[data-f="opening"]').fill('100000');
  await r1.locator('[data-f="opening"]').blur();
  await page.click('#setup-add-bucket');
  const b0 = page.locator('#setup-buckets [data-bucket-row="0"]');
  await b0.locator('[data-f="label"]').fill('Test Rent');
  await b0.locator('[data-f="parentId"]').selectOption('acc_opay');
  await b0.locator('[data-f="amount"]').fill('50000');
  await page.selectOption('#setup-aliases [data-alias="pharma_bank"]', 'acc_opay');
  for (const k of ['pharma_cash', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep']) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, '');
  assert.match(await page.textContent('#setup-preview'), /Total real money₦600,000/);

  // Step 1 only reviews: nothing is written yet.
  await page.click('#setup-save-btn');
  assert.equal(await page.isVisible('#setup-confirm-btn'), true);
  assert.equal((await dbAll(page, 'meta')).some(m => m.id === 'ledgerSetup'), false, 'review step writes nothing');
  assert.match(await page.textContent('#setup-confirm'), /Test Rent \(inside Opay\)₦50,000/);
  // Editing after review cancels the pending confirmation.
  await r1.locator('[data-f="opening"]').fill('100000');
  assert.equal(await page.isVisible('#setup-confirm-btn'), false);
  await page.click('#setup-save-btn');
  // Step 2 writes, reads back, closes.
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => document.body.classList.contains('kf-live'));
  assert.equal(await page.isVisible('#setup-modal.open'), false);

  // Close the app completely and open it again.
  await page.close();
  const again = await context.newPage();
  again.errors = []; again.on('pageerror', e => again.errors.push(e.message));
  await again.goto(base + '/koboflow.html');
  await again.waitForSelector('body[data-kf-ready="1"]');
  const st = (await dbAll(again, 'meta')).find(m => m.id === 'ledgerSetup');
  assert.equal(st.baselineDate, baseline);
  assert.deepEqual(st.accounts.map(a => [a.label, a.kind, a.use, a.opening, a.primary]), [['Opay', 'wallet', 'business', 500000, true], ['Test Bank', 'bank', 'business', 100000, false]]);
  assert.deepEqual(st.buckets.map(b => [b.label, b.parentId, b.amount]), [['Test Rent', 'acc_opay', 50000]]);
  assert.deepEqual(st.aliases, { pharma_bank: 'acc_opay', pharma_cash: '', pers_cash: '', pers_bank: '', coop: '', emergency: '', fixed_dep: '' });
  await nav(again, 'home');
  assert.equal(await acctBal(again, 'Opay'), 500000);
  assert.equal(await acctBal(again, 'Test Bank'), 100000);
  assert.match(await again.textContent('#bucket-list'), /Test Rent ₦50,000.*Free to use ₦450,000/);
  // The form reopens with every saved value.
  await again.click('#settings-nav-btn');
  assert.match(await again.textContent('#setup-status-label'), /Live since/);
  await again.click('#storage-check-btn');
  await again.waitForFunction(() => /Account setup saved: yes, 2 account/.test(document.getElementById('storage-check-out').textContent));
  await again.click('#setup-open-btn');
  assert.equal(await again.inputValue('#setup-baseline'), baseline);
  assert.equal(await again.locator('#setup-accounts [data-acct-row="0"] [data-f="opening"]').inputValue(), '500000');
  assert.equal(await again.locator('#setup-accounts [data-acct-row="1"] [data-f="label"]').inputValue(), 'Test Bank');
  assert.equal(await again.locator('#setup-buckets [data-bucket-row="0"] [data-f="amount"]').inputValue(), '50000');
  assert.equal(await again.inputValue('#setup-aliases [data-alias="pharma_bank"]'), 'acc_opay');
  for (const k of ['pharma_cash', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep']) assert.equal(await again.inputValue(`#setup-aliases [data-alias="${k}"]`), '', k + ' stays "Not used"');
  assert.deepEqual(again.errors, []);
  await context.close();
});

test('a blocked native dialog elsewhere is reported on screen instead of failing silently', { skip }, async () => {
  const { context, page } = await newPage();
  await blockDialogs(context);
  await open(page);
  await nav(page, 'loans');
  await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Blocked'); await page.fill('#agr-counterparty', 'X');
  await page.fill('#agr-principal', '1000'); await page.fill('#agr-count', '1');
  await page.fill('#agr-first', await plusDays(page, 30)); await page.fill('#agr-inst', '1100');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  assert.match(await page.textContent('#dialog-warning'), /blocked a confirmation dialog.*NOT saved/);
  assert.equal((await dbAll(page, 'agreements')).length, 0);
  await context.close();
});
