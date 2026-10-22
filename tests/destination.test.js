// Destination / source tracking: paidTo (where money went) and receivedFrom (where it came from) are names
// only. They never move money, never become accounts and never change a report; transfers keep two real
// accounts. Covers Add Entry, quick entry "@", editing (review / back / cancel / confirm), bills, loans,
// History search and the inclusive date range, duplicate warnings, import and CSV.
// Engine checks run in Node; screen checks run on the TEST site and the production candidate. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = require('./load-engine.js')();
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

// ── Engine ──────────────────────────────────────────────────────────────────────────────────────

const ACCTS = [{ id: 'opay', opening: 100000 }, { id: 'bank', opening: 500000 }, { id: 'coop', opening: 80000 }];
const SAMPLE = [
  { id: 1, type: 'expense', amount: 5000, date: '2026-10-01', fromAcct: 'opay', toAcct: '', cat: 'Vehicle: FJR1300AE', desc: 'FJR fuel' },
  { id: 2, type: 'obligation', amount: 7000, date: '2026-10-01', fromAcct: 'opay', toAcct: '', cat: 'Utilities', desc: 'Electricity' },
  { id: 3, type: 'owner_withdrawal', amount: 6000, date: '2026-10-02', fromAcct: 'bank', toAcct: 'opay', cat: 'Owner Withdrawal', desc: 'Draw' },
  { id: 4, type: 'investment', amount: 20000, date: '2026-10-02', fromAcct: 'bank', toAcct: 'coop', cat: 'Investment', desc: 'Deposit' },
  { id: 5, type: 'income', amount: 9000, date: '2026-10-03', fromAcct: '', toAcct: 'opay', cat: 'Pharmacy Sales', desc: 'Sales' },
  { id: 6, type: 'capital_injection', amount: 15000, date: '2026-10-03', fromAcct: '', toAcct: 'bank', cat: 'Capital Injection', desc: 'Capital', fundingKind: 'capital_injection' },
  { id: 7, type: 'loan_repayment', amount: 55455, date: '2026-10-04', fromAcct: 'opay', toAcct: '', cat: 'Loan Repayment', desc: 'Repayment', agreementId: 'agr_1', alloc: { principal: 37500, interest: 17955, fees: 0, unsplit: 0 } },
  { id: 8, type: 'loan_receipt', amount: 150000, date: '2026-10-04', fromAcct: '', toAcct: 'opay', cat: 'Loan Proceeds', desc: 'Loan received', agreementId: 'agr_1' },
  { id: 9, type: 'transfer', amount: 10000, date: '2026-10-05', fromAcct: 'opay', toAcct: 'bank', cat: 'Savings', desc: 'Move' },
];
const withNames = SAMPLE.map(t => {
  const f = F.partyField(t.type);
  return f ? Object.assign({}, t, { [f]: 'Fictional Party ' + t.id }) : Object.assign({}, t);
});

test('engine: names never change balances, classification or cash flow, for every type', () => {
  assert.deepEqual(F.accountBalances(ACCTS, withNames, {}), F.accountBalances(ACCTS, SAMPLE, {}));
  assert.deepEqual(F.accountBalances(ACCTS, withNames, { baselineDate: '2026-10-02' }), F.accountBalances(ACCTS, SAMPLE, { baselineDate: '2026-10-02' }));
  withNames.forEach((t, i) => assert.deepEqual(F.classifyTxn(t), F.classifyTxn(SAMPLE[i]), t.type));
  assert.deepEqual(F.cashFlowSummary(withNames, '2026-10-01', '2026-11-01'), F.cashFlowSummary(SAMPLE, '2026-10-01', '2026-11-01'));
  // Even a name that is exactly an account id moves nothing.
  const sneaky = [Object.assign({}, SAMPLE[0], { paidTo: 'bank' }), Object.assign({}, SAMPLE[4], { receivedFrom: 'coop' })];
  assert.deepEqual(F.accountBalances(ACCTS, sneaky, {}), F.accountBalances(ACCTS, [SAMPLE[0], SAMPLE[4]], {}));
  assert.deepEqual(F.accountBalances(ACCTS, sneaky, {}), { opay: 104000, bank: 500000, coop: 80000 });
});

test('engine: which types carry which name; cleaning, length limit and normalised matching', () => {
  assert.deepEqual(['expense', 'obligation', 'owner_withdrawal', 'investment', 'loan_repayment'].map(F.partyField), Array(5).fill('paidTo'));
  assert.deepEqual(['income', 'capital_injection', 'loan_receipt'].map(F.partyField), Array(3).fill('receivedFrom'));
  assert.equal(F.partyField('transfer'), null, 'a transfer has two real accounts and no name');
  assert.equal(F.cleanParty('  Fuel\u0000\t station ‮ '), 'Fuel station');
  assert.equal(F.cleanParty(42), null); assert.equal(F.cleanParty({ a: 1 }), null); assert.equal(F.cleanParty(null), null);
  assert.equal(F.PARTY_MAX, 80);
  assert.equal(F.clipParty('x'.repeat(200)).length, 80);
  const emoji = 'a'.repeat(79) + '😀'; // the emoji straddles the limit: it is dropped whole, never split
  assert.equal(F.clipParty(emoji), 'a'.repeat(79));
  assert.equal(F.partyKey({ paidTo: ' FUEL  Station' }), F.partyKey({ paidTo: 'fuel station' }));
  assert.notEqual(F.partyKey({ paidTo: 'Fuel station' }), F.partyKey({ receivedFrom: 'Fuel station' }));
});

test('engine: possible duplicates use the names; repeated payments to different places are not flagged', () => {
  const base = { type: 'expense', amount: 5000, date: '2026-10-01', fromAcct: 'opay', toAcct: '', desc: 'Fuel', state: 'Linked' };
  const dq = txns => (F.dataQuality({ txns, today: '2026-10-21', accountIds: ['opay', 'bank'] }).find(q => q.key === 'possible_duplicates') || { count: 0 }).count;
  assert.equal(dq([Object.assign({ id: 1 }, base), Object.assign({ id: 2 }, base)]), 1, 'no names: flagged as before');
  assert.equal(dq([Object.assign({ id: 1, paidTo: 'Station A' }, base), Object.assign({ id: 2, paidTo: 'Station B' }, base)]), 0, 'two places: two payments');
  assert.equal(dq([Object.assign({ id: 1, paidTo: 'Fuel station' }, base), Object.assign({ id: 2, paidTo: '  fuel   STATION ' }, base)]), 1, 'spacing and capitals do not hide a repeat');
  assert.equal(dq([Object.assign({ id: 1, paidTo: 'Fuel station' }, base), Object.assign({ id: 2 }, base)]), 0, 'named and unnamed differ');
  // A blank name is not a data-quality problem.
  const q = F.dataQuality({ txns: [Object.assign({ id: 1 }, base)], today: '2026-10-21', accountIds: ['opay'] });
  assert.deepEqual(q.map(x => x.key), []);
});

test('engine: inclusive local-date range; missing or impossible dates are in no range', () => {
  assert.equal(F.dateKey('2026-10-05'), '2026-10-05');
  assert.equal(F.dateKey('2026-10-05T23:59:59'), '2026-10-05', 'a time part belongs to the date written');
  assert.equal(F.dateKey('2026-10-05T23:30:00Z'), '2026-10-05');
  for (const bad of ['2026-02-31', '2026-13-01', '2026-1-5', '05/10/2026', '', null, undefined, 20261005, '2026-10-05x']) assert.equal(F.dateKey(bad), null, String(bad));
  assert.equal(F.inDateRange('2026-10-01', '2026-10-01', '2026-10-05'), true, 'start day included');
  assert.equal(F.inDateRange('2026-10-05', '2026-10-01', '2026-10-05'), true, 'end day included');
  assert.equal(F.inDateRange('2026-10-05T23:59', '2026-10-01', '2026-10-05'), true, 'late on the end day included');
  assert.equal(F.inDateRange('2026-10-06', '2026-10-01', '2026-10-05'), false);
  assert.equal(F.inDateRange('2026-09-30', '2026-10-01', '2026-10-05'), false);
  assert.equal(F.inDateRange('2026-10-03', '', '2026-10-05'), true, 'open start');
  assert.equal(F.inDateRange('2026-10-03', '2026-10-01', ''), true, 'open end');
  assert.equal(F.inDateRange('2026-02-31', '2026-01-01', '2026-12-31'), false, 'impossible date never inside a range');
});

// ── Screens ─────────────────────────────────────────────────────────────────────────────────────

const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const TEST = BUILDS[0];
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const text = (page, sel) => page.textContent(sel);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const appDay = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const storedAll = (context, n, store) => probe(context, ([n, s]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), [n, store]);
const storedTxns = (context, n) => storedAll(context, n, 'transactions');
const seed = (context, n, recs) => probe(context, ([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = rej; }; }), [n, recs]);
const dbNames = context => probe(context, () => indexedDB.databases().then(d => d.map(x => x.name)));
const acctCards = page => page.$$eval('.acct-card', cs => cs.map(c => [c.querySelector('.acct-name').textContent.trim(), Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, ''))]));
const bal = async (page, label) => { await nav(page, 'home'); const c = (await acctCards(page)).find(([n]) => n.endsWith(label)); return c ? c[1] : null; };
const acctId = (page, label) => page.$eval('#modal-from', (s, l) => Array.from(s.options).find(o => o.textContent.trim() === l).value, label);
const byDesc = (txs, d) => txs.find(t => t.desc === d);
const dirRow = async (page, k) => (await text(page, `#director-body [data-dir-row="${k}"] .autopilot-val`)).trim();

// Opay 100,000; Fictional Bank 500,000; Fictional Coop 80,000 (restricted). Baseline 60 days ago.
async function liveSetup(page) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(60));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  for (const [i, label, kind, opening] of [[1, 'Fictional Bank', 'bank', 500000], [2, 'Fictional Coop', 'coop', 80000]]) {
    await page.click('#setup-add-acct');
    await row(i).locator('[data-f=label]').fill(label); await row(i).locator('[data-f=kind]').selectOption(kind); await row(i).locator('[data-f=opening]').fill(String(opening));
  }
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
// Add Entry as a person would: choose the type, then only the fields it shows.
async function openAdd(page, type) {
  await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
  await page.click(`.type-chip[data-type="${type}"]`);
}
async function fillAdd(page, { amount, desc, cat, from, to, party }) {
  await page.fill('#modal-amount', String(amount)); await page.fill('#modal-desc', desc);
  if (cat) await page.selectOption('#modal-cat', cat);
  if (from !== undefined) await page.selectOption('#modal-from', from);
  if (to !== undefined) await page.selectOption('#modal-to', to);
  if (party !== undefined) await page.fill('#modal-party', party);
}
const formClosed = page => page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
async function addEntry(page, type, fields) { await openAdd(page, type); await fillAdd(page, fields); await page.click('#modal-save-btn'); await formClosed(page); }
// Expect Add Entry to refuse: the reason is shown, the form stays open, nothing is stored.
async function addRefused(page, context, dbName) {
  const before = (await storedTxns(context, dbName)).length, n = page.dialogs.length;
  await page.click('#modal-save-btn');
  for (let i = 0; i < 40 && page.dialogs.length === n; i++) await page.waitForTimeout(50);
  assert.equal(await page.isVisible('#modal-overlay.open'), true, 'the form stays open');
  assert.equal((await storedTxns(context, dbName)).length, before, 'nothing stored');
  return page.dialogs.at(-1);
}
// Quick entry.
async function capture(page, v) { await page.fill('#capture-input', v); await page.click('#capture-btn'); }
async function captureSaved(page, context, dbName, v) {
  const before = (await storedTxns(context, dbName)).length;
  await capture(page, v);
  let txs = [];
  for (let i = 0; i < 60; i++) { txs = await storedTxns(context, dbName); if (txs.length > before) break; await page.waitForTimeout(50); }
  assert.equal(txs.length, before + 1, `"${v}" saved once`);
  return txs.sort((a, b) => b.id - a.id)[0];
}
// Edit form helpers (two-step save: review, then confirm).
async function openEdit(page, id) {
  await nav(page, 'timeline');
  await page.click(`#timeline-list button[data-edit-txn="${id}"]`);
  await page.waitForSelector('#edit-modal.open[data-form-ready="1"]');
}
const reviewRows = page => page.$$eval('#edit-review-list [data-edit-change]', rows => rows.map(r => r.querySelector('.k').textContent.trim() + ': ' + r.querySelector('.v').textContent.trim()));
async function review(page) { await page.click('#edit-save-btn'); await page.waitForSelector('#edit-review', { state: 'visible' }); await page.waitForSelector('#edit-confirm-btn[data-ready="1"]'); return reviewRows(page); }
const editClosed = page => page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
const tlSearch = async (page, q) => { await nav(page, 'timeline'); await page.fill('#tl-search', q); return text(page, '#timeline-list'); };

for (const b of BUILDS) {
  test(`${b.label}: an expense paid to a fuel station reduces only the paying account; the station is a name, not an account`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    const cardsBefore = await (async () => { await nav(page, 'home'); return acctCards(page); })();
    await nav(page, 'director'); const cash0 = await dirRow(page, 'cash');
    assert.equal(cash0, '₦600,000');

    // The approved example.
    await openAdd(page, 'expense');
    assert.equal(await page.isVisible('#modal-to'), false, 'an expense has no To account to credit by mistake');
    assert.equal(await page.isVisible('#modal-party'), true);
    assert.match(await page.getAttribute('#modal-party', 'placeholder'), /^Paid to \(optional\)/);
    assert.match(await text(page, '#modal-acct-hint'), /Paid to is a name only: it is not one of your accounts and never changes a balance/);
    await fillAdd(page, { amount: 5000, desc: 'FJR fuel', cat: 'Vehicle: FJR1300AE', from: 'acc_opay', party: '  Fuel   station ' });
    await page.click('#modal-save-btn'); await formClosed(page);
    // Without a name: nothing extra is stored.
    await addEntry(page, 'expense', { amount: 2000, desc: 'Fictional bread', cat: 'Food', from: 'acc_opay' });

    const txs = await storedTxns(context, b.dbName);
    assert.equal(txs.length, 2);
    const fuel = byDesc(txs, 'FJR fuel'), bread = byDesc(txs, 'Fictional bread');
    assert.equal(fuel.paidTo, 'Fuel station', 'trimmed, spaces collapsed');
    assert.equal(fuel.fromAcct, 'acc_opay'); assert.equal(fuel.toAcct, ''); assert.equal(fuel.cat, 'Vehicle: FJR1300AE');
    assert.equal('receivedFrom' in fuel, false);
    assert.equal('paidTo' in bread, false, 'no empty name stored');
    assert.equal('receivedFrom' in bread, false);

    // Money: Opay −7,000 in total, every other account unchanged, no new account.
    await nav(page, 'home');
    const cardsAfter = await acctCards(page);
    assert.deepEqual(cardsAfter.map(c => c[0]), cardsBefore.map(c => c[0]), 'no account was created for the station');
    assert.ok(!cardsAfter.some(([n]) => /fuel station/i.test(n)));
    assert.deepEqual(cardsAfter.map(c => c[1]), cardsBefore.map(([n, v]) => n.endsWith('Opay') ? v - 7000 : v));
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦593,000', 'counted once');
    await nav(page, 'cashflow');
    assert.equal((await text(page, '#cf-op-total')).trim(), '-₦7,000');

    // Income received from a customer: arrives in the To account only.
    await openAdd(page, 'income');
    assert.equal(await page.isVisible('#modal-from'), false);
    assert.match(await page.getAttribute('#modal-party', 'placeholder'), /^Received from \(optional\)/);
    await fillAdd(page, { amount: 12000, desc: 'Fictional sales', cat: 'Pharmacy Sales', to: 'acc_opay', party: 'Walk-in customers' });
    await page.click('#modal-save-btn'); await formClosed(page);
    const inc = byDesc(await storedTxns(context, b.dbName), 'Fictional sales');
    assert.equal(inc.receivedFrom, 'Walk-in customers'); assert.equal(inc.fromAcct, ''); assert.equal(inc.toAcct, 'acc_opay');
    assert.equal('paidTo' in inc, false);
    assert.equal(await bal(page, 'Opay'), 100000 - 7000 + 12000);

    // Shown and searchable in History and the Inbox; empty names add nothing.
    await nav(page, 'timeline');
    const tl = await text(page, '#timeline-list');
    assert.match(tl, /FJR fuel[\s\S]*paid to Fuel station/);
    assert.match(tl, /Fictional sales[\s\S]*from Walk-in customers/);
    assert.doesNotMatch(tl, /Fictional bread[^₦]*paid to/);
    await nav(page, 'inbox');
    assert.match(await text(page, '#inbox-list'), /FJR fuel[\s\S]*paid to Fuel station/);
    let found = await tlSearch(page, 'fuel STATION');
    assert.match(found, /FJR fuel/); assert.doesNotMatch(found, /Fictional bread|Fictional sales/);
    found = await tlSearch(page, 'walk-in');
    assert.match(found, /Fictional sales/); assert.doesNotMatch(found, /FJR fuel/);
    await page.fill('#tl-search', '');

    // It survives a restart.
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
    assert.equal(byDesc(await storedTxns(context, b.dbName), 'FJR fuel').paidTo, 'Fuel station');
    assert.equal(await bal(page, 'Opay'), 105000);
    if (b === TEST) assert.ok(!(await dbNames(context)).includes('KoboFlowDB'), 'the TEST build never creates or opens the live database');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: transfers keep two real, different accounts and no name; other types move each account once; Add Entry refuses wrong accounts', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const bank = await acctId(page, 'Fictional Bank'), coop = await acctId(page, 'Fictional Coop');

  // Transfer: both accounts shown, no name field; missing or identical accounts refused.
  await openAdd(page, 'transfer');
  assert.equal(await page.isVisible('#modal-party'), false, 'no free-text destination on a transfer');
  assert.equal(await page.isVisible('#modal-from'), true); assert.equal(await page.isVisible('#modal-to'), true);
  await fillAdd(page, { amount: 10000, desc: 'Fictional move', from: 'acc_opay', to: '' });
  assert.match(await addRefused(page, context, TEST.dbName), /Choose the To account/);
  await page.selectOption('#modal-to', 'acc_opay');
  assert.match(await addRefused(page, context, TEST.dbName), /From and To must be different accounts/);
  await page.selectOption('#modal-to', bank);
  await page.click('#modal-save-btn'); await formClosed(page);
  const tr = byDesc(await storedTxns(context, TEST.dbName), 'Fictional move');
  assert.equal(tr.fromAcct, 'acc_opay'); assert.equal(tr.toAcct, bank);
  assert.equal('paidTo' in tr || 'receivedFrom' in tr, false);

  // Expense without the paying account, and a negative amount, are refused.
  await openAdd(page, 'expense');
  await fillAdd(page, { amount: 500, desc: 'Fictional no account', from: '' });
  assert.match(await addRefused(page, context, TEST.dbName), /Choose the From account/);
  await fillAdd(page, { amount: -500, desc: 'Fictional negative', from: 'acc_opay' });
  assert.match(await addRefused(page, context, TEST.dbName), /amount above zero/);
  await page.click('#modal-close-btn');

  // Owner withdrawal and investment paid to someone; capital received from someone.
  await addEntry(page, 'owner_withdrawal', { amount: 6000, desc: 'Fictional draw', from: bank, to: 'acc_opay', party: 'Fictional school fees' });
  await addEntry(page, 'investment', { amount: 20000, desc: 'Fictional deposit', from: bank, to: coop, party: 'Fictional Savings Co' });
  await addEntry(page, 'capital_injection', { amount: 15000, desc: 'Fictional capital', cat: 'Other', from: '', to: bank, party: 'Fictional investor' });
  const txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 4);
  assert.equal(byDesc(txs, 'Fictional draw').paidTo, 'Fictional school fees');
  assert.equal(byDesc(txs, 'Fictional deposit').paidTo, 'Fictional Savings Co');
  const cap = byDesc(txs, 'Fictional capital');
  assert.equal(cap.receivedFrom, 'Fictional investor'); assert.equal(cap.fundingKind, 'capital_injection');
  // Opay 100,000 −10,000 +6,000; Bank 500,000 +10,000 −6,000 −20,000 +15,000; Coop 80,000 +20,000.
  assert.deepEqual([await bal(page, 'Opay'), await bal(page, 'Fictional Bank'), await bal(page, 'Fictional Coop')], [96000, 499000, 100000]);
  await nav(page, 'capital');
  assert.match(await text(page, '#screen-capital'), /15,000/, 'still counted as capital');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: bill payments are paid to the bill; loan repayments to the lender; loan balances and cash move once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  // Bills: paid on the Bills screen, and from Add Entry with and without a typed name.
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await page.fill('#bill-name', 'Fictional shop rent'); await page.selectOption('#bill-cat', 'Business Overhead'); await page.fill('#bill-amount', '50000');
  await page.fill('#bill-first', await appDay(page, 5)); await page.selectOption('#bill-repeat', 'monthly');
  await page.click('#bill-save-btn'); await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
  const occ = await page.getAttribute('#bills-due [data-bill-occ]', 'data-bill-occ');
  await page.click(`[data-bill-pay="${occ}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.fill('#bill-pay-amount', '20000'); await page.click('#bill-pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  for (const [amt, party] of [[10000, ''], [5000, 'Fictional landlord agent']]) {
    await openAdd(page, 'obligation');
    await page.selectOption('#modal-bill', { index: 1 });
    await fillAdd(page, { amount: amt, desc: 'Fictional rent part ' + amt, from: 'acc_opay', party });
    await page.click('#modal-save-btn'); await formClosed(page);
  }
  let txs = await storedTxns(context, TEST.dbName);
  const billPays = txs.filter(t => t.billOcc === occ);
  assert.equal(billPays.length, 3);
  assert.deepEqual(billPays.map(t => t.paidTo).sort(), ['Fictional landlord agent', 'Fictional shop rent', 'Fictional shop rent']);
  assert.ok(billPays.every(t => t.toAcct === '' && t.fromAcct === 'acc_opay'));
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'uncovered'), '₦15,000', '50,000 − 35,000 paid: each payment counted once');

  // Loan: received from the lender, repaid to the lender; the split and allocations are unchanged.
  await nav(page, 'loans'); await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await appDay(page, 20)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched');
  await page.click('#agr-save-btn'); await page.waitForSelector('#screen-agreement.active');
  await page.click('[data-act="pay"]');
  assert.equal(await page.inputValue('#pay-amount'), '55455');
  await page.dblclick('#pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
  await page.waitForTimeout(300);
  txs = await storedTxns(context, TEST.dbName);
  const receipt = txs.find(t => t.type === 'loan_receipt'), pays = txs.filter(t => t.type === 'loan_repayment');
  assert.equal(receipt.receivedFrom, 'Fictional Lender'); assert.equal(receipt.toAcct, 'acc_opay');
  assert.equal(pays.length, 1, 'one repayment, even when tapped twice');
  assert.equal(pays[0].paidTo, 'Fictional Lender');
  assert.equal(pays[0].alloc.principal + pays[0].alloc.interest + pays[0].alloc.fees + pays[0].alloc.unsplit, 55455);
  const alloc = await storedAll(context, TEST.dbName, 'allocations');
  assert.equal(alloc.length, 1); assert.equal(alloc[0].txnId, pays[0].id);
  assert.match(await text(page, '#agr-detail'), /166,365/, 'the loan outstanding moved once');
  // Opay 100,000 −20,000 −10,000 −5,000 +150,000 −55,455.
  assert.equal(await bal(page, 'Opay'), 159545);
  // Loan entries are still corrected in Loans, never in the general edit form.
  await nav(page, 'timeline');
  assert.equal(await page.$(`#timeline-list [data-edit-txn="${pays[0].id}"]`), null);
  assert.match(await text(page, '#timeline-list'), /Loan repayment: Fictional Loan[\s\S]*paid to Fictional Lender/);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: editing names keeps the id and links; review, back and cancel write nothing; confirm writes once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await addEntry(page, 'expense', { amount: 5000, desc: 'Fictional fuel', cat: 'Vehicle: FJR1300AE', from: 'acc_opay' });
  const [orig] = await storedTxns(context, TEST.dbName);

  // Add a name: listed in the review; back and cancel write nothing.
  await openEdit(page, orig.id);
  assert.equal(await page.isVisible('#edit-party'), true);
  assert.match(await text(page, '#edit-party-label'), /^Paid to/);
  assert.equal(await page.inputValue('#edit-party'), '');
  await page.fill('#edit-party', 'Fuel station');
  assert.deepEqual(await review(page), ['Paid to: (none) → Fuel station']);
  assert.deepEqual(await storedTxns(context, TEST.dbName), [orig], 'the review writes nothing');
  await page.click('#edit-back-btn');
  assert.equal(await page.inputValue('#edit-party'), 'Fuel station');
  await review(page);
  await page.click('#edit-cancel-btn'); await editClosed(page);
  assert.deepEqual(await storedTxns(context, TEST.dbName), [orig], 'cancel writes nothing');

  // Confirm: same id, one edit, balance unchanged.
  await openEdit(page, orig.id);
  await page.fill('#edit-party', 'Fuel station');
  await review(page); await page.click('#edit-confirm-btn'); await editClosed(page);
  let [t] = await storedTxns(context, TEST.dbName);
  assert.equal(t.id, orig.id); assert.equal(t.paidTo, 'Fuel station'); assert.equal(t.edits.length, 1);
  assert.deepEqual(t.edits[0].changes, { paidTo: { from: null, to: 'Fuel station' } });
  assert.equal(await bal(page, 'Opay'), 95000, 'a name changes no balance');

  // Change, then clear it.
  await openEdit(page, orig.id);
  assert.equal(await page.inputValue('#edit-party'), 'Fuel station');
  await page.fill('#edit-party', 'Fictional station 2');
  assert.deepEqual(await review(page), ['Paid to: Fuel station → Fictional station 2']);
  await page.click('#edit-confirm-btn'); await editClosed(page);
  await openEdit(page, orig.id);
  await page.fill('#edit-party', '   ');
  assert.deepEqual(await review(page), ['Paid to: Fictional station 2 → (none)']);
  await page.click('#edit-confirm-btn'); await editClosed(page);
  [t] = await storedTxns(context, TEST.dbName);
  assert.equal('paidTo' in t, false, 'a cleared name is removed, not stored empty');
  assert.equal(t.edits.length, 3);

  // A type change moves the name to the field the new type uses, and the review says so.
  await openEdit(page, orig.id);
  await page.fill('#edit-party', 'Fictional customer');
  await page.selectOption('#edit-type', 'income'); await page.selectOption('#edit-from', ''); await page.selectOption('#edit-to', 'acc_opay');
  assert.match(await text(page, '#edit-party-label'), /^Received from/);
  assert.deepEqual(await review(page), ['Type: Expense → Income', 'From: Opay → (none)', 'To: (none) → Opay', 'Received from: (none) → Fictional customer']);
  await page.click('#edit-confirm-btn'); await editClosed(page);
  [t] = await storedTxns(context, TEST.dbName);
  assert.equal(t.receivedFrom, 'Fictional customer'); assert.equal('paidTo' in t, false);
  // To a transfer: the name field disappears and the review shows the name being removed.
  await openEdit(page, orig.id);
  await page.selectOption('#edit-type', 'transfer'); await page.selectOption('#edit-from', 'acc_opay'); await page.selectOption('#edit-to', await acctId(page, 'Fictional Bank'));
  assert.equal(await page.isVisible('#edit-party'), false);
  assert.ok((await review(page)).includes('Received from: Fictional customer → (none)'));
  await page.click('#edit-cancel-btn'); await editClosed(page);

  // A bill payment's name is editable; its bill link and duplicate-save key are kept.
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await page.fill('#bill-name', 'Fictional electricity'); await page.selectOption('#bill-cat', 'Utilities'); await page.fill('#bill-amount', '7000');
  await page.fill('#bill-first', await appDay(page, 3)); await page.selectOption('#bill-repeat', 'none');
  await page.click('#bill-save-btn'); await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
  const occ = await page.getAttribute('#bills-due [data-bill-occ]', 'data-bill-occ');
  await page.click(`[data-bill-pay="${occ}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.click('#bill-pay-save-btn'); await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  const bp = (await storedTxns(context, TEST.dbName)).find(x => x.billOcc === occ);
  assert.equal(bp.paidTo, 'Fictional electricity');
  await openEdit(page, bp.id);
  await page.fill('#edit-party', 'Fictional power company');
  assert.deepEqual(await review(page), ['Paid to: Fictional electricity → Fictional power company']);
  await page.click('#edit-confirm-btn'); await editClosed(page);
  const bp2 = (await storedTxns(context, TEST.dbName)).find(x => x.id === bp.id);
  for (const k of ['billId', 'billOcc', 'idemKey', 'amount', 'fromAcct', 'type']) assert.equal(bp2[k], bp[k], `${k} kept`);
  assert.equal(bp2.paidTo, 'Fictional power company');
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'uncovered'), '₦0', 'the bill is still paid');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: quick entry "@ name" is split off before parsing; unclear entries are refused, never guessed', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const db = TEST.dbName;
  // Preview before saving.
  await page.fill('#capture-input', '5000 fjr fuel @ Fuel station');
  assert.equal((await text(page, '#preview-party')).trim(), 'Paid to: Fuel station');
  assert.equal((await text(page, '#preview-cat')).trim(), 'Vehicle: FJR1300AE');
  let t = await captureSaved(page, context, db, '5000 fjr fuel @ Fuel station');
  assert.equal(t.type, 'expense'); assert.equal(t.cat, 'Vehicle: FJR1300AE'); assert.equal(t.vehicle, 'fjr');
  assert.equal(t.desc, 'fjr fuel', 'the name is not part of the description'); assert.equal(t.paidTo, 'Fuel station');
  assert.equal(t.fromAcct, 'acc_opay', 'the existing alias still picks the account'); assert.equal(t.toAcct, '');
  // A name that looks like a keyword cannot change the type or category.
  t = await captureSaved(page, context, db, '3000 lunch @ Transfer Hub Savings');
  assert.equal(t.type, 'expense'); assert.equal(t.cat, 'Food'); assert.equal(t.paidTo, 'Transfer Hub Savings');
  // Money in: received from.
  t = await captureSaved(page, context, db, '50000 pharmacy sales @ Walk-in customers');
  assert.equal(t.type, 'income'); assert.equal(t.receivedFrom, 'Walk-in customers'); assert.equal('paidTo' in t, false);
  assert.equal(t.fromAcct, '', 'income arrives in one account; it is not taken from another'); assert.equal(t.toAcct, 'acc_opay');
  t = await captureSaved(page, context, db, '20000 salary');
  assert.equal(t.type, 'income'); assert.equal(t.fromAcct, ''); assert.equal(t.toAcct, 'acc_opay');
  // "@" inside a word is text; no "@" means no name.
  t = await captureSaved(page, context, db, '700 fictional airtime for me@example.com');
  assert.equal(t.desc, 'fictional airtime for me@example.com'); assert.equal('paidTo' in t, false);
  t = await captureSaved(page, context, db, '1500 household');
  assert.equal('paidTo' in t || 'receivedFrom' in t, false);

  // Refused, nothing saved, the typed text kept.
  for (const [v, why] of [
    ['10000 savings @ Fictional bank', /between two of your own accounts, so it has no payee/],
    ['200 fuel @ one @ two', /only once/],
    ['200 fuel @   ', /Write who it was paid to/],
    ['200 fuel @ ' + 'x'.repeat(81), /too long/],
    ['-500 lunch', /without a minus sign/],
  ]) {
    const before = (await storedTxns(context, db)).length;
    await capture(page, v);
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
    assert.match(await text(page, '#toast'), why, v);
    await page.waitForTimeout(150);
    assert.equal((await storedTxns(context, db)).length, before, `"${v}" not saved`);
    assert.equal(await page.inputValue('#capture-input'), v, 'input kept');
  }
  await page.fill('#capture-input', '10000 savings @ Fictional bank');
  assert.match(await text(page, '#preview-party'), /no payee/, 'the preview warns before saving');
  // Balances: Opay 100,000 −5,000 −3,000 +50,000 +20,000 −700 −1,500: each entry once.
  assert.equal(await bal(page, 'Opay'), 159800);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: History date range includes both days (late evening too), skips undated entries, combines with search, and clears', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const d = n => appDay(page, -n);
  const D0 = await d(1), Dm1 = await d(2), Dm2 = await d(3), Dm3 = await d(4);
  const rec = (id, date, time, desc, extra) => Object.assign({ id, amount: 100 + id, desc, cat: 'Food', type: 'expense', state: 'AI Categorized', date, time, fromAcct: 'acc_opay', toAcct: '' }, extra || {});
  await seed(context, TEST.dbName, [
    rec(901, Dm3, '23:59', 'Fictional before range'),
    rec(902, Dm2, '00:00', 'Fictional first day midnight', { paidTo: 'Fictional kiosk' }),
    rec(903, Dm1, '12:00', 'Fictional middle day'),
    rec(904, D0, '23:59', 'Fictional last day late', { paidTo: 'Fictional kiosk' }),
    rec(905, D0 + 'T23:30:00Z', '23:30', 'Fictional imported with time'),
    rec(906, '2026-02-31', '10:00', 'Fictional impossible date'),
    rec(907, await d(0), '08:00', 'Fictional after range'),
  ]);
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  await nav(page, 'timeline');
  const shown = async () => (await text(page, '#timeline-list'));
  assert.match(await shown(), /Fictional impossible date/, 'no range: every entry is listed as before');
  assert.equal(await page.isVisible('#tl-range-msg'), false);

  await page.fill('#tl-from', Dm2); await page.fill('#tl-to', D0);
  let s = await shown();
  for (const x of ['Fictional first day midnight', 'Fictional middle day', 'Fictional last day late', 'Fictional imported with time']) assert.match(s, new RegExp(x), x);
  for (const x of ['Fictional before range', 'Fictional after range', 'Fictional impossible date']) assert.doesNotMatch(s, new RegExp(x), x);
  assert.match(await text(page, '#tl-range-msg'), /Showing 4 entries dated from .* to .*, both days included\. 1 entry has no valid date and is not shown while a range is set\./);

  // One day only, late evening included.
  await page.fill('#tl-from', D0);
  s = await shown();
  assert.match(s, /Fictional last day late/); assert.match(s, /Fictional imported with time/); assert.doesNotMatch(s, /Fictional middle day/);
  // Combined with search on the name.
  await page.fill('#tl-from', Dm3); await page.fill('#tl-search', 'kiosk');
  s = await shown();
  assert.match(s, /Fictional first day midnight/); assert.match(s, /Fictional last day late/); assert.doesNotMatch(s, /Fictional before range|Fictional middle day/);
  await page.fill('#tl-search', '');
  // A start after the end is reported and not applied.
  await page.fill('#tl-from', D0); await page.fill('#tl-to', Dm2);
  assert.match(await text(page, '#tl-range-msg'), /start date is after the end date[\s\S]*showing all dates/);
  assert.match(await shown(), /Fictional before range[\s\S]*|Fictional after range/);
  assert.match(await shown(), /Fictional impossible date/);
  // Clear.
  await page.click('#tl-range-clear');
  assert.equal(await page.inputValue('#tl-from'), ''); assert.equal(await page.inputValue('#tl-to'), '');
  assert.equal(await page.isVisible('#tl-range-msg'), false);
  for (const x of ['Fictional before range', 'Fictional after range', 'Fictional impossible date']) assert.match(await shown(), new RegExp(x));
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: repeated payments are all saved; only the same payee repeated is flagged as a possible duplicate', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const dup = async () => page.$('#director-body [data-dir-quality="possible_duplicates"]');
  await addEntry(page, 'expense', { amount: 5000, desc: 'Fictional fuel', cat: 'Other', from: 'acc_opay', party: 'Station A' });
  await addEntry(page, 'expense', { amount: 5000, desc: 'Fictional fuel', cat: 'Other', from: 'acc_opay', party: 'Station B' });
  await nav(page, 'director');
  assert.equal(await dup(), null, 'same amount and day, different places: two legitimate payments');
  await addEntry(page, 'expense', { amount: 5000, desc: 'Fictional fuel', cat: 'Other', from: 'acc_opay', party: '  station   a ' });
  assert.equal((await storedTxns(context, TEST.dbName)).length, 3, 'a likely repeat is still saved: never blocked');
  await nav(page, 'director');
  assert.match(await text(page, '#director-body [data-dir-quality="possible_duplicates"]'), /1 entry looks like a repeat of another/);
  assert.equal(await bal(page, 'Opay'), 85000);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: older backups import unchanged; invalid or oversized names are cleaned; names show as plain text; CSV is safe', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const today = await appDay(page, 0);
  const tx = (o) => Object.assign({ amount: 1000, cat: 'Other', type: 'expense', state: 'AI Categorized', date: today, time: '09:00', fromAcct: 'acc_opay', toAcct: '' }, o);
  // An older (v2) backup without any names.
  const v2 = { version: '2.0', transactions: [tx({ desc: 'Fictional old one' }), tx({ desc: 'Fictional old two', amount: 2000 })] };
  let rep = await page.evaluate(d => __kfPlanImport(d).report, v2);
  assert.deepEqual(rep.added, { transactions: 2 }); assert.equal(rep.rejected, 0);
  // A current backup with every kind of bad name. Ids are new.
  const bad = { version: '4.0', transactions: [
    tx({ id: 7001, desc: 'Fictional number name', paidTo: 12345 }),
    tx({ id: 7002, desc: 'Fictional object name', paidTo: { evil: true } }),
    tx({ id: 7003, desc: 'Fictional wrong field', receivedFrom: 'Fictional payer' }),
    tx({ id: 7004, desc: 'Fictional long name', paidTo: 'L'.repeat(300) }),
    tx({ id: 7005, desc: 'Fictional messy name', paidTo: '  Fuel\u0000\n  station‮ ' }),
    tx({ id: 7006, desc: 'Fictional transfer name', type: 'transfer', toAcct: 'acc_opay', fromAcct: 'acc_x', paidTo: 'Somewhere' }),
    tx({ id: 7007, desc: 'Fictional html name', paidTo: '<img src=x onerror="window.__pwned=1">' }),
    tx({ id: 7008, desc: 'Fictional formula name', paidTo: '=HYPERLINK("http://x","click")' }),
    tx({ id: 7009, desc: 'Fictional minus name', paidTo: '-Fictional minus shop' }),
    tx({ id: 7010, desc: 'Fictional plain name', paidTo: 'Fuel station' }),
    tx({ id: 7011, desc: 'Fictional income name', type: 'income', fromAcct: '', toAcct: 'acc_opay', receivedFrom: '+Fictional customer' }),
  ] };
  rep = await page.evaluate(d => __kfPlanImport(d).report, bad);
  assert.equal(rep.added.transactions, 11, 'every entry is imported');
  assert.match(rep.notes.join(' '), /5 "paid to \/ received from" names were not valid text, did not fit the entry type or was too long/);
  // Through the real Import button.
  await page.click('#settings-nav-btn');
  for (const d of [v2, bad]) {
    await page.setInputFiles('#import-file-input', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(d)) });
    await page.waitForFunction(() => /Import complete/.test(document.getElementById('toast').textContent || ''));
    await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'));
  }
  const txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 13);
  const g = d => byDesc(txs, d);
  assert.equal('paidTo' in g('Fictional old one'), false, 'no value invented for older records');
  assert.equal('paidTo' in g('Fictional number name'), false);
  assert.equal('paidTo' in g('Fictional object name'), false);
  assert.equal('receivedFrom' in g('Fictional wrong field'), false);
  assert.equal(g('Fictional long name').paidTo, 'L'.repeat(80));
  assert.equal(g('Fictional messy name').paidTo, 'Fuel station');
  assert.equal('paidTo' in g('Fictional transfer name'), false);
  assert.equal(g('Fictional plain name').paidTo, 'Fuel station');
  // Re-importing the same backup adds nothing.
  rep = await page.evaluate(d => __kfPlanImport(d).report, bad);
  assert.equal(Object.keys(rep.added).length, 0);
  // HTML-looking names are shown as text, never run.
  await nav(page, 'timeline');
  assert.match(await text(page, '#timeline-list'), /paid to <img src=x onerror="window.__pwned=1">/);
  await nav(page, 'inbox');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.$('#inbox-list img, #timeline-list img'), null);
  // CSV: two named columns; formula-like names neutralised, ordinary names untouched.
  await page.click('#settings-nav-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv-btn')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trim().split(/\r\n/);
  assert.match(lines[0], /"Reversed","Paid to","Received from"$/);
  const line = d => lines.find(l => l.includes(d));
  assert.match(line('Fictional formula name'), /"'=HYPERLINK\(""http:\/\/x"",""click""\)",""$/);
  assert.match(line('Fictional minus name'), /"'-Fictional minus shop",""$/);
  assert.match(line('Fictional income name'), /"","'\+Fictional customer"$/);
  assert.match(line('Fictional plain name'), /"Fuel station",""$/, 'an ordinary name is not altered');
  assert.match(line('Fictional old one'), /"",""$/);
  assert.deepEqual(page.errors, []);
  await context.close();
});
