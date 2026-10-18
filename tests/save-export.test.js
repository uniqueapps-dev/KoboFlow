// Failed saves and failed exports must never look successful.
// Every entry point that writes one transaction (quick capture, Add Entry, vehicle log,
// inbox approve/dismiss) and JSON export are run against the generated TEST site and,
// where practical, the production candidate, with IndexedDB failures injected.
// All data is fictional.
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

// Failure switches, installed before the app runs and flipped from the test:
//   window.__fail.write = true          every put/add throws
//   window.__fail.read  = '<store>'     getAll on that store throws
const failSwitch = () => {
  window.__fail = {};
  const P = IDBObjectStore.prototype;
  ['put', 'add'].forEach(m => { const o = P[m]; P[m] = function () { if (window.__fail.write) throw new DOMException('simulated write failure', 'QuotaExceededError'); return o.apply(this, arguments); }; });
  const g = P.getAll; P.getAll = function () { if (window.__fail.read === this.name) throw new DOMException('simulated read failure', 'UnknownError'); return g.apply(this, arguments); };
  //   window.__fail.render = true      the inbox cannot be redrawn (a display bug after a successful write)
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, enumerable: ih.enumerable, get: ih.get, set(v) { if (window.__fail.render && this.id === 'inbox-list') throw new Error('simulated display failure'); return ih.set.call(this, v); } });
  //   window.__txLog = []              records every transaction opened (stores, mode)
  const T = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (names, mode) { if (window.__txLog) window.__txLog.push({ stores: [].concat(names).sort(), mode: mode || 'readonly' }); return T.apply(this, arguments); };
};
// Playwright serializes init scripts without their closure, so the name is passed as an argument.
const openFail = name => [n => { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (x) { if (String(x) === n) throw new DOMException('simulated: storage blocked', 'SecurityError'); return o.apply(this, arguments); }; }, name];

async function ctx(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  if (Array.isArray(init)) await context.addInitScript(init[0], init[1]); else await context.addInitScript(init || failSwitch);
  const page = await context.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); return d.type() === 'prompt' ? d.accept('CLEAR') : d.accept(); });
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready]'); return page.getAttribute('body', 'data-kf-ready'); };
// Stored rows, read from an unguarded same-origin page (sees the real database).
async function rows(context, dbName) {
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  const r = await probe.evaluate(n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('transactions')) { db.close(); return res([]); } const g = db.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { db.close(); res(g.result); }; g.onerror = () => rej(g.error); }; q.onerror = () => rej(q.error); }), dbName);
  await probe.close();
  return r;
}
async function seed(context, dbName, recs) {
  const probe = await context.newPage();
  await probe.goto(base + '/probe');
  await probe.evaluate(([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); }), [dbName, recs]);
  await probe.close();
}
// Is the text shown anywhere as a record (ignoring the toast and the warning bar)?
const shownAsRecord = (page, t) => page.evaluate(t => { const b = document.body.cloneNode(true); b.querySelectorAll('#toast,#dialog-warning,input,textarea').forEach(e => e.remove()); return b.textContent.toLowerCase().includes(t); }, t);
const warning = page => page.isVisible('#dialog-warning').then(v => v ? page.textContent('#dialog-warning') : '');
const toast = page => page.textContent('#toast');
const has = (list, t) => list.some(r => String(r.desc).toLowerCase().includes(t));

/* ───────────── Quick capture ───────────── */
for (const b of BUILDS) {
  test(`${b.label}: a failed quick entry is not shown as saved, input is kept, warning persists, retry saves exactly once`, { skip }, async () => {
    const { context, page } = await ctx();
    assert.equal(await openApp(page, b.url), '1');
    await page.evaluate(() => { window.__fail.write = true; });
    await page.fill('#capture-input', '4321 zqxcapture');
    await page.press('#capture-input', 'Enter');
    await page.waitForSelector('#dialog-warning', { state: 'visible' });
    assert.match(await warning(page), /Quick entry "4321 zqxcapture" NOT saved: simulated write failure\. It was not added\. Your input is kept/);
    assert.ok(page.dialogs.some(m => /NOT saved/.test(m)), 'an alert was also raised');
    assert.equal(await page.inputValue('#capture-input'), '4321 zqxcapture', 'input not cleared');
    assert.notEqual(await page.textContent('#capture-btn'), 'SAVED');
    assert.equal(await shownAsRecord(page, 'zqxcapture'), false, 'not listed anywhere as a record');
    assert.equal(has(await rows(context, b.dbName), 'zqxcapture'), false);
    await page.waitForTimeout(2600); // longer than a toast lives
    assert.match(await warning(page), /NOT saved/, 'the warning is persistent');

    // Retry once storage works again: saved exactly once.
    await page.evaluate(() => { window.__fail.write = false; });
    await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    assert.equal(await shownAsRecord(page, 'zqxcapture'), true);
    assert.equal((await rows(context, b.dbName)).filter(r => String(r.desc).toLowerCase().includes('zqxcapture')).length, 1, 'no duplicate after retry');
    assert.equal(await page.isVisible('#dialog-warning'), false, 'the stale "NOT saved" warning is removed once the retry is saved');

    // A failure that is never retried is gone after reload, and nothing else is lost.
    await page.evaluate(() => { window.__fail.write = true; });
    await page.fill('#capture-input', '999 zqxneversaved');
    await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => /zqxneversaved" NOT saved/.test(document.getElementById('dialog-warning').textContent));
    assert.equal(await openApp(page, b.url), '1');
    assert.equal(await shownAsRecord(page, 'zqxneversaved'), false);
    assert.equal(await shownAsRecord(page, 'zqxcapture'), true);
    const stored = await rows(context, b.dbName);
    assert.equal(has(stored, 'zqxneversaved'), false);
    assert.equal(stored.length, 1);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: a successful save does not hide a different, unrelated failure warning', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await page.evaluate(() => { window.__fail.write = true; });
  await page.fill('#capture-input', '100 zqxfailed');
  await page.press('#capture-input', 'Enter');
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  await page.evaluate(() => { window.__fail.write = false; });
  await page.fill('#capture-input', '200 zqxother');
  await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => document.getElementById('capture-input').value === '');
  assert.match(await warning(page), /Quick entry "100 zqxfailed" NOT saved/, 'warning for the unsaved entry stays');
  const stored = await rows(context, 'KoboFlowDB-test');
  assert.equal(has(stored, 'zqxfailed'), false);
  assert.equal(has(stored, 'zqxother'), true);
  await context.close();
});

test('TEST build: quick entries typed back to back both save; a double Enter on the same text saves once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await page.fill('#capture-input', '15000 zqxfirst');
  await page.press('#capture-input', 'Enter');
  await page.fill('#capture-input', '700 zqxsecond');
  await page.press('#capture-input', 'Enter');
  await page.press('#capture-input', 'Enter');
  await page.waitForFunction(() => document.getElementById('capture-input').value === '');
  await page.waitForTimeout(300);
  const stored = await rows(context, 'KoboFlowDB-test');
  assert.equal(stored.filter(r => /zqxfirst/i.test(r.desc)).length, 1);
  assert.equal(stored.filter(r => /zqxsecond/i.test(r.desc)).length, 1);
  assert.equal(await page.isVisible('#dialog-warning'), false);
  await context.close();
});

/* ───────────── Add Entry, vehicle log, inbox ───────────── */
for (const b of BUILDS) {
  test(`${b.label}: Add Entry failure keeps the form open with its values; success closes it and saves once`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.evaluate(() => { window.__fail.write = true; });
    await page.click('#add-btn');
    await page.fill('#modal-amount', '2750');
    await page.fill('#modal-desc', 'zqxmodal');
    await page.click('#modal-save-btn');
    await page.waitForSelector('#dialog-warning', { state: 'visible' });
    assert.match(await warning(page), /Entry "zqxmodal" NOT saved: simulated write failure\. It was not added\. The form stays open/);
    assert.equal(await page.isVisible('#modal-overlay.open'), true, 'form still open');
    assert.equal(await page.inputValue('#modal-desc'), 'zqxmodal');
    assert.equal(await page.isDisabled('#modal-save-btn'), false, 'can retry');
    assert.notEqual(await toast(page), 'Entry saved');
    assert.equal(await shownAsRecord(page, 'zqxmodal'), false);
    assert.equal(has(await rows(context, b.dbName), 'zqxmodal'), false);

    await page.evaluate(() => { window.__fail.write = false; });
    await page.click('#modal-save-btn');
    await page.waitForSelector('#modal-overlay.open', { state: 'detached' }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
    assert.equal(await toast(page), 'Entry saved');
    assert.equal(await page.isVisible('#dialog-warning'), false, 'stale warning removed after the retry saved');
    assert.equal((await rows(context, b.dbName)).filter(r => r.desc === 'zqxmodal').length, 1);
    await openApp(page, b.url);
    assert.equal(await shownAsRecord(page, 'zqxmodal'), true, 'still there after reload');
    await context.close();
  });
}

test('TEST build: a failed vehicle log adds nothing to the log or the ledger; retry saves once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await page.click('.nav-btn[data-screen="vehicles"]');
  await page.evaluate(() => { window.__fail.write = true; });
  await page.click('.vehicle-panel.active .add-vlog-btn');
  await page.waitForSelector('#vlog-modal-overlay[data-form-ready="1"]'); // the form's delayed autofocus has run
  await page.fill('#vlog-amount', '3100');
  await page.fill('#vlog-desc', 'zqxvlog');
  await page.click('#vlog-save-btn');
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  assert.match(await warning(page), /log NOT saved: simulated write failure\. It was not added\. The form stays open/);
  assert.equal(await page.isVisible('#vlog-modal-overlay.open'), true);
  assert.equal(await page.inputValue('#vlog-desc'), 'zqxvlog');
  assert.equal(await shownAsRecord(page, 'zqxvlog'), false, 'not in the vehicle log or the ledger');
  assert.equal(has(await rows(context, 'KoboFlowDB-test'), 'zqxvlog'), false);

  await page.evaluate(() => { window.__fail.write = false; });
  await page.click('#vlog-save-btn');
  await page.waitForFunction(() => !document.getElementById('vlog-modal-overlay').classList.contains('open'));
  assert.equal(await shownAsRecord(page, 'zqxvlog'), true);
  assert.equal((await rows(context, 'KoboFlowDB-test')).filter(r => /zqxvlog/.test(r.desc)).length, 1);
  await context.close();
});

test('TEST build: a failed inbox approve leaves the stored and shown status unchanged; retry applies it', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await seed(context, 'KoboFlowDB-test', [{ id: 501, amount: 4200, desc: 'zqxinbox', cat: 'Supplies', type: 'expense', state: 'Needs Review', date: '2026-10-10', time: '09:00', fromAcct: '', toAcct: '' }]);
  await openApp(page, '/koboflow-test/');
  await page.click('.nav-btn[data-screen="inbox"]');
  await page.evaluate(() => { window.__fail.write = true; });
  await page.click('[data-approve="501"]');
  await page.waitForSelector('#dialog-warning', { state: 'visible' });
  assert.match(await warning(page), /Inbox change \(Linked\) NOT saved: simulated write failure\. The item keeps its previous status/);
  assert.equal(await page.isVisible('[data-approve="501"]'), true, 'still shown as needing review');
  assert.equal((await rows(context, 'KoboFlowDB-test')).find(r => r.id === 501).state, 'Needs Review');

  await page.evaluate(() => { window.__fail.write = false; });
  await page.click('[data-approve="501"]');
  await page.waitForSelector('[data-approve="501"]', { state: 'detached' });
  const stored = await rows(context, 'KoboFlowDB-test');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state, 'Linked');
  assert.equal(await page.isVisible('#dialog-warning'), false);
  await context.close();
});

/* ───────────── JSON export ───────────── */
const download = async page => {
  const p = page.waitForEvent('download', { timeout: 2500 }).catch(() => null);
  await page.click('#export-json-btn');
  return p;
};

for (const b of BUILDS) {
  test(`${b.label}: export when the database cannot open produces no file and reports failure`, { skip }, async () => {
    const { context, page } = await ctx(openFail(b.dbName));
    assert.equal(await openApp(page, b.url), 'error');
    await page.click('.nav-btn[data-screen="settings"]');
    assert.equal(await download(page) ? 'a file was downloaded' : 'no file', 'no file', 'no backup file offered');
    assert.match(await warning(page), new RegExp(`Backup NOT created: a reliable backup could not be produced from ${b.dbName} \\(simulated: storage blocked\\)\\. No file was saved\\.`));
    assert.ok(page.dialogs.some(m => /Backup NOT created/.test(m)));
    assert.notEqual(await toast(page), 'JSON backup exported');
    await context.close();
  });

  test(`${b.label}: export when one store cannot be read produces no partial file and reports failure`, { skip }, async () => {
    const { context, page } = await ctx();
    assert.equal(await openApp(page, b.url), '1');
    await page.fill('#capture-input', '2500 zqxexport');
    await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    await page.evaluate(() => { window.__fail.read = 'agreements'; });
    await page.click('.nav-btn[data-screen="settings"]');
    assert.equal(await download(page) ? 'a file was downloaded' : 'no file', 'no file', 'no partial backup offered');
    assert.match(await warning(page), /Backup NOT created: .*simulated read failure.*No file was saved/);
    assert.notEqual(await toast(page), 'JSON backup exported');
    await context.close();
  });

  test(`${b.label}: normal export still works and contains what was saved`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.fill('#capture-input', '2500 zqxexport');
    await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    await page.click('.nav-btn[data-screen="settings"]');
    const dl = await download(page);
    assert.ok(dl, 'backup downloaded');
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(backup.app, 'KoboFlow');
    assert.equal(backup.version, '4.0');
    if (b.dbName === 'KoboFlowDB-test') assert.equal(backup.testDatabase, 'KoboFlowDB-test');
    else assert.equal(backup.testDatabase, undefined);
    assert.equal(backup.transactions.filter(t => /zqxexport/.test(t.desc)).length, 1);
    assert.ok(backup.transactions.every(t => !t.demo), 'sample data is not exported');
    for (const k of ['agreements', 'instalments', 'allocations', 'agreementEvents', 'opportunities', 'accounts']) assert.ok(Array.isArray(backup[k]), k);
    assert.equal(backup.ledgerSetup, null);
    assert.equal(await toast(page), 'JSON backup exported');
    assert.equal(await page.isVisible('#dialog-warning'), false);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

/* ───────────── Final-review fixes ───────────── */
for (const b of BUILDS) {
  test(`${b.label}: a quick entry that is saved but cannot be drawn says it WAS saved, clears the input, and is not duplicated`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.evaluate(() => { window.__fail.render = true; });
    await page.fill('#capture-input', '4100 zqxdrawfail');
    await page.press('#capture-input', 'Enter');
    await page.waitForSelector('#dialog-warning', { state: 'visible' });
    const w = await warning(page);
    assert.match(w, new RegExp(`The change WAS saved to ${b.dbName}, but the screen could not be refreshed \\(simulated display failure\\)\\. Do not enter it again\\.`));
    assert.doesNotMatch(w, /NOT saved/);
    assert.ok(!page.dialogs.some(m => /NOT saved/.test(m)), 'no "NOT saved" alert');
    assert.equal(await page.inputValue('#capture-input'), '', 'input cleared, so it is not re-entered');
    await page.press('#capture-input', 'Enter'); // nothing to resubmit
    await page.evaluate(() => { window.__fail.render = false; });
    await openApp(page, b.url);
    assert.equal((await rows(context, b.dbName)).filter(r => /zqxdrawfail/i.test(r.desc)).length, 1, 'stored exactly once');
    assert.equal(await shownAsRecord(page, 'zqxdrawfail'), true, 'shown after reload');
    await context.close();
  });

  test(`${b.label}: export reads every store in ONE read-only transaction (a consistent snapshot)`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.fill('#capture-input', '2500 zqxsnapshot');
    await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    await page.click('.nav-btn[data-screen="settings"]');
    await page.evaluate(() => { window.__txLog = []; });
    const dl = await download(page);
    assert.ok(dl, 'backup downloaded');
    const log = await page.evaluate(() => window.__txLog);
    assert.deepEqual(log, [{ stores: ['agreementEvents', 'agreements', 'allocations', 'bills', 'instalments', 'meta', 'opportunities', 'transactions'], mode: 'readonly' }]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(backup.transactions.filter(t => /zqxsnapshot/.test(t.desc)).length, 1);
    await context.close();
  });
}

test('TEST build: a write issued right after export starts is either wholly in the backup or wholly absent (never half)', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await page.click('.nav-btn[data-screen="settings"]');
  // A two-store write (transaction + agreement) issued in the same tick as the export click.
  const p = page.waitForEvent('download', { timeout: 5000 });
  await page.evaluate(() => {
    document.getElementById('export-json-btn').click();
    const q = indexedDB.open('KoboFlowDB-test');
    q.onsuccess = () => { const tx = q.result.transaction(['transactions', 'agreements'], 'readwrite'); tx.objectStore('transactions').put({ id: 777, amount: 10, desc: 'zqxpair', type: 'expense', date: '2026-10-01', time: '09:00' }); tx.objectStore('agreements').put({ id: 'agr_zqx', name: 'zqxpair' }); tx.oncomplete = () => q.result.close(); };
  });
  const backup = JSON.parse(fs.readFileSync(await (await p).path(), 'utf8'));
  const hasTx = backup.transactions.some(t => t.id === 777), hasAgr = backup.agreements.some(a => a.id === 'agr_zqx');
  assert.equal(hasTx, hasAgr, `consistent snapshot (transaction in backup: ${hasTx}, agreement in backup: ${hasAgr})`);
  await context.close();
});

/* ───────────── Delayed autofocus never steals focus ───────────── */
// Both forms focus their amount field ~100 ms after opening. That used to happen even when the
// user had already tapped another field, so the next characters typed were lost (a number field
// rejects them). Reproduced: typing that started 88–94 ms after opening the vehicle log was lost.
const FORMS = [
  { name: 'vehicle log', screen: 'vehicles', open: '.vehicle-panel.active .add-vlog-btn', overlay: 'vlog-modal-overlay', other: 'vlog-desc', first: 'vlog-amount' },
  { name: 'Add Entry', screen: 'home', open: '#add-btn', overlay: 'modal-overlay', other: 'modal-desc', first: 'modal-amount' },
];
for (const b of BUILDS) {
  for (const f of FORMS) {
    test(`${b.label}: ${f.name} — typing in another field before the delayed autofocus keeps the text and the focus`, { skip }, async () => {
      const { context, page } = await ctx();
      await openApp(page, b.url);
      await page.click(`.nav-btn[data-screen="${f.screen}"]`);
      await page.click(f.open);
      // Immediately (well inside the 100 ms window): tap the other field and start typing; then keep
      // typing after the autofocus would have fired (form-ready flag, or 400 ms if there is none).
      const r = await page.evaluate(({ overlay, other }) => new Promise(res => {
        const el = document.getElementById(other), ov = document.getElementById(overlay), t0 = Date.now();
        el.focus(); document.execCommand('insertText', false, 'abc');
        (function wait() {
          if (ov.getAttribute('data-form-ready') !== '1' && Date.now() - t0 < 400) return setTimeout(wait, 10);
          document.execCommand('insertText', false, 'def');
          res({ value: el.value, active: document.activeElement && document.activeElement.id });
        })();
      }), f);
      assert.deepEqual(r, { value: 'abcdef', active: f.other }, 'all typed text kept in the field the user chose');
      assert.equal(await page.getAttribute('#' + f.overlay, 'data-form-ready'), '1');
      await context.close();
    });

    test(`${b.label}: ${f.name} — an untouched form still focuses its first field`, { skip }, async () => {
      const { context, page } = await ctx();
      await openApp(page, b.url);
      await page.click(`.nav-btn[data-screen="${f.screen}"]`);
      await page.click(f.open);
      await page.waitForSelector(`#${f.overlay}[data-form-ready="1"]`);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), f.first);
      // Reopening resets the flag and runs the autofocus again.
      await page.evaluate(o => document.getElementById(o).classList.remove('open'), f.overlay);
      await page.click(f.open);
      assert.equal(await page.getAttribute('#' + f.overlay, 'data-form-ready'), null, 'flag cleared on reopening');
      await page.waitForSelector(`#${f.overlay}[data-form-ready="1"]`);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), f.first);
      await context.close();
    });
  }
}
