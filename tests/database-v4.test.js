// Database v3 → v4 (bills store) upgrade safety. The "older app" is the previous release, read
// read-only from git (the Stage 0 commit). Fictional data only; every test uses a fresh browser
// profile, so no real database is ever touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OLD_COMMIT = 'f5d7a7383046f350463f5f0a77b8ee8d0a585e8f';
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
let OLD_HTML = null;
try { OLD_HTML = execFileSync('git', ['-C', ROOT, 'show', OLD_COMMIT + ':koboflow.html'], { maxBuffer: 1 << 26 }); } catch (e) { /* not available */ }
const skip = (!pw && 'Playwright not installed') || (!OLD_HTML && 'previous release not available from git');
const ALIASES = ['pharma_cash', 'pharma_bank', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep'];

let server, base, browser;
test.before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (b, t) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-cache' }); res.end(b); };
    if (p === '/old/' || p === '/old/index.html') return send(OLD_HTML, 'text/html');
    if (p === '/KoboFlow/' || p === '/KoboFlow/index.html') return send(fs.readFileSync(path.join(ROOT, 'koboflow.html')), 'text/html');
    if (p === '/probe') return send('<!doctype html><title>probe</title>', 'text/html');
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function ctx(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page };
}
const ready = (page) => page.waitForFunction(() => document.body.getAttribute('data-kf-ready')).then(() => page.getAttribute('body', 'data-kf-ready'));
const openAt = async (page, url) => { await page.goto(base + url); return ready(page); };
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const plusDays = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
// Every store and record of a database, plus its version (read-only; never creates a database).
const dump = (context, name) => probe(context, name => new Promise((res, rej) => {
  const q = indexedDB.open(name); let created = false;
  q.onupgradeneeded = e => { if (e.oldVersion === 0) { created = true; e.target.transaction.abort(); } };
  q.onerror = () => res(created ? null : { error: String(q.error) });
  q.onsuccess = () => {
    const d = q.result, names = Array.from(d.objectStoreNames), out = { version: d.version, stores: {} };
    if (!names.length) { d.close(); return res(out); }
    const tx = d.transaction(names, 'readonly');
    names.forEach(n => { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out.stores[n] = r.result; }; });
    tx.oncomplete = () => { d.close(); res(out); }; tx.onerror = () => rej(tx.error);
  };
}), name);
const databases = context => probe(context, () => indexedDB.databases());
const copies = async context => (await databases(context)).filter(d => /^KoboFlowDB-pre-v4-\d{14}(-\d)?$/.test(d.name));
const withoutUpgradeRecord = st => ({ ...st, meta: (st.meta || []).filter(m => m.id !== 'dbUpgradeV4') });

// Builds a realistic v3 database through the PREVIOUS release's own screens: live setup with
// three accounts and an earmark, a loan with its schedule, quick captures and an Add Entry.
async function populateWithOldApp(page) {
  assert.equal(await openAt(page, '/old/'), '1');
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(40));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  for (const [i, label, kind, opening] of [[1, 'Fictional Bank', 'bank', 500000], [2, 'Fictional Coop', 'coop', 80000]]) {
    await page.click('#setup-add-acct');
    await row(i).locator('[data-f=label]').fill(label); await row(i).locator('[data-f=kind]').selectOption(kind); await row(i).locator('[data-f=opening]').fill(String(opening));
  }
  await page.click('#setup-add-bucket');
  const b = page.locator('#setup-buckets [data-bucket-row="0"]');
  await b.locator('[data-f=label]').fill('Fictional Rent'); await b.locator('[data-f=parentId]').selectOption('acc_opay'); await b.locator('[data-f=amount]').fill('30000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  await page.click('.nav-btn[data-screen="loans"]'); await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, 20)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched'); await page.click('#agr-save-btn'); await page.waitForSelector('#screen-agreement.active');
  for (const c of ['5000 fuel', '15000 fuel green', '2500 lunch']) {
    await page.fill('#capture-input', c); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
  }
  await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
  await page.fill('#modal-amount', '7000'); await page.fill('#modal-desc', 'Fictional electricity'); await page.click('.type-chip[data-type="obligation"]');
  await page.selectOption('#modal-from', 'acc_opay'); await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
  return page.textContent('#autopilot-body');
}

test('fresh installation opens directly at v4 with a bills store; nothing to copy, no copy made', { skip }, async () => {
  const { context, page } = await ctx();
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const d = await dump(context, 'KoboFlowDB');
  assert.equal(d.version, 4);
  assert.deepEqual(Object.keys(d.stores).sort(), ['agreementEvents', 'agreements', 'allocations', 'bills', 'cashFlowSnapshots', 'instalments', 'loans', 'meta', 'opportunities', 'ownerAnalytics', 'roiSnapshots', 'runwaySnapshots', 'transactions', 'vlogs']);
  assert.deepEqual(await copies(context), []);
  assert.equal((d.stores.meta || []).some(m => m.id === 'dbUpgradeV4'), false);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('a populated v3 database upgrades to v4: every record preserved; a verified v3 copy is kept and recorded', { skip }, async () => {
  const { context, page } = await ctx();
  const oldAutopilot = await populateWithOldApp(page);
  const before = await dump(context, 'KoboFlowDB');
  assert.equal(before.version, 3);
  assert.ok(before.stores.transactions.length >= 5 && before.stores.instalments.length === 4 && before.stores.meta.some(m => m.id === 'ledgerSetup'));
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const after = await dump(context, 'KoboFlowDB');
  assert.equal(after.version, 4);
  assert.deepEqual(after.stores.bills, []);
  const { bills, ...kept } = after.stores;
  assert.deepEqual(withoutUpgradeRecord(kept), before.stores, 'every v3 store and record is unchanged');
  const cs = await copies(context);
  assert.equal(cs.length, 1);
  const copy = await dump(context, cs[0].name);
  assert.equal(copy.version, 3, 'the copy keeps the old layout, so an older KoboFlow can open it');
  assert.deepEqual(copy.stores, before.stores, 'the copy is identical to the database before the upgrade');
  const rec = after.stores.meta.find(m => m.id === 'dbUpgradeV4');
  assert.equal(rec.from, 3); assert.equal(rec.to, 4); assert.equal(rec.copyDb, cs[0].name); assert.equal(rec.verified, true);
  assert.equal(rec.counts.transactions, before.stores.transactions.length);
  // Same money on screen, before and after.
  const cash = t => /Cash Now \(actual\)₦[\d,]+/.exec(t)[0];
  assert.equal(cash(await page.textContent('#autopilot-body')), cash(oldAutopilot));
  // Storage Check explains the copy and offers it as a normal backup file.
  await page.click('#settings-nav-btn'); await page.click('#storage-check-btn');
  await page.waitForFunction(() => /safety copy/.test(document.getElementById('storage-check-out').textContent));
  const sc = await page.textContent('#storage-check-out');
  assert.match(sc, /Database: KoboFlowDB \(v4\)/);
  assert.match(sc, new RegExp('Upgraded from database v3 to v4[\\s\\S]*' + cs[0].name + '[\\s\\S]*\\?db=' + cs[0].name.slice(11)));
  const dlp = page.waitForEvent('download');
  await page.click('[data-dl-copy]');
  const file = JSON.parse(fs.readFileSync(await (await dlp).path(), 'utf8'));
  assert.equal(file.version, '3.2'); assert.equal(file.preUpgradeCopy, true);
  assert.deepEqual(file.transactions.map(t => t.id).sort(), before.stores.transactions.map(t => t.id).sort());
  assert.deepEqual(file.instalments, before.stores.instalments);
  assert.deepEqual(file.ledgerSetup, before.stores.meta.find(m => m.id === 'ledgerSetup'));
  // Reloading does not upgrade again or make another copy.
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  assert.equal((await copies(context)).length, 1);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('the older app meets the v4 database: it refuses to open it and changes nothing; it CAN open the safety copy', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const v4 = await dump(context, 'KoboFlowDB');
  assert.equal(await openAt(page, '/old/'), 'error', 'older app stops: storage unavailable');
  assert.match(await page.textContent('#dialog-warning'), /Storage unavailable/);
  assert.deepEqual(await dump(context, 'KoboFlowDB'), v4, 'nothing deleted, reset or overwritten');
  // Rollback that does not depend on the old app opening the upgraded database: open the copy.
  const name = (await copies(context))[0].name;
  assert.equal(await openAt(page, '/old/?db=' + name.slice(11)), '1');
  assert.match(await page.textContent('#autopilot-body'), /Cash Now \(actual\)₦[\d,]+/);
  await page.click('.nav-btn[data-screen="loans"]');
  assert.match(await page.textContent('#loan-active'), /Fictional Loan/);
  await page.click('.nav-btn[data-screen="inbox"]');
  assert.match(await page.textContent('#inbox-list'), /Fictional electricity/);
  assert.equal((await dump(context, 'KoboFlowDB')).version, 4, 'the upgraded database is untouched');
  await context.close();
});

test('recovery by file: the downloaded copy restores into the older app on an empty database, verified record for record', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  const before = await dump(context, 'KoboFlowDB');
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  await page.click('#settings-nav-btn'); await page.click('#storage-check-btn');
  await page.waitForSelector('[data-dl-copy]');
  const dlp = page.waitForEvent('download'); await page.click('[data-dl-copy]');
  const filePath = await (await dlp).path();
  assert.equal(await openAt(page, '/old/?db=restore'), '1');
  await page.click('#settings-nav-btn');
  await page.setInputFiles('#import-file-input', filePath);
  await page.waitForFunction(() => /Fictional electricity/.test(document.getElementById('timeline-list').textContent));
  const restored = await dump(context, 'KoboFlowDB-restore');
  assert.equal(restored.version, 3);
  for (const s of ['transactions', 'agreements', 'instalments', 'allocations', 'agreementEvents']) {
    const key = r => JSON.stringify(r);
    assert.deepEqual(restored.stores[s].map(key).sort(), before.stores[s].filter(r => !r.demo).map(key).sort(), s + ' restored exactly');
  }
  assert.deepEqual(restored.stores.meta.find(m => m.id === 'ledgerSetup'), before.stores.meta.find(m => m.id === 'ledgerSetup'));
  await context.close();
});

// The copy cannot be made: no database may be created whose name starts with "-pre-v4-".
const blockCopy = () => { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (n) { if (/-pre-v4-/.test(String(n))) throw new DOMException('simulated: storage full', 'QuotaExceededError'); return o.apply(this, arguments); }; };
test('if the safety copy cannot be made, nothing is upgraded: the app stops, explains, and offers the data as a file', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  const before = await dump(context, 'KoboFlowDB');
  await context.addInitScript(blockCopy);
  assert.equal(await openAt(page, '/KoboFlow/'), 'error');
  const w = await page.textContent('#dialog-warning');
  assert.match(w, /Upgrade paused: KoboFlow could not make a verified safety copy of KoboFlowDB before upgrading it to version 4 \(simulated: storage full\)\. Nothing was changed: your data is still in version 3/);
  assert.deepEqual(await dump(context, 'KoboFlowDB'), before, 'still v3, every record unchanged');
  assert.deepEqual(await copies(context), []);
  const dlp = page.waitForEvent('download'); await page.click('#dialog-warning [data-dl-paused]');
  const file = JSON.parse(fs.readFileSync(await (await dlp).path(), 'utf8'));
  assert.deepEqual(file.transactions.map(t => t.id).sort(), before.stores.transactions.map(t => t.id).sort());
  await context.close();
});

// The upgrade itself fails part-way (creating the bills store throws): IndexedDB rolls it back.
const failUpgrade = () => { const c = IDBDatabase.prototype.createObjectStore; IDBDatabase.prototype.createObjectStore = function (n) { if (n === 'bills' && !window.__allowUpgrade) throw new DOMException('simulated: interrupted', 'AbortError'); return c.apply(this, arguments); }; };
test('an interrupted upgrade is rolled back whole; the next start makes a fresh copy and completes; earlier copies are kept', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  const before = await dump(context, 'KoboFlowDB');
  await context.addInitScript(failUpgrade);
  assert.equal(await openAt(page, '/KoboFlow/'), 'error');
  assert.match(await page.textContent('#dialog-warning'), /The upgrade to database version 4 did not complete[\s\S]*rolled it back, so your data is unchanged \(still version 3\)/);
  assert.deepEqual(await dump(context, 'KoboFlowDB'), before, 'nothing half-changed');
  assert.equal((await copies(context)).length, 1, 'the verified copy from the attempt is kept');
  await page.waitForTimeout(1100); // the next copy gets a different timestamp
  await page.evaluate(() => { window.__allowUpgrade = true; });
  await context.addInitScript(() => { window.__allowUpgrade = true; });
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const after = await dump(context, 'KoboFlowDB');
  assert.equal(after.version, 4);
  const { bills, ...kept } = after.stores;
  assert.deepEqual(withoutUpgradeRecord(kept), before.stores);
  const cs = await copies(context);
  assert.equal(cs.length, 2, 'never deleted automatically');
  for (const c of cs) assert.deepEqual((await dump(context, c.name)).stores, before.stores);
  assert.equal(after.stores.meta.find(m => m.id === 'dbUpgradeV4').copyDb, cs.map(c => c.name).sort()[1], 'the record names the copy made just before the successful upgrade');
  await context.close();
});

test('a newer database version is refused with a clear message, and nothing is changed', { skip }, async () => {
  const { context, page } = await ctx();
  await probe(context, () => new Promise(res => { const q = indexedDB.open('KoboFlowDB', 9); q.onupgradeneeded = () => { q.result.createObjectStore('future', { keyPath: 'id' }).put({ id: 'x', v: 1 }); }; q.onsuccess = () => { q.result.close(); res(); }; }));
  const before = await dump(context, 'KoboFlowDB');
  assert.equal(await openAt(page, '/KoboFlow/'), 'error');
  assert.match(await page.textContent('#dialog-warning'), /created by a newer KoboFlow version\. This version cannot open it\. Nothing was changed/);
  assert.deepEqual(await dump(context, 'KoboFlowDB'), before);
  assert.deepEqual(await copies(context), []);
  await context.close();
});

test('a database that already has the copy\'s name is never written to or deleted; the copy takes the next name', { skip }, async () => {
  const fixedClock = () => { const T = Date.parse('2026-10-18T19:00:00Z'), D = Date; class FD extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } } window.Date = FD; };
  const { context, page } = await ctx(fixedClock);
  await populateWithOldApp(page);
  // Something else already holds the exact name the copy would get at this time.
  await probe(context, () => new Promise(res => { const q = indexedDB.open('KoboFlowDB-pre-v4-20261018190000', 1); q.onupgradeneeded = () => { q.result.createObjectStore('sentinel', { keyPath: 'id' }).put({ id: 'keep', v: 42 }); }; q.onsuccess = () => { q.result.close(); res(); }; }));
  const sentinel = await dump(context, 'KoboFlowDB-pre-v4-20261018190000');
  const before = await dump(context, 'KoboFlowDB');
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  assert.deepEqual(await dump(context, 'KoboFlowDB-pre-v4-20261018190000'), sentinel, 'untouched');
  const copy = await dump(context, 'KoboFlowDB-pre-v4-20261018190000-2');
  assert.equal(copy.version, 3);
  assert.deepEqual(copy.stores, before.stores);
  assert.equal((await dump(context, 'KoboFlowDB')).stores.meta.find(m => m.id === 'dbUpgradeV4').copyDb, 'KoboFlowDB-pre-v4-20261018190000-2');
  await context.close();
});

/* ───────────── Finding every copy; copy failures; changes during the upgrade ───────────── */
const storageCheckText = async page => {
  await page.click('#settings-nav-btn'); await page.click('#storage-check-btn');
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('storage-check-out').textContent));
  await page.waitForTimeout(300);
  return page.textContent('#storage-check-out');
};

test('every retained copy is listed with version, time, size and status; edited, incomplete and used copies are told apart; each can be downloaded', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  const before = await dump(context, 'KoboFlowDB');
  // First attempt is interrupted after its copy; the second completes with a new copy.
  await context.addInitScript(failUpgrade);
  assert.equal(await openAt(page, '/KoboFlow/'), 'error');
  await page.waitForTimeout(1100);
  await context.addInitScript(() => { window.__allowUpgrade = true; });
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const [first, second] = (await copies(context)).map(c => c.name).sort();
  // A copy left half-made by a closed tab (no completion record), and an edit to the first copy in the older app.
  await probe(context, () => new Promise(res => { const q = indexedDB.open('KoboFlowDB-pre-v4-20200101000000', 3); q.onupgradeneeded = () => q.result.createObjectStore('transactions', { keyPath: 'id' }); q.onsuccess = () => { q.result.close(); res(); }; }));
  assert.equal(await openAt(page, '/old/?db=' + first.slice(11)), '1');
  await page.fill('#capture-input', '1234 lunch edited in old app'); await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => document.getElementById('capture-input').value === '');
  assert.equal(await openAt(page, '/KoboFlow/'), '1');
  const sc = await storageCheckText(page);
  assert.match(sc, /Pre-upgrade safety copies on this device \(3\)/);
  const status = async n => page.getAttribute(`[data-copy="${n}"]`, 'data-copy-status');
  assert.equal(await status(second), 'verified');
  assert.equal(await status(first), 'changed');
  assert.equal(await status('KoboFlowDB-pre-v4-20200101000000'), 'unverified');
  const row = await page.textContent(`[data-copy="${second}"]`);
  assert.match(row, /used for the upgrade/);
  assert.match(row, new RegExp('Made \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} UTC · database v3 · ' + Object.values(before.stores).reduce((t, s) => t + s.length, 0) + ' records'));
  assert.match(row, /Verified, unchanged since it was made/);
  assert.match(await page.textContent(`[data-copy="KoboFlowDB-pre-v4-20200101000000"]`), /Not verified: no record that it was completed/);
  for (const n of [first, second]) {
    const dlp = page.waitForEvent('download'); await page.click(`[data-copy="${n}"] [data-dl-copy]`);
    const f = JSON.parse(fs.readFileSync(await (await dlp).path(), 'utf8'));
    assert.equal(f.transactions.length, before.stores.transactions.length + (n === first ? 1 : 0));
  }
  assert.deepEqual((await copies(context)).map(c => c.name).sort(), ['KoboFlowDB-pre-v4-20200101000000', first, second].sort(), 'listing and downloading delete nothing');
  await context.close();
});

test('the copy used for the upgrade is still shown as verified if browser storage refused the register', { skip }, async () => {
  const { context, page } = await ctx(() => { Storage.prototype.setItem = function () { throw new DOMException('simulated', 'QuotaExceededError'); }; });
  await populateWithOldApp(page);
  assert.equal(await openAt(page, '/KoboFlow/'), '1', 'the register is optional; the verified copy is what gates the upgrade');
  const name = (await copies(context))[0].name;
  await storageCheckText(page);
  assert.equal(await page.getAttribute(`[data-copy="${name}"]`, 'data-copy-status'), 'verified');
  await context.close();
});

// Each way the copy can fail: it cannot be created, a write into it fails, or reading it back does not match.
const COPY_FAILURES = {
  'writing into the copy fails': () => { const p = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { if (/-pre-v4-/.test(this.transaction.db.name)) throw new DOMException('simulated: disk full', 'QuotaExceededError'); return p.apply(this, arguments); }; },
  'the copy does not match when read back': () => { const g = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function () { const r = g.apply(this, arguments); if (/-pre-v4-/.test(this.transaction.db.name) && this.name === 'transactions') r.addEventListener('success', () => { Object.defineProperty(r, 'result', { value: r.result.slice(1) }); }, { capture: true }); return r; }; },
};
for (const [label, init] of Object.entries(COPY_FAILURES)) {
  test(`copy failure — ${label}: no upgrade, original untouched, no half copy left, data downloadable, Storage Check honest`, { skip }, async () => {
    const { context, page } = await ctx();
    await populateWithOldApp(page);
    const before = await dump(context, 'KoboFlowDB');
    await context.addInitScript(init);
    assert.equal(await openAt(page, '/KoboFlow/'), 'error');
    assert.match(await page.textContent('#dialog-warning'), /Upgrade paused[\s\S]*Nothing was changed: your data is still in version 3/);
    assert.deepEqual(await dump(context, 'KoboFlowDB'), before);
    assert.deepEqual(await copies(context), [], 'the half-made copy was removed before the failure was reported');
    const dlp = page.waitForEvent('download'); await page.click('#dialog-warning [data-dl-paused]');
    const f = JSON.parse(fs.readFileSync(await (await dlp).path(), 'utf8'));
    assert.deepEqual(f.transactions.map(t => t.id).sort(), before.stores.transactions.map(t => t.id).sort());
    assert.deepEqual(f.ledgerSetup, before.stores.meta.find(m => m.id === 'ledgerSetup'));
    const sc = await storageCheckText(page);
    assert.match(sc, /Storage NOT available[\s\S]*Upgrade paused[\s\S]*DOWNLOAD A COPY OF YOUR DATA/);
    assert.doesNotMatch(sc, /Pre-upgrade safety copies/);
    await context.close();
  });
}

test('a record written by an older tab while upgrading is kept; the copy is reported as slightly older, not hidden', { skip }, async () => {
  const { context, page } = await ctx();
  await populateWithOldApp(page);
  // Just as the v4 upgrade is requested, another connection (an old tab) writes one more entry.
  await context.addInitScript(() => {
    const o = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, v) {
      if (name === 'KoboFlowDB' && v === 4 && !window.__wrote) {
        window.__wrote = true;
        const w = o.call(this, 'KoboFlowDB');
        w.onsuccess = () => { const d = w.result, t = d.transaction('transactions', 'readwrite'); t.objectStore('transactions').put({ id: 99999, amount: 777, desc: 'Written by an old tab', cat: 'Food', type: 'expense', state: 'Linked', date: '2026-10-01', time: '09:00', fromAcct: 'acc_opay', toAcct: '' }); t.oncomplete = () => d.close(); };
      }
      return o.apply(this, arguments);
    };
  });
  assert.equal(await openAt(page, '/KoboFlow/'), '1', 'nothing was lost, so the app runs');
  const after = await dump(context, 'KoboFlowDB');
  assert.ok(after.stores.transactions.some(t => t.id === 99999), 'the new entry is in the upgraded database');
  const copy = await dump(context, (await copies(context))[0].name);
  assert.equal(copy.stores.transactions.some(t => t.id === 99999), false);
  assert.equal(after.stores.meta.find(m => m.id === 'dbUpgradeV4').copyMatchesUpgraded, false);
  assert.match(await storageCheckText(page), /Some records were added or changed while upgrading[\s\S]*export a current backup too/);
  await context.close();
});
