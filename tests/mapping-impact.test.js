// QUICK-CAPTURE MAPPING IMPACT: a mapping change is applied to past entries when balances are
// calculated (stored entries carry legacy ids such as pers_cash). The setup preview and review must
// show, before saving, which past entries move and by how much, and those figures must equal what is
// saved and shown after reload. Stored entries are never changed. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const F = require('./load-engine')();

const ROOT = path.join(__dirname, '..');
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

/* ── Engine ──────────────────────────────────────────────────── */
const ACCTS = [{ id: 'acc_opay', opening: 500000 }, { id: 'acc_bank', opening: 100000 }, { id: 'acc_pers', opening: 10000 }];
const BASE = '2026-10-20';
const NOT_USED = { pharma_cash: 'acc_opay', pharma_bank: 'acc_opay', pers_cash: '', pers_bank: '', coop: '', emergency: '', fixed_dep: '' };
const FUEL = { id: 200, type: 'expense', amount: 3000, desc: 'fuel kia black', cat: 'Vehicle: Sportage Black', vehicle: 'black', fromAcct: 'pers_cash', toAcct: '', date: '2026-10-20', time: '08:30', state: 'AI Categorized' };
const OTHERS = [
  { id: 900001, type: 'income', amount: 20000, desc: 'Fictional sales', toAcct: 'acc_bank', fromAcct: '', date: '2026-10-25' },
  { id: 900002, type: 'expense', amount: 8500, desc: 'Fictional utilities', fromAcct: 'acc_opay', toAcct: '', date: '2026-10-25' },
];
const bal = (txns, aliases) => F.accountBalances(ACCTS, txns, { baselineDate: BASE, aliases });
const total = b => Object.values(b).reduce((s, x) => s + x, 0);
const impact = (txns, from, to, baselineDate = BASE) => F.mappingImpact(ACCTS, txns, { baselineDate, fromAliases: from, toAliases: to });
// The impact must equal the difference between the balances under the two mappings, account by account.
function assertMatchesBalances(txns, from, to) {
  const im = impact(txns, from, to), a = bal(txns, from), b = bal(txns, to);
  for (const k of Object.keys(a)) assert.equal(im.perAccount[k] || 0, b[k] - a[k], `account ${k}`);
  assert.equal(im.total, total(b) - total(a));
  return im;
}

test('engine: the ₦3,000 "fuel kia black" expense — Not used → Test Bank moves it out of Test Bank', () => {
  const txns = [FUEL, ...OTHERS], stored = JSON.stringify(txns);
  assert.deepEqual(bal(txns, NOT_USED), { acc_opay: 491500, acc_bank: 120000, acc_pers: 10000 });
  const toBank = { ...NOT_USED, pers_cash: 'acc_bank' };
  assert.deepEqual(bal(txns, toBank), { acc_opay: 491500, acc_bank: 117000, acc_pers: 10000 });
  const im = assertMatchesBalances(txns, NOT_USED, toBank);
  assert.equal(im.entries.length, 1);
  assert.deepEqual(im.entries[0], {
    id: 200, date: '2026-10-20', desc: 'fuel kia black', type: 'expense', amount: 3000,
    legacy: [{ side: 'from', key: 'pers_cash', from: null, to: 'acc_bank' }],
    change: { acc_bank: -3000 }, totalChange: -3000, halfMapped: false,
  });
  assert.deepEqual(im.perAccount, { acc_bank: -3000 });
  assert.equal(im.total, -3000);
  // Mapping back is the exact reverse.
  const back = assertMatchesBalances(txns, toBank, NOT_USED);
  assert.deepEqual(back.perAccount, { acc_bank: 3000 });
  assert.equal(back.total, 3000);
  assert.equal(JSON.stringify(txns), stored, 'stored entries unchanged');
});

test('engine: repeated mapping changes each match the balances and net to zero over a round trip', () => {
  const txns = [FUEL, ...OTHERS], stored = JSON.stringify(txns);
  const steps = [NOT_USED, { ...NOT_USED, pers_cash: 'acc_bank' }, { ...NOT_USED, pers_cash: 'acc_pers' }, { ...NOT_USED, pers_cash: 'acc_opay' }, NOT_USED];
  let net = 0;
  for (let i = 1; i < steps.length; i++) net += assertMatchesBalances(txns, steps[i - 1], steps[i]).total;
  assert.equal(net, 0);
  // Test Bank → Personal Test moves the expense between accounts; the total is unchanged.
  const im = impact(txns, steps[1], steps[2]);
  assert.deepEqual(im.perAccount, { acc_bank: 3000, acc_pers: -3000 });
  assert.equal(im.total, 0);
  assert.equal(JSON.stringify(txns), stored);
});

test('engine: an unchanged mapping, entries without legacy ids, sample and reversed entries have no impact', () => {
  const txns = [FUEL, ...OTHERS, { ...FUEL, id: 201, demo: true }, { ...FUEL, id: 202, voided: true }];
  const toBank = { ...NOT_USED, pers_cash: 'acc_bank' };
  assert.deepEqual(impact(txns, toBank, toBank), { entries: [], perAccount: {}, total: 0 });
  assert.deepEqual(impact(txns, NOT_USED, toBank).entries.map(e => e.id), [200]);
});

test('engine: an entry dated before the baseline is not moved by any mapping', () => {
  const txns = [{ ...FUEL, date: '2026-10-19' }];
  const toBank = { ...NOT_USED, pers_cash: 'acc_bank' };
  assert.deepEqual(impact(txns, NOT_USED, toBank), { entries: [], perAccount: {}, total: 0 });
  assert.deepEqual(bal(txns, toBank), bal(txns, NOT_USED));
  // The same entry with the baseline on its date is moved.
  assert.equal(impact(txns, NOT_USED, toBank, '2026-10-19').total, -3000);
});

test('engine: a transfer mapped on both sides keeps the total; mapped on one side it is flagged and changes the total', () => {
  const tr = { id: 300, type: 'transfer', amount: 5000, desc: 'Savings', fromAcct: 'pers_cash', toAcct: 'pers_bank', date: '2026-10-21' }, txns = [tr];
  // Both sides into the same account: nothing moves.
  assert.deepEqual(impact(txns, NOT_USED, { ...NOT_USED, pers_cash: 'acc_bank', pers_bank: 'acc_bank' }).entries, []);
  // Both sides into different accounts: money moves between them, total unchanged.
  const both = assertMatchesBalances(txns, NOT_USED, { ...NOT_USED, pers_cash: 'acc_bank', pers_bank: 'acc_pers' });
  assert.deepEqual(both.entries[0].change, { acc_bank: -5000, acc_pers: 5000 });
  assert.equal(both.total, 0); assert.equal(both.entries[0].halfMapped, false);
  // One side only: under today's rule the total changes; the review flags it.
  const out = assertMatchesBalances(txns, NOT_USED, { ...NOT_USED, pers_cash: 'acc_bank' });
  assert.equal(out.total, -5000); assert.equal(out.entries[0].halfMapped, true);
  const into = assertMatchesBalances(txns, NOT_USED, { ...NOT_USED, pers_bank: 'acc_pers' });
  assert.equal(into.total, 5000); assert.equal(into.entries[0].halfMapped, true);
  assert.deepEqual(into.entries[0].legacy, [{ side: 'from', key: 'pers_cash', from: null, to: null }, { side: 'to', key: 'pers_bank', from: null, to: 'acc_pers' }]);
});

test('engine: an owner withdrawal half-mapped is flagged; both sides mapped keeps the total; income adds to its account', () => {
  const ow = { id: 400, type: 'owner_withdrawal', amount: 7000, desc: 'Owner withdrawal', fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: '2026-10-22' };
  const half = impact([ow], {}, NOT_USED); // first setup: Pharmacy Cash → Opay, Personal Cash Not used
  assert.deepEqual(half.perAccount, { acc_opay: -7000 }); assert.equal(half.total, -7000); assert.equal(half.entries[0].halfMapped, true);
  const both = impact([ow], NOT_USED, { ...NOT_USED, pers_cash: 'acc_pers' });
  assert.deepEqual(both.perAccount, { acc_pers: 7000 }); assert.equal(both.entries[0].halfMapped, false);
  assert.equal(F.mappingImpact(ACCTS, [ow], { baselineDate: BASE, fromAliases: {}, toAliases: { ...NOT_USED, pers_cash: 'acc_pers' } }).total, 0);
  const inc = impact([{ id: 401, type: 'income', amount: 4000, desc: 'Gift', fromAcct: '', toAcct: 'pers_cash', date: '2026-10-22' }], NOT_USED, { ...NOT_USED, pers_cash: 'acc_bank' });
  assert.deepEqual(inc.perAccount, { acc_bank: 4000 }); assert.equal(inc.entries[0].legacy[0].side, 'to');
});

test('engine: the impact always equals the balance difference (every pair of mappings over mixed entries)', () => {
  const txns = [FUEL, ...OTHERS,
    { id: 300, type: 'transfer', amount: 5000, fromAcct: 'pers_cash', toAcct: 'pers_bank', date: '2026-10-21' },
    { id: 400, type: 'owner_withdrawal', amount: 7000, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: '2026-10-22' },
    { id: 500, type: 'investment', amount: 2500.5, fromAcct: 'pers_bank', toAcct: 'fixed_dep', date: '2026-10-23' },
    { id: 501, type: 'income', amount: 1234.25, fromAcct: '', toAcct: 'pers_cash', date: '2026-10-19' }];
  const targets = ['', 'acc_opay', 'acc_bank', 'acc_pers'], maps = [{}];
  for (const a of targets) for (const b of targets) for (const c of targets) maps.push({ ...NOT_USED, pers_cash: a, pers_bank: b, fixed_dep: c });
  for (let i = 0; i < maps.length; i += 7) for (let j = 0; j < maps.length; j += 5) assertMatchesBalances(txns, maps[i], maps[j]);
});

/* ── Browser: preview, review, save and reload agree ─────────── */
const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const ALIASES = Object.keys(NOT_USED);
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
    res.writeHead(404); res.end('not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function freshPage(b) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-20T08:30:00') });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  const ready = async () => { await page.goto(base + b.url); await page.waitForSelector('body[data-kf-ready="1"]'); };
  const idb = (store, key) => page.evaluate(([n, store, key]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const s = q.result.transaction(store).objectStore(store); const g = key ? s.get(key) : s.getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), [b.dbName, store, key]);
  const balances = async () => { await page.click('.nav-btn[data-screen="home"]'); return Object.fromEntries(await page.$$eval('.acct-card', cs => cs.map(c => [c.querySelector('.acct-name').textContent.replace(/[^A-Za-z ]/g, '').trim(), Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, ''))]))); };
  return { context, page, errors, ready, txns: () => idb('transactions'), setupRec: () => idb('meta', 'ledgerSetup'), balances };
}
const impactOf = (page, sel) => page.$eval(sel, e => { const x = e.querySelector('[data-mapping-impact]'); if (!x) return null;
  return { entries: [...x.querySelectorAll('[data-impact-entry]')].map(n => ({ id: n.getAttribute('data-impact-entry'), text: n.textContent.replace(/\s+/g, ' ') })),
    accts: [...x.querySelectorAll('[data-impact-acct]')].map(n => n.textContent.replace(/\s+/g, ' ').trim()), total: Number(x.querySelector('[data-impact-total]').getAttribute('data-impact-total')), half: x.querySelectorAll('[data-impact-half]').length }; });

for (const b of BUILDS) {
  test(`${b.label}: mapping Personal Cash to Test Bank shows the ₦3,000 fuel entry and its effect before saving; save and reload agree`, { skip }, async () => {
    const { context, page, errors, ready, txns, setupRec, balances } = await freshPage(b);
    await ready();
    // Captured before live setup, so it is stored with the legacy id pers_cash.
    await page.fill('#capture-input', '3000 fuel kia black'); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    const fuel = (await txns()).find(t => !t.demo);
    assert.equal(fuel.fromAcct, 'pers_cash'); assert.equal(fuel.date, '2026-10-20'); assert.equal(fuel.cat, 'Vehicle: Sportage Black');
    await page.clock.setSystemTime(new Date('2026-10-25T09:00:00'));
    // First live setup with Personal Cash = Not used: no entry is moved, so no impact block.
    await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
    await page.fill('#setup-baseline', '2026-10-20');
    const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
    await row(0).locator('[data-f=use]').selectOption('business'); await row(0).locator('[data-f=opening]').fill('500000');
    for (const [i, label, use, op] of [[1, 'Test Bank', 'business', '100000'], [2, 'Personal Test', 'personal', '10000']]) {
      await page.click('#setup-add-acct'); await row(i).locator('[data-f=label]').fill(label); await row(i).locator('[data-f=kind]').selectOption('bank');
      await row(i).locator('[data-f=use]').selectOption(use); await row(i).locator('[data-f=opening]').fill(op);
    }
    for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, k.startsWith('pharma') ? 'acc_opay' : '');
    await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn');
    assert.equal(await impactOf(page, '#setup-confirm'), null);
    await page.click('#setup-confirm-btn'); await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    const bankId = (await setupRec()).accounts.find(a => a.label === 'Test Bank').id;
    await page.evaluate(([n, bankId]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'), s = tx.objectStore('transactions');
      s.put({ id: 900001, type: 'income', amount: 20000, desc: 'Fictional sales', cat: 'Pharmacy Sales', toAcct: bankId, fromAcct: '', date: '2026-10-25', time: '10:00', state: 'Manual' });
      s.put({ id: 900002, type: 'expense', amount: 8500, desc: 'Fictional utilities', cat: 'Utilities', fromAcct: 'acc_opay', toAcct: '', date: '2026-10-25', time: '11:00', state: 'Manual' });
      tx.oncomplete = () => { q.result.close(); res(); }; }; }), [b.dbName, bankId]);
    await ready();
    const stored = JSON.stringify(await txns());
    assert.deepEqual(await balances(), { Opay: 491500, 'Test Bank': 120000, 'Personal Test': 10000 });

    const change = async (value, expect) => {
      await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
      await page.selectOption('#setup-aliases [data-alias="pers_cash"]', value);
      const pv = await impactOf(page, '#setup-preview'); // preview, before Review
      await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn');
      const rv = await impactOf(page, '#setup-confirm'); // review, before Confirm
      for (const v of [pv, rv]) {
        assert.equal(v.entries.length, 1); assert.equal(v.entries[0].id, String(fuel.id));
        assert.match(v.entries[0].text, /20 Oct 2026 · fuel kia black · expense ₦3,000/);
        assert.match(v.entries[0].text, expect.mapping);
        assert.deepEqual(v.accts, [`Test Bank${expect.sign}₦3,000`]);
        assert.equal(v.total, expect.total); assert.equal(v.half, 0);
      }
      const preview = await page.textContent('#setup-preview');
      assert.match(preview, new RegExp(`Total real money₦${expect.after.toLocaleString('en-NG')}`));
      await page.click('#setup-confirm-btn'); await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
      assert.deepEqual(await balances(), expect.balances);
      await ready();
      assert.deepEqual(await balances(), expect.balances);
      assert.equal(JSON.stringify(await txns()), stored, 'stored entries unchanged');
    };
    await change(bankId, { mapping: /Personal Cash \[pers_cash\] \(paid from\): Not used → Test Bank/, sign: '-', total: -3000, after: 618500, balances: { Opay: 491500, 'Test Bank': 117000, 'Personal Test': 10000 } });
    await change('', { mapping: /Personal Cash \[pers_cash\] \(paid from\): Test Bank → Not used/, sign: '+', total: 3000, after: 621500, balances: { Opay: 491500, 'Test Bank': 120000, 'Personal Test': 10000 } });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('TEST build: a half-mapped transfer is flagged in the review and an entry before the baseline is not listed', { skip }, async () => {
  const b = BUILDS[0];
  const { context, page, errors, ready, txns } = await freshPage(b);
  await ready();
  await page.evaluate(([n]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'), s = tx.objectStore('transactions');
    s.put({ id: 300, type: 'transfer', amount: 5000, desc: 'Fictional savings', cat: 'Savings', fromAcct: 'pers_cash', toAcct: 'pers_bank', date: '2026-10-20', time: '09:00', state: 'Manual' });
    s.put({ id: 301, type: 'expense', amount: 999, desc: 'Fictional old expense', cat: 'Other', fromAcct: 'pers_cash', toAcct: '', date: '2026-10-01', time: '09:00', state: 'Manual' });
    tx.oncomplete = () => { q.result.close(); res(); }; }; }), [b.dbName]);
  await ready();
  const stored = JSON.stringify(await txns());
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', '2026-10-20');
  await page.locator('#setup-accounts [data-acct-row="0"] [data-f=use]').selectOption('business');
  await page.locator('#setup-accounts [data-acct-row="0"] [data-f=opening]').fill('100000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, k === 'pers_cash' ? 'acc_opay' : '');
  await page.click('#setup-save-btn'); await page.waitForSelector('#setup-confirm-btn');
  const rv = await impactOf(page, '#setup-confirm');
  assert.deepEqual(rv.entries.map(e => e.id), ['300']);
  assert.match(rv.entries[0].text, /Personal Cash \[pers_cash\] \(paid from\): not set up → Opay/);
  assert.match(rv.entries[0].text, /Personal Bank \[pers_bank\] \(paid into\): not set up → Not used/);
  assert.equal(rv.half, 1); assert.equal(rv.total, -5000);
  assert.match(await page.textContent('#setup-confirm'), /only one side mapped/);
  await page.click('#setup-confirm-btn'); await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  assert.equal(JSON.stringify(await txns()), stored);
  assert.deepEqual(errors, []);
  await context.close();
});
