// ACCOUNTS & OPENING BALANCES: edits must reach the database, the review must show
// what changes, and the form must never show values that were not saved.
// Runs against the generated TEST site and the production candidate. Fictional data only.
//
// The original defect: leaving an account field fired "change", whose handler re-rendered
// every account row. The field the user had just tapped (usually Opening Balance) was
// destroyed, focus fell to <body>, the typed amount went nowhere, and the old balance was
// reviewed and saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

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

// Switches installed before the app runs:
//   __fail.write    every put throws
//   __fail.corrupt  ledgerSetup is stored with a different opening balance (read-back mismatch)
//   __hold          transactions complete, but their completion is delivered only on __release()
const switches = () => {
  window.__fail = {};
  const P = IDBObjectStore.prototype, put = P.put;
  P.put = function (rec) {
    if (window.__fail.write) throw new DOMException('simulated write failure', 'QuotaExceededError');
    if (window.__fail.corrupt && rec && rec.id === 'ledgerSetup') { const c = JSON.parse(JSON.stringify(rec)); c.accounts[0].opening = 1; return put.call(this, c); }
    return put.apply(this, arguments);
  };
  window.__hold = false; window.__held = [];
  const T = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () {
    const tx = T.apply(this, arguments);
    if (window.__hold) {
      let h = null;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return h; }, set(f) { h = f; } });
      tx.addEventListener('complete', e => { window.__held.push(() => h && h.call(tx, e)); });
    }
    return tx;
  };
  window.__release = () => { window.__hold = false; window.__held.splice(0).forEach(f => f()); };
  // __holdFail: the transaction is aborted (nothing is written), and its failure is delivered to the
  // app only when __failHeld() is called, so the test can act while the app still shows SAVING…
  window.__holdFail = false; window.__heldErr = [];
  const T2 = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () {
    const tx = T2.apply(this, arguments);
    if (window.__holdFail) {
      let ok = null, err = null;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return ok; }, set(f) { ok = f; } });
      Object.defineProperty(tx, 'onerror', { configurable: true, get() { return err; }, set(f) { err = f; } });
      Object.defineProperty(tx, 'onabort', { configurable: true, get() { return err; }, set(f) { err = f; } });
      queueMicrotask(() => { try { tx.abort(); } catch (e) { /* already finished */ } }); // really not written
      window.__heldErr.push(() => err && err.call(tx, new Event('error')));
    }
    return tx;
  };
  window.__failHeld = () => { window.__holdFail = false; window.__heldErr.splice(0).forEach(f => f()); };
  // __failRender: the dashboard account cards cannot be drawn (a display bug after a successful write).
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, enumerable: ih.enumerable, get: ih.get, set(v) { if (window.__failRender && this.id === 'accounts-scroll') throw new Error('simulated display failure'); return ih.set.call(this, v); } });
};

async function ctx() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await context.addInitScript(switches);
  const page = await context.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.type() + ': ' + d.message()); return d.accept(); });
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
async function probe(context, fn, arg) {
  const p = await context.newPage();
  await p.goto(base + '/probe');
  const r = await p.evaluate(fn, arg);
  await p.close();
  return r;
}
const storedSetup = (context, dbName) => probe(context, n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result || null); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), dbName);
const storedTxns = (context, dbName) => probe(context, n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), dbName);
const seedTxn = (context, dbName, rec) => probe(context, ([n, r]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); tx.objectStore('transactions').put(r); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); }), [dbName, rec]);

const row = (page, i) => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
const formValues = page => page.$$eval('#setup-accounts [data-acct-row]', rs => rs.map(r => ({ label: r.querySelector('[data-f=label]').value, opening: r.querySelector('[data-f=opening]').value })));
const cards = page => page.$$eval('.acct-card', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
async function openEdit(page) {
  if (!(await page.isVisible('#setup-open-btn'))) await page.click('#settings-nav-btn');
  await page.click('#setup-open-btn');
  await page.waitForSelector('#setup-modal.open');
}
// Type like a person: tap the field, clear it, type, without Playwright's fill() shortcut.
async function tapType(page, locator, text) {
  await locator.tap();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}
async function reviewAndConfirm(page) {
  await page.tap('#setup-save-btn');
  await page.waitForSelector('#setup-confirm-btn');
  const summary = await page.textContent('#setup-confirm');
  await page.tap('#setup-confirm-btn');
  return summary;
}
// Fictional starting point: Opay 100,000 and "Fictional Bank A" 20,000, all quick-capture names → Opay.
async function initialSetup(page) {
  await openEdit(page);
  await page.fill('#setup-baseline', '2026-10-01');
  await tapType(page, row(page, 0).locator('[data-f=opening]'), '100000');
  await page.tap('#setup-add-acct');
  await tapType(page, row(page, 1).locator('[data-f=label]'), 'Fictional Bank A');
  await row(page, 1).locator('[data-f=kind]').selectOption('bank');
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '20000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await reviewAndConfirm(page);
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}

for (const b of BUILDS) {
  test(`${b.label}: typing a new name then tapping straight into Opening Balance keeps the amount (the reported bug)`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await initialSetup(page);
    await seedTxn(context, b.dbName, { id: 9001, amount: 1500, desc: 'zqx unrelated entry', cat: 'Food', type: 'expense', fromAcct: 'acc_opay', toAcct: '', state: 'AI Categorized', date: '2026-10-02', time: '08:00' });
    await openApp(page, b.url);
    const before = await storedSetup(context, b.dbName);
    assert.deepEqual(before.accounts.map(a => [a.label, a.opening]), [['Opay', 100000], ['Fictional Bank A', 20000]]);

    await openEdit(page);
    await tapType(page, row(page, 1).locator('[data-f=label]'), 'Fictional Bank B');
    await row(page, 1).locator('[data-f=opening]').tap(); // leaving the name field fires "change"
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-f')), 'opening', 'the tapped field keeps focus');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
    await page.keyboard.type('35000');
    assert.deepEqual(await formValues(page), [{ label: 'Opay', opening: '100000' }, { label: 'Fictional Bank B', opening: '35000' }]);

    // Review shows what changes, before → after.
    await page.tap('#setup-save-btn');
    await page.waitForSelector('#setup-confirm-btn');
    const summary = await page.textContent('#setup-confirm');
    assert.match(summary, /What changes/);
    assert.match(summary, /Renamed: Fictional Bank A → Fictional Bank B/);
    assert.match(summary, /Fictional Bank B opening balance: ₦20,000 → ₦35,000/);
    assert.doesNotMatch(summary, /Opay opening balance/, 'unchanged accounts are not listed as changes');
    await page.tap('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    assert.equal(await page.textContent('#toast'), 'Accounts updated — saved & verified');

    // Persisted, independently of what the form shows.
    const after = await storedSetup(context, b.dbName);
    assert.deepEqual(after.accounts.map(a => [a.label, a.opening]), [['Opay', 100000], ['Fictional Bank B', 35000]]);
    assert.equal(after.accounts[1].id, before.accounts[1].id, 'same account record, renamed (not a new one)');
    const last = after.history[after.history.length - 1].changes.map(c => c.field).sort();
    assert.deepEqual(last, ['label', 'opening'], 'rename and balance change recorded in setup history');
    assert.ok((await cards(page)).some(c => /Fictional Bank B ?₦35,000/.test(c)), 'dashboard shows the saved figures');

    // Reopening Edit shows the saved values, before and after a reload.
    await openEdit(page);
    assert.deepEqual(await formValues(page), [{ label: 'Opay', opening: '100000' }, { label: 'Fictional Bank B', opening: '35000' }]);
    assert.equal(await page.isVisible('#setup-unsaved-note'), false);
    await openApp(page, b.url);
    await openEdit(page);
    assert.deepEqual(await formValues(page), [{ label: 'Opay', opening: '100000' }, { label: 'Fictional Bank B', opening: '35000' }]);

    // Unrelated financial data untouched.
    const txs = await storedTxns(context, b.dbName);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].desc, 'zqx unrelated entry');
    assert.deepEqual(page.dialogs, [], 'no native dialogs anywhere in the setup flow');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: the setup flow needs no native dialog: it saves even when confirm/alert are blocked', { skip }, async () => {
  const { context, page } = await ctx();
  await page.addInitScript(() => { window.confirm = () => false; window.alert = () => {}; window.prompt = () => null; });
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts.length, 2);
  assert.equal(await page.isVisible('#dialog-warning'), false, 'no "dialog blocked" warning: none was used');
  await context.close();
});

test('TEST build: reviewing with no edits says so; Back to Edit and typing during review keep the edits', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await page.tap('#setup-save-btn');
  assert.match(await page.textContent('#setup-confirm'), /No changes from the saved setup/);
  await page.tap('#setup-back-btn');
  await tapType(page, row(page, 0).locator('[data-f=opening]'), '111111');
  await page.tap('#setup-save-btn');
  assert.match(await page.textContent('#setup-confirm'), /Opay opening balance: ₦100,000 → ₦111,111/);
  await page.tap('#setup-back-btn');
  assert.equal((await formValues(page))[0].opening, '111111', 'Back to Edit keeps the edit');
  await page.tap('#setup-save-btn');
  await row(page, 0).locator('[data-f=opening]').tap();
  await page.keyboard.type('2'); // typing while the summary is shown returns to editing
  assert.equal(await page.isVisible('#setup-confirm-btn'), false, 'stale summary withdrawn');
  assert.equal(await page.isVisible('#setup-save-btn'), true);
  assert.equal((await formValues(page))[0].opening, '1111112');
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts[0].opening, 100000, 'nothing saved until confirmed');
  await context.close();
});

test('TEST build: closing with unsaved edits saves nothing, keeps them visibly marked unsaved, and Discard restores the saved values', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '77777');
  await page.tap('#setup-save-btn'); // reviewed but not confirmed
  await page.tap('[data-close="setup-modal"]');
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts[1].opening, 20000, 'nothing written');
  assert.ok((await cards(page)).some(c => /Fictional Bank A ?₦20,000/.test(c)), 'dashboard still shows saved figures');

  await openEdit(page);
  assert.match(await page.textContent('#setup-unsaved-note'), /Unsaved changes\. These edits from earlier have NOT been saved/);
  assert.equal((await formValues(page))[1].opening, '77777');
  await page.tap('#setup-discard-btn');
  assert.equal(await page.isVisible('#setup-unsaved-note'), false);
  assert.deepEqual(await formValues(page), [{ label: 'Opay', opening: '100000' }, { label: 'Fictional Bank A', opening: '20000' }]);
  await page.tap('[data-close="setup-modal"]');
  await openEdit(page);
  assert.equal(await page.isVisible('#setup-unsaved-note'), false, 'after Discard, reopening is clean');
  // An unsaved draft is never restored after a reload (it lived only in memory).
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '55555');
  await openApp(page, '/koboflow-test/');
  await openEdit(page);
  assert.equal((await formValues(page))[1].opening, '20000');
  await context.close();
});

for (const b of BUILDS) {
  test(`${b.label}: a failed write says "Not saved", keeps the edits and the saved record; a retry then saves`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await initialSetup(page);
    await openEdit(page);
    await tapType(page, row(page, 1).locator('[data-f=opening]'), '42000');
    await page.evaluate(() => { window.__fail.write = true; });
    await reviewAndConfirm(page);
    await page.waitForFunction(() => /Not saved\./.test(document.getElementById('setup-result').textContent));
    assert.match(await page.textContent('#setup-result'), /Not saved\. simulated write failure.*Nothing was changed; your edits are still in the form/);
    assert.equal(await page.isVisible('#setup-modal.open'), true);
    assert.equal(await page.isEnabled('#setup-confirm-btn'), true, 'form unlocked for a retry');
    assert.equal((await formValues(page))[1].opening, '42000');
    assert.notEqual(await page.textContent('#toast'), 'Accounts updated — saved & verified');
    assert.equal((await storedSetup(context, b.dbName)).accounts[1].opening, 20000, 'saved record untouched');
    assert.ok((await cards(page)).some(c => /Fictional Bank A ?₦20,000/.test(c)), 'live figures still the saved ones');

    await page.evaluate(() => { window.__fail.write = false; });
    await page.tap('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    assert.equal((await storedSetup(context, b.dbName)).accounts[1].opening, 42000);
    await context.close();
  });
}

test('TEST build: a write whose read-back does not match is reported as NOT verified, never as saved', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await tapType(page, row(page, 0).locator('[data-f=opening]'), '150000');
  await page.evaluate(() => { window.__fail.corrupt = true; });
  await reviewAndConfirm(page);
  await page.waitForFunction(() => /NOT verified/.test(document.getElementById('setup-result').textContent));
  const msg = await page.textContent('#setup-result');
  assert.match(msg, /Save NOT verified\. Reading the setup back from KoboFlowDB-test did not match what you entered\./);
  assert.match(msg, /may now hold a different setup/);
  assert.doesNotMatch(msg, /Nothing was changed/, 'does not falsely claim nothing changed');
  assert.notEqual(await page.textContent('#toast'), 'Accounts updated — saved & verified');
  assert.ok((await cards(page)).some(c => /Opay ?₦100,000/.test(c)), 'the unverified values are not shown as live figures');
  await context.close();
});

test('TEST build: the form is locked while the save is in flight, so nothing typed then is lost', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '64000');
  await page.tap('#setup-save-btn');
  await page.evaluate(() => { window.__hold = true; });
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => window.__held.length > 0);
  assert.equal(await page.textContent('#setup-confirm-btn'), 'SAVING…');
  assert.equal(await page.isDisabled('#setup-accounts [data-acct-row="1"] [data-f=opening]'), true);
  assert.equal(await page.isDisabled('#setup-add-acct'), true);
  assert.equal(await page.isDisabled('#setup-confirm-btn'), true, 'cannot be submitted twice');
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts[1].opening, 64000);
  await openEdit(page);
  assert.equal(await page.isDisabled('#setup-add-acct'), false, 'unlocked again');
  assert.equal(await page.isDisabled('#setup-accounts [data-acct-row="1"] [data-f=opening]'), false);
  await context.close();
});

/* ───────────── Final-review fixes ───────────── */
test('TEST build: the form cannot be closed while saving, and a failure delivered then is shown', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '61000');
  await page.tap('#setup-save-btn');
  await page.evaluate(() => { window.__holdFail = true; });
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => window.__heldErr.length > 0);
  await page.mouse.click(5, 5); // tap outside the form while it says SAVING…
  assert.equal(await page.isVisible('#setup-modal.open'), true, 'form stays open while saving');
  assert.match(await page.textContent('#setup-result'), /Still saving\. The form stays open until the save finishes\./);
  assert.equal(await page.isDisabled('[data-close="setup-modal"]'), true, '× is disabled while saving');
  await page.evaluate(() => window.__failHeld());
  await page.waitForFunction(() => /Not saved\./.test(document.getElementById('setup-result').textContent));
  assert.equal(await page.isVisible('#setup-modal.open'), true);
  assert.equal((await formValues(page))[1].opening, '61000', 'edits kept');
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts[1].opening, 20000);
  assert.notEqual(await page.textContent('#toast'), 'Accounts updated — saved & verified');
  await context.close();
});

test('TEST build: if the form is somehow not visible when a save fails, the failure is shown outside it', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await tapType(page, row(page, 1).locator('[data-f=opening]'), '62000');
  await page.tap('#setup-save-btn');
  await page.evaluate(() => { window.__holdFail = true; });
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => window.__heldErr.length > 0);
  await page.evaluate(() => { document.getElementById('setup-modal').classList.remove('open'); window.__failHeld(); }); // forced, bypassing the UI
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  assert.match(await page.textContent('#dialog-warning'), /Account setup NOT saved: .*Open Settings → Accounts to check\./);
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts[1].opening, 20000);
  await context.close();
});

test('TEST build: a quick-capture mapping changed and changed back is reported as no change', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  await openEdit(page);
  await page.selectOption('#setup-aliases [data-alias="pharma_cash"]', '__unset');
  await page.selectOption('#setup-aliases [data-alias="pharma_cash"]', 'acc_opay');
  await page.tap('#setup-save-btn');
  const summary = await page.textContent('#setup-confirm');
  assert.match(summary, /No changes from the saved setup/);
  assert.doesNotMatch(summary, /Quick-capture "/);
  await context.close();
});

test('TEST build: earmark and quick-capture mapping changes are reviewed with before → after values and saved', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await initialSetup(page);
  const bankId = (await storedSetup(context, 'KoboFlowDB-test')).accounts[1].id;
  // Add an earmark and change one mapping.
  await openEdit(page);
  await page.tap('#setup-add-bucket');
  const bk = page.locator('#setup-buckets [data-bucket-row="0"]');
  await tapType(page, bk.locator('[data-f=label]'), 'Fictional Rent');
  await bk.locator('[data-f=parentId]').selectOption('acc_opay');
  await tapType(page, bk.locator('[data-f=amount]'), '1000');
  await page.selectOption('#setup-aliases [data-alias="pers_cash"]', bankId);
  let lines = await (async () => { await page.tap('#setup-save-btn'); return page.$$eval('#setup-confirm [data-setup-change]', e => e.map(x => x.textContent)); })();
  assert.deepEqual(lines.sort(), ['New earmark: Fictional Rent ₦1,000 inside Opay', 'Quick-capture "Personal Cash": Opay → Fictional Bank A'].sort());
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  let st = await storedSetup(context, 'KoboFlowDB-test');
  assert.deepEqual(st.buckets.map(b => [b.label, b.parentId, b.amount]), [['Fictional Rent', 'acc_opay', 1000]]);
  assert.equal(st.aliases.pers_cash, bankId);
  // Change the earmark (amount and account) and set a mapping to "Not used".
  await openEdit(page);
  await tapType(page, bk.locator('[data-f=amount]'), '1500');
  await bk.locator('[data-f=parentId]').selectOption(bankId);
  await page.selectOption('#setup-aliases [data-alias="coop"]', '');
  await page.tap('#setup-save-btn');
  lines = await page.$$eval('#setup-confirm [data-setup-change]', e => e.map(x => x.textContent));
  assert.deepEqual(lines.sort(), ['Earmark: Fictional Rent ₦1,000 inside Opay → Fictional Rent ₦1,500 inside Fictional Bank A', 'Quick-capture "Coop Savings": Opay → Not used'].sort());
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  // Remove the earmark.
  await openEdit(page);
  await page.tap('[data-remove-bucket="0"]');
  await page.tap('#setup-save-btn');
  lines = await page.$$eval('#setup-confirm [data-setup-change]', e => e.map(x => x.textContent));
  assert.deepEqual(lines, ['Removed earmark: Fictional Rent ₦1,500 inside Fictional Bank A']);
  await page.tap('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  st = await storedSetup(context, 'KoboFlowDB-test');
  assert.deepEqual(st.buckets, []);
  assert.equal(st.aliases.coop, '');
  const fields = st.history.slice(-3).map(h => h.changes.map(c => c.field).sort().join(','));
  assert.deepEqual(fields, ['earmark_added,mapping', 'earmark,mapping', 'earmark_removed'], 'each change recorded in setup history');
  await context.close();
});

for (const b of BUILDS) {
  test(`${b.label}: a setup save that succeeds but cannot redraw the screen says it WAS saved, never "Not saved"`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await initialSetup(page);
    await openEdit(page);
    await tapType(page, row(page, 1).locator('[data-f=opening]'), '73000');
    await page.evaluate(() => { window.__failRender = true; });
    await reviewAndConfirm(page);
    await page.waitForSelector('#dialog-warning', { state: 'visible' });
    const w = await page.textContent('#dialog-warning');
    assert.match(w, new RegExp(`Your account setup WAS saved to ${b.dbName}, but the screen could not be refreshed \\(simulated display failure\\)\\. Do not enter it again\\. Reload KoboFlow to see it\\.`));
    assert.doesNotMatch(await page.textContent('#setup-result'), /Not saved|NOT verified/);
    assert.equal(await page.isVisible('#setup-modal.open'), false, 'form closed: nothing to retry');
    assert.equal((await storedSetup(context, b.dbName)).accounts[1].opening, 73000);
    await page.evaluate(() => { window.__failRender = false; });
    await openApp(page, b.url);
    await openEdit(page);
    assert.equal((await formValues(page))[1].opening, '73000', 'after reload the saved value is shown');
    await context.close();
  });
}
