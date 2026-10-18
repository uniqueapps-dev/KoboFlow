// Isolation tests for koboflow-test.html (the device acceptance-test build).
// It must use only "KoboFlowDB-test" and must never open, upgrade, read,
// write, create or delete the live "KoboFlowDB".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_FILE = path.join(ROOT, 'koboflow-test.html');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

test('koboflow-test.html is exactly what the build script produces from koboflow.html', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-test-file.js'), '--check'], { stdio: 'pipe' });
});

test('database name is a fixed constant; no URL input can select a database', () => {
  const html = fs.readFileSync(TEST_FILE, 'utf8');
  assert.match(html, /var DB_NAME = "KoboFlowDB-test", TEST_DB = 'test';/);
  assert.doesNotMatch(html, /location\.search/, 'no query-string database selection');
  assert.equal((html.match(/['"]KoboFlowDB['"]/g) || []).length, 1, 'live name appears only in the guard');
  assert.ok(html.indexOf('refused to') < html.indexOf('KoboFlow IDB Shim v4'), 'guard runs before the storage layer');
});

let server, base, browser;
test.before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    const file = req.url.startsWith('/koboflow-test.html') ? 'koboflow-test.html' : null;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(file ? fs.readFileSync(path.join(ROOT, file)) : '<!doctype html><title>blank</title>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function ctxPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.answers = [];
  page.dialogs = [];
  page.on('dialog', async d => { page.dialogs.push(d.message()); const a = page.answers.length ? page.answers.shift() : true; if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : undefined); });
  return { context, page };
}
// Reads a whole database from a plain page on the same origin (no app code loaded).
const snapshot = (page, name) => page.evaluate(name => new Promise((res, rej) => {
  const r = indexedDB.open(name);
  r.onupgradeneeded = () => { r.transaction.abort(); res({ exists: false }); };
  r.onerror = () => res({ exists: false, error: String(r.error) });
  r.onsuccess = () => {
    const db = r.result, out = { exists: true, version: db.version, stores: {} }, names = [...db.objectStoreNames];
    if (!names.length) { db.close(); return res(out); }
    const tx = db.transaction(names);
    names.forEach(n => { const q = tx.objectStore(n).getAll(); q.onsuccess = () => { out.stores[n] = q.result; }; });
    tx.oncomplete = () => { db.close(); res(out); };
    tx.onerror = rej;
  };
}), name);
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);

test('banner is visible on startup even before any script runs', { skip }, async () => {
  const { context, page } = await ctxPage({ javaScriptEnabled: false });
  await page.goto(base + '/koboflow-test.html');
  assert.equal(await page.isVisible('#db-banner'), true);
  assert.match(await page.textContent('#db-banner'), /TEST DATABASE — KoboFlowDB-test/);
  assert.equal(await page.title(), 'KoboFlow TEST — test database only');
  await context.close();
  const live = await ctxPage();
  await live.page.goto(base + '/koboflow-test.html');
  await live.page.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await live.page.isVisible('#db-banner'), true, 'still visible after the app renders');
  assert.match(await live.page.textContent('#db-banner'), /TEST DATABASE/);
  assert.deepEqual(live.page.errors, []);
  await live.context.close();
});

test('a full workflow in the test build leaves the live database byte-for-byte untouched', { skip }, async () => {
  const { context, page } = await ctxPage();
  // Existing real v2 database on the same origin, with a real record.
  await page.goto(base + '/blank');
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('KoboFlowDB', 2);
    r.onupgradeneeded = e => { const s = e.target.result.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true }); s.createIndex('date', 'date'); e.target.result.createObjectStore('loans', { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => { const t = r.result.transaction('transactions', 'readwrite'); t.objectStore('transactions').add({ amount: 12345, desc: 'REAL entry', type: 'expense', date: '2026-09-01', time: '09:00', fromAcct: 'pharma_bank' }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = rej; };
  }));
  const before = await snapshot(page, 'KoboFlowDB');
  assert.equal(before.version, 2);

  // A ?db= parameter must not redirect the test build anywhere.
  await page.goto(base + '/koboflow-test.html?db=live');
  await page.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await page.evaluate(() => window.__kfDbName), 'KoboFlowDB-test');
  // The live database is unreachable from inside the test build.
  const blocked = await page.evaluate(() => { const r = []; for (const op of ['open', 'deleteDatabase']) { try { indexedDB[op]('KoboFlowDB'); r.push(op + ':allowed'); } catch (e) { r.push(op + ':refused'); } } return r; });
  assert.deepEqual(blocked, ['open:refused', 'deleteDatabase:refused']);
  assert.ok(!(await page.evaluate(() => indexedDB.databases())).some(d => d.name === 'KoboFlowDB'), 'live database not even listed');
  assert.doesNotMatch(await page.textContent('#timeline-list'), /REAL entry/, 'nothing read from the live database');

  // Setup, loan, payment, reversal, opportunity, export, import, clear — all in the test DB.
  await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.fill('#setup-baseline', await page.evaluate(() => KoboFin.addDays(KoboFin.today(), -1)));
  await page.locator('#setup-accounts [data-acct-row="0"] [data-f="opening"]').fill('500000');
  for (const k of ['pharma_cash', 'pharma_bank', 'pers_cash', 'pers_bank']) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  for (const k of ['coop', 'emergency', 'fixed_dep']) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, '');
  await page.click('#setup-save-btn');
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => document.body.classList.contains('kf-live'));
  await nav(page, 'loans');
  await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'EasiMoni TEST'); await page.fill('#agr-counterparty', 'EasiMoni');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await page.evaluate(() => KoboFin.addDays(KoboFin.today(), 30)));
  await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#screen-agreement.active');
  await page.click('[data-act="pay"]');
  await page.click('#pay-save-btn');
  await page.waitForFunction(() => /166,365/.test(document.getElementById('agr-detail').textContent));
  page.answers.push('test reversal', true);
  await page.click('#agr-detail .tl-item:has-text("Loan repayment") [data-reverse]');
  await page.waitForFunction(() => /Reversed: test reversal/.test(document.getElementById('agr-detail').textContent));
  await nav(page, 'opportunity');
  await page.fill('#opp-name', 'Offer TEST'); await page.fill('#opp-received', '100000'); await page.fill('#opp-total', '120000');
  await page.fill('#opp-count', '2'); await page.fill('#opp-first-due', await page.evaluate(() => KoboFin.addDays(KoboFin.today(), 30)));
  await page.click('#opp-calc-btn');
  await page.click('[data-opp-act="save"]');
  await page.waitForFunction(() => /Offer TEST/.test(document.getElementById('opp-saved').textContent));
  await page.click('#settings-nav-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')]);
  assert.match(dl.suggestedFilename(), /^koboflow_TEST_backup_/);
  const file = await dl.path();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).testDatabase, 'KoboFlowDB-test');
  page.dialogs.length = 0;
  await page.setInputFiles('#import-file-input', file);
  for (let i = 0; i < 200 && !page.dialogs.some(d => /Nothing new to import/.test(d)); i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(page.dialogs.some(d => /Nothing new to import/.test(d)));
  await page.reload();
  await page.waitForSelector('body[data-kf-ready="1"]');
  assert.match(await page.textContent('#accounts-scroll'), /Opay/, 'test data persisted in the test database');
  await page.click('#settings-nav-btn');
  page.answers.push(true, 'CLEAR');
  await page.click('#clear-data-btn');
  await page.waitForFunction(() => !document.body.classList.contains('kf-live'));
  assert.deepEqual(page.errors, []);

  // Live database: same version, same records, nothing added.
  await page.goto(base + '/blank');
  const after = await snapshot(page, 'KoboFlowDB');
  assert.deepEqual(after, before);
  const test = await snapshot(page, 'KoboFlowDB-test');
  assert.equal(test.exists, true);
  assert.equal(test.version, 4);
  await context.close();
});

test('the test build never creates a live database where none exists', { skip }, async () => {
  const { context, page } = await ctxPage();
  await page.goto(base + '/koboflow-test.html');
  await page.waitForSelector('body[data-kf-ready="1"]');
  await page.fill('#capture-input', '2500 fuel fjr');
  await page.press('#capture-input', 'Enter');
  await page.goto(base + '/blank');
  const names = (await page.evaluate(() => indexedDB.databases())).map(d => d.name);
  assert.deepEqual(names, ['KoboFlowDB-test']);
  await context.close();
});

test('test build: the reported Android setup persists across close/reopen with dialogs blocked, in KoboFlowDB-test only', { skip }, async () => {
  const { context, page } = await ctxPage();
  await context.addInitScript(() => { window.confirm = () => false; window.prompt = () => null; window.alert = () => {}; });
  await page.goto(base + '/koboflow-test.html');
  await page.waitForSelector('body[data-kf-ready="1"]');
  await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.fill('#setup-baseline', await page.evaluate(() => KoboFin.today()));
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
  await page.click('#setup-save-btn');
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => document.body.classList.contains('kf-live'));
  await page.close();
  const again = await context.newPage();
  await again.goto(base + '/koboflow-test.html');
  await again.waitForSelector('body[data-kf-ready="1"]');
  assert.equal(await again.isVisible('#db-banner'), true);
  assert.match(await again.textContent('#accounts-scroll'), /Opay₦500,000.*Test Bank₦100,000/);
  await again.click('#settings-nav-btn');
  await again.click('#storage-check-btn');
  await again.waitForFunction(() => /Database: KoboFlowDB-test.*Account setup saved: yes, 2 account/.test(document.getElementById('storage-check-out').textContent));
  await again.click('#setup-open-btn');
  assert.equal(await again.locator('#setup-accounts [data-acct-row="0"] [data-f="opening"]').inputValue(), '500000');
  assert.equal(await again.inputValue('#setup-aliases [data-alias="pharma_bank"]'), 'acc_opay');
  await again.goto(base + '/blank');
  assert.deepEqual((await again.evaluate(() => indexedDB.databases())).map(d => d.name), ['KoboFlowDB-test']);
  const meta = await snapshot(again, 'KoboFlowDB-test');
  assert.equal(meta.stores.meta.find(m => m.id === 'ledgerSetup').accounts[1].opening, 100000);
  await context.close();
});

test('the test build cannot open, delete or even list production\'s pre-upgrade safety copies', { skip }, async () => {
  const { context, page } = await ctxPage();
  // A production copy exists on this origin (created from a neutral page).
  await page.goto(base + '/blank');
  await page.evaluate(() => new Promise(res => { const q = indexedDB.open('KoboFlowDB-pre-v4-20261018190000', 3); q.onupgradeneeded = () => q.result.createObjectStore('transactions', { keyPath: 'id' }).put({ id: 1, amount: 5 }); q.onsuccess = () => { q.result.close(); res(); }; }));
  await page.goto(base + '/koboflow-test.html');
  await page.waitForSelector('body[data-kf-ready="1"]');
  const r = await page.evaluate(async () => {
    const out = {};
    try { indexedDB.open('KoboFlowDB-pre-v4-20261018190000'); out.open = 'allowed'; } catch (e) { out.open = e.message; }
    try { indexedDB.deleteDatabase('KoboFlowDB-pre-v4-20261018190000'); out.del = 'allowed'; } catch (e) { out.del = e.message; }
    out.listed = (await indexedDB.databases()).map(d => d.name);
    return out;
  });
  assert.match(r.open, /refused to open the live database or its safety copy/);
  assert.match(r.del, /refused to delete the live database or its safety copy/);
  assert.equal(r.listed.some(n => /^KoboFlowDB-pre-v4-/.test(n)), false);
  assert.ok(r.listed.includes('KoboFlowDB-test'));
  await page.goto(base + '/blank');
  const still = await page.evaluate(() => new Promise(res => { const q = indexedDB.open('KoboFlowDB-pre-v4-20261018190000'); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }));
  assert.deepEqual(still, [{ id: 1, amount: 5 }], 'the production copy is untouched');
  await context.close();
});
