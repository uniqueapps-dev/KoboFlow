// User-entered and imported text is shown as text, never parsed as HTML or run as code;
// and startup reports a display or data problem honestly instead of "Storage unavailable".
// Runs against the generated TEST site and the production candidate. All data is fictional;
// the payloads only record that they ran (they push a tag into window.__kfx).
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
// Breaks out of text and of a quoted attribute, carries a handler, and leaves a marker element.
const P = tag => `Z${tag}"'><img src=x onerror="(window.__kfx=window.__kfx||[]).push('${tag}')"><b data-kfx="${tag}">${tag}</b>`;

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

async function ctx(init, arg) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  if (init) await context.addInitScript(init, arg);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Fictional reason') : d.accept());
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready]'); return page.getAttribute('body', 'data-kf-ready'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
// Nothing injected: no marker element, no handler ran, no stray <img>/<iframe>.
const injection = page => page.evaluate(() => ({ markers: document.querySelectorAll('[data-kfx]').length, ran: (window.__kfx || []).slice(), imgs: document.querySelectorAll('img[src="x"]').length, frames: document.querySelectorAll('iframe').length }));
const clean = { markers: 0, ran: [], imgs: 0, frames: 0 };
async function visitAll(page) { for (const sc of await page.$$eval('.nav-btn', bs => bs.map(x => x.dataset.screen))) await nav(page, sc); }
async function runStorageCheck(page) {
  await page.click('#settings-nav-btn');
  await page.click('#storage-check-btn');
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('storage-check-out').textContent));
  return page.textContent('#storage-check-out');
}
async function liveSetup(page, label) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn');
  await page.fill('#setup-baseline', '2026-10-01');
  await page.locator('[data-acct-row="0"] [data-f=label]').fill(label);
  await page.locator('[data-acct-row="0"] [data-f=opening]').fill('100000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
async function addEntry(page, amount, desc) {
  await page.click('#add-btn'); await page.fill('#modal-amount', String(amount)); await page.fill('#modal-desc', desc);
  await page.selectOption('#modal-from', { index: 1 }); // an expense needs the account it is paid from
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
}

for (const b of BUILDS) {
  test(`${b.label}: HTML-looking descriptions, vehicle logs and account names are shown as literal text and never run`, { skip }, async () => {
    const { context, page } = await ctx();
    assert.equal(await openApp(page, b.url), '1');
    const acct = 'Fictional <b>Bank</b> & "Co" ' + P('acct');
    const plain = 'Café — ₦5,000 & "quotes" \'single\' <tag> 100%';
    await liveSetup(page, acct);
    await page.fill('#capture-input', '1200 <iframe> ' + P('capture')); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    await addEntry(page, 700, P('entry'));
    await addEntry(page, 2500, plain);
    await nav(page, 'vehicles');
    await page.click('.vehicle-panel.active .add-vlog-btn'); await page.fill('#vlog-amount', '300'); await page.fill('#vlog-desc', '<img src=x onerror=alert(1)> ' + P('vlog'));
    await page.click('#vlog-save-btn');
    await page.waitForFunction(() => !document.getElementById('vlog-modal-overlay').classList.contains('open'));
    await visitAll(page);
    assert.deepEqual(await injection(page), clean, 'nothing injected while entering');

    // Shown literally, exactly as typed.
    const txt = await page.evaluate(() => ({
      inbox: [...document.querySelectorAll('.inbox-desc-txt')].map(e => e.textContent),
      timeline: [...document.querySelectorAll('#timeline-list .tl-desc')].map(e => e.textContent),
      cards: [...document.querySelectorAll('.acct-card .acct-name')].map(e => e.textContent),
      options: [...document.querySelectorAll('#modal-from option')].map(e => e.textContent),
      vlog: [...document.querySelectorAll('.vlog-desc')].map(e => e.textContent),
    }));
    assert.ok(txt.inbox.includes(plain), 'inbox shows Unicode and punctuation unchanged');
    assert.ok(txt.timeline.includes(plain), 'timeline shows Unicode and punctuation unchanged');
    assert.ok(txt.inbox.includes(P('entry')) && txt.timeline.includes(P('entry')), 'payload shown as text');
    assert.ok(txt.cards.some(c => c.endsWith(acct)), 'dashboard card shows the account name literally');
    assert.ok(txt.options.includes(acct), 'Add Entry dropdown shows the account name literally');
    assert.ok(txt.vlog.some(v => v.startsWith('<img src=x onerror=alert(1)> ')), 'vehicle log shows the markup as text');

    // Saved and reloaded: startup is not broken and storage is reported as working.
    assert.equal(await openApp(page, b.url), '1', 'startup succeeds with markup in stored text');
    await visitAll(page);
    assert.deepEqual(await injection(page), clean, 'nothing injected after reload');
    assert.match(await runStorageCheck(page), new RegExp(`Storage: available[\\s\\S]*Database: ${b.dbName} \\(v4\\)[\\s\\S]*Stored entries: 4 `));
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: a crafted backup with markup in ids, names, types and events imports as plain text and cannot run`, { skip }, async () => {
    // Build a real backup on one device: an agreement, a payment and a note.
    const src = await ctx();
    await openApp(src.page, b.url);
    await nav(src.page, 'loans'); await src.page.click('#new-agr-btn');
    await src.page.fill('#agr-name', 'Fictional Lender'); await src.page.fill('#agr-counterparty', 'Fictional Co');
    await src.page.fill('#agr-principal', '150000'); await src.page.fill('#agr-cash', '150000'); await src.page.fill('#agr-count', '4');
    await src.page.fill('#agr-first', '2026-11-20'); await src.page.fill('#agr-inst', '55455'); await src.page.check('#agr-funds-received');
    await src.page.waitForSelector('#agr-preview .sched'); await src.page.click('#agr-save-btn'); await src.page.waitForSelector('#screen-agreement.active');
    await src.page.click('#settings-nav-btn');
    const [dl] = await Promise.all([src.page.waitForEvent('download'), src.page.click('#export-json-btn')]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    await src.context.close();
    // Tamper with it: markup everywhere a string can go.
    const a = backup.agreements[0], aid = P('agr-id');
    Object.assign(a, { id: aid, name: P('agr-name'), counterparty: P('agr-cp'), notes: P('agr-notes') });
    backup.instalments.forEach((i, k) => { i.agreementId = aid; i.id = P('inst-id') + k; });
    backup.agreementEvents.forEach((e, k) => { e.agreementId = aid; e.id = P('ev-id') + k; e.type = P('ev-type'); });
    backup.allocations = [];
    backup.transactions.forEach(t => { t.agreementId = aid; t.desc = P('tx-desc'); t.cat = P('tx-cat'); t.time = P('tx-time'); t.state = P('tx-state'); t.type = t.type === 'loan_receipt' ? t.type : P('tx-type'); t.fromAcct = P('tx-from'); });
    backup.transactions.push({ id: 99001, amount: 10, desc: 'zqx', cat: 'Food', type: P('tx-type2'), state: 'Needs Review', date: '2026-10-05', time: '09:00', fromAcct: P('tx-from2'), toAcct: P('tx-to2') });
    a.receiptTxnId = backup.transactions[0] ? backup.transactions[0].id : null;
    const file = path.join(require('os').tmpdir(), `kf-crafted-${process.pid}-${b.dbName}.json`);
    fs.writeFileSync(file, JSON.stringify(backup));

    // Import on a fresh device.
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await page.click('#settings-nav-btn');
    await page.setInputFiles('#import-file-input', file);
    await page.waitForFunction(() => document.getElementById('agr-store-count').textContent === '1');
    fs.unlinkSync(file);
    await visitAll(page);
    await nav(page, 'loans');
    await page.evaluate(() => { const e = document.querySelector('#screen-loans [data-open-agr]'); e && e.click(); });
    await page.waitForSelector('#screen-agreement.active');
    assert.deepEqual(await injection(page), clean, 'nothing injected from the imported backup');
    assert.match(await page.textContent('#agr-detail'), /Zagr-name"'><img src=x onerror=/, 'agreement name shown as text');
    assert.equal(await openApp(page, b.url), '1', 'startup succeeds after importing it');
    await visitAll(page);
    assert.deepEqual(await injection(page), clean);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

for (const b of BUILDS) {
  test(`${b.label}: an imported category that becomes the largest expense category is shown as text in Analytics`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    const file = path.join(require('os').tmpdir(), `kf-cat-${process.pid}-${b.dbName}.json`);
    fs.writeFileSync(file, JSON.stringify({ app: 'KoboFlow', version: '3.2', transactions: [{ id: 99100, amount: 9999999, desc: 'Fictional big spend', cat: P('top-cat'), type: 'expense', state: 'Linked', date: new Date().toISOString().slice(0, 10), time: '09:00', fromAcct: 'pharma_bank', toAcct: '' }], agreements: [], instalments: [], allocations: [], agreementEvents: [], opportunities: [] }));
    await page.click('#settings-nav-btn');
    await page.setInputFiles('#import-file-input', file);
    await page.waitForFunction(() => /Fictional big spend/.test(document.getElementById('timeline-list').textContent));
    fs.unlinkSync(file);
    await nav(page, 'analytics');
    assert.match(await page.textContent('#insights-list'), /Ztop-cat"'><img src=x onerror=.* is your largest expense category/);
    assert.deepEqual(await injection(page), clean);
    await context.close();
  });
}

test('TEST build: literal "<iframe>" in stored text no longer trips the frame guard, and the guard still works', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await addEntry(page, 1200, 'fictional <iframe> <object> <embed> test');
  assert.equal(await page.isVisible('#dialog-warning'), false, 'no "screen could not be refreshed" warning');
  assert.equal(await openApp(page, '/koboflow-test/'), '1', 'startup succeeds (it used to report "Storage unavailable")');
  assert.ok((await page.$$eval('.inbox-desc-txt', e => e.map(x => x.textContent))).includes('fictional <iframe> <object> <embed> test'));
  assert.equal(await page.evaluate(() => { try { document.createElement('iframe'); return 'created'; } catch (e) { return 'refused'; } }), 'refused', 'frame guard still active');
  await context.close();
});

/* ───────────── Startup: report the real failure category ───────────── */
// Fails the dashboard account cards on every draw after the first `skip` draws.
const renderFailsAfter = n => {
  let calls = 0;
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { if (this.id === 'accounts-scroll' && ++calls > n) throw new Error('simulated display failure'); return d.set.call(this, v); } });
};

for (const b of BUILDS) {
  for (const [label, n] of [['a later draw', 1], ['every draw, including the first', 0]]) {
    test(`${b.label}: a display failure at startup (${label}) is reported as a display problem, not "Storage unavailable"`, { skip }, async () => {
      const { context, page } = await ctx(renderFailsAfter, n);
      assert.equal(await openApp(page, b.url), 'app-error');
      const w = await page.textContent('#dialog-warning');
      assert.match(w, new RegExp(`Display problem: KoboFlow read your data from ${b.dbName}, but could not draw this screen \\(simulated display failure\\)\\. Storage itself is working and nothing was deleted\\.`));
      assert.doesNotMatch(w, /Storage unavailable|Nothing you enter will be saved/);
      assert.deepEqual(await page.evaluate(() => window.__kfStorage), { ok: true });
      // Diagnostics stay usable.
      assert.match(await runStorageCheck(page), new RegExp(`Storage: available[\\s\\S]*Database: ${b.dbName}`));
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json-btn')]);
      assert.equal(JSON.parse(fs.readFileSync(await dl.path(), 'utf8')).app, 'KoboFlow', 'a backup can still be exported');
      await context.close();
    });
  }

  test(`${b.label}: a stored record that cannot be loaded is reported as a data problem, not "Storage unavailable"`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url); // creates the database
    const probe = await context.newPage();
    await probe.goto(base + '/probe');
    await probe.evaluate(n => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ id: 'ledgerSetup', mode: 'live', baselineDate: '2026-10-01', accounts: 'not-a-list', aliases: {}, buckets: [] }); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), b.dbName);
    await probe.close();
    assert.equal(await openApp(page, b.url), 'app-error');
    const w = await page.textContent('#dialog-warning');
    assert.match(w, new RegExp(`Data problem: KoboFlow read ${b.dbName}, but could not load a stored record into the app`));
    assert.doesNotMatch(w, /Storage unavailable/);
    const sc = await runStorageCheck(page); // must finish, not hang on "Checking…"
    assert.match(sc, /Storage: available/);
    assert.match(sc, /Account setup saved: yes, but the record is malformed \(no account list\)/);
    await context.close();
  });

  test(`${b.label}: a genuine database failure is still reported as "Storage unavailable"`, { skip }, async () => {
    const { context, page } = await ctx(n => { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (x) { if (String(x) === n) throw new DOMException('simulated: storage blocked', 'SecurityError'); return o.apply(this, arguments); }; }, b.dbName);
    assert.equal(await openApp(page, b.url), 'error');
    assert.match(await page.textContent('#dialog-warning'), new RegExp(`Storage unavailable: KoboFlow could not open or read its database \\(${b.dbName}\\): simulated: storage blocked`));
    assert.doesNotMatch(await page.textContent('#dialog-warning'), /Display problem|Data problem/);
    await context.close();
  });
}
