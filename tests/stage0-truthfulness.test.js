// Stage 0 — financial truthfulness. Live figures come from saved records under one cash rule;
// sample figures never appear in live mode; vehicle figures are derived from saved transactions;
// a bare "fuel" capture is never assigned to a vehicle; "Bill paid" is a payment, not a plan.
// Runs against the generated TEST site and the production candidate. Fictional data only.
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
// Text that only the built-in sample data contains. None of it may appear in live mode.
const SAMPLE_MARKERS = ['Chain sprocket', 'Brake pads', 'Annual renewal', '2 front tyres', 'Personal Savings', 'Business Reinvest',
  'IBEDC Electricity', 'Shop Rent (Balance)', '(sample)', 'sample trend', '32,500', 'Spending well controlled', 'Overspending detected',
  'Some categories trending high', 'FJR1300AE is most economical', 'second-largest', '10M Goal'];
// Wording shapes that only a hard-coded sample target or abbreviated sample amount produces: a goal or
// target with a naira figure ("vs ₦10M Goal", "target: ₦2,000,000") or an abbreviated naira amount
// ("₦5M", "₦2.5k"). Live figures are always written out in full by fmt(). Matched on lowercased text.
const SAMPLE_PATTERNS = [/₦\s?\d+(?:\.\d+)?\s?[mk]\b/, /\bvs\.?\s+₦[\d,.]+\s*[mk]?\s+(?:goal|target)/, /\b(?:goal|target)\s*(?:of|:)\s*₦/];

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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const text = (page, sel) => page.textContent(sel);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const storedSetup = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result || null); }; }; }), n);
const storedTxns = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), n);
const seed = (context, n, recs) => probe(context, ([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), [n, recs]);
const screens = page => page.$$eval('.nav-btn', bs => bs.map(x => x.dataset.screen));
// Opens one screen and returns its rendered, visible text (the active screen plus the header and
// capture bar). Screens other than the active one are display:none, so innerText skips them.
async function screenText(page, sc) {
  await nav(page, sc);
  await page.waitForSelector(`#screen-${sc}.active`, { state: 'visible' });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => document.body.innerText);
}
// Opens every screen in turn and checks each one's own visible text, so a sample figure on any
// screen is caught, not just on the last one opened. Returns "screen: marker" for each hit.
// `expect` maps a screen to the empty-state texts it must show (approved "not available" wording).
async function noSampleText(page, expect = {}) {
  const hits = [];
  for (const sc of await screens(page)) {
    // Compared case-insensitively: innerText applies CSS text-transform (many labels are uppercase).
    const t = (await screenText(page, sc)).toLowerCase();
    assert.ok(t.includes((await page.textContent(`#screen-${sc} .screen-title`)).toLowerCase()), `${sc} screen rendered`);
    SAMPLE_MARKERS.filter(m => t.includes(m.toLowerCase())).forEach(m => hits.push(`${sc}: ${m}`));
    SAMPLE_PATTERNS.filter(re => re.test(t)).forEach(re => hits.push(`${sc}: ${re}`));
    for (const e of expect[sc] || []) assert.ok(t.includes(e.toLowerCase()), `${sc} screen shows "${e}"`);
  }
  return hits;
}
// The approved live-mode empty states, by the screen that shows them.
const EMPTY_STATES = {
  home: ['Not available: no budgets set yet.', 'No budgets set yet', 'Financial Health (rule-of-thumb)'],
  cashdrop: ['Not available yet'],
  networth: ['Not enough recorded history', 'No target set', 'No net-worth goal set yet.'],
  analytics: ['No expenses recorded yet'],
  vehicles: ['No target set', 'No entries recorded for this vehicle this month'],
};
async function visitAll(page) { for (const sc of await screens(page)) await nav(page, sc); }

// Live setup: Opay wallet 100,000; bank 500,000; coop 80,000 (default: restricted);
// fixed deposit held as a bank account but marked restricted, 200,000; earmark 30,000 in Opay.
async function liveSetup(page, { earmark = 30000, coopAccess = '', baselineDays = 60 } = {}) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(baselineDays));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  const add = async (i, label, kind, opening, access) => {
    await page.click('#setup-add-acct');
    await row(i).locator('[data-f=label]').fill(label);
    await row(i).locator('[data-f=kind]').selectOption(kind);
    await row(i).locator('[data-f=opening]').fill(String(opening));
    if (access) await row(i).locator('[data-f=access]').selectOption(access);
  };
  await add(1, 'Fictional Bank', 'bank', 500000);
  await add(2, 'Fictional Coop', 'coop', 80000, coopAccess);
  await add(3, 'Fictional Fixed Deposit', 'bank', 200000, 'restricted');
  if (earmark) {
    await page.click('#setup-add-bucket');
    const b = page.locator('#setup-buckets [data-bucket-row="0"]');
    await b.locator('[data-f=label]').fill('Fictional Rent'); await b.locator('[data-f=parentId]').selectOption('acc_opay'); await b.locator('[data-f=amount]').fill(String(earmark));
  }
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
const idOf = (setup, label) => setup.accounts.find(a => a.label === label).id;

for (const b of BUILDS) {
  test(`${b.label}: live mode with empty data shows no sample figure anywhere, only real values or "not available"`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0 });
    await openApp(page, b.url);
    assert.deepEqual(await noSampleText(page, EMPTY_STATES), [], 'no sample text on any screen in live mode');
    assert.equal(await text(page, '#score-num'), '--');
    assert.match(await text(page, '#score-msg'), /Not available: no budgets set yet/);
    assert.match(await text(page, '#budget-list'), /No budgets set yet/);
    assert.match(await text(page, '#drop-list'), /Not available yet/);
    assert.equal(await text(page, '#drop-chart'), '');
    assert.match(await text(page, '#nw-change'), /Not enough recorded history/);
    assert.equal(await text(page, '#fi-pct-label'), 'No target set');
    assert.match(await text(page, '#nw-trend'), /Not enough recorded history/);
    assert.match(await text(page, '#cap-summary'), /Capital Injected₦0/);
    assert.equal(await text(page, '#runway-days'), '--');
    assert.match(await text(page, '#runway-status'), /NO SPENDING RECORDED/);
    assert.match(await text(page, '#autopilot-body'), /Financial Health \(rule-of-thumb\)Not available: no spending recorded yet/);
    assert.match(await text(page, '#insights-list'), /No expenses recorded yet/);
    for (const v of ['fjr', 'green', 'black']) assert.equal(await text(page, `[data-vehicle-spent="${v}"]`), '₦0');
    assert.match(await text(page, '#vehicle-panels'), /No target set/);
    assert.match(await text(page, '#vehicle-panels'), /No entries recorded for this vehicle this month/);
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: one cash rule — restricted accounts excluded from cash and runway, included in net worth; figures agree`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { baselineDays: 120 }); // more than 90 days recorded: the full 90-day window applies
    const st = await storedSetup(context, b.dbName);
    assert.equal(st.accounts.find(a => a.label === 'Fictional Fixed Deposit').access, 'restricted', 'override saved');
    assert.equal(st.accounts.find(a => a.label === 'Fictional Coop').access, '', 'coop left on its default');
    const opay = 'acc_opay', bank = idOf(st, 'Fictional Bank');
    await seed(context, b.dbName, [
      { id: 91001, amount: 90000, desc: 'Fictional stock purchase', cat: 'Restocking', type: 'expense', state: 'Linked', date: today(), time: '09:00', fromAcct: bank, toAcct: '' },
      { id: 91002, amount: 5000, desc: 'Fictional owner withdrawal', cat: 'Owner Withdrawal', type: 'owner_withdrawal', state: 'Linked', date: today(), time: '09:01', fromAcct: opay, toAcct: '' },
      { id: 91003, amount: 3600, desc: 'Fictional loan repayment', cat: 'Loan Repayment', type: 'loan_repayment', state: 'Linked', date: today(), time: '09:02', fromAcct: bank, toAcct: '', alloc: { principal: 3000, interest: 600, fees: 0, unsplit: 0 } },
      { id: 91004, amount: 20000, desc: 'Fictional capital', cat: 'Capital Injection', type: 'capital_injection', fundingKind: 'capital_injection', state: 'Linked', date: today(), time: '09:03', fromAcct: '', toAcct: opay },
      { id: 91005, amount: 6000, desc: 'Fictional voided withdrawal', cat: 'Owner Withdrawal', type: 'owner_withdrawal', state: 'Linked', date: today(), time: '09:04', fromAcct: opay, toAcct: '', voided: true, voidReason: 'test' },
    ]);
    await openApp(page, b.url);
    // Opay 100,000 − 5,000 + 20,000 = 115,000; bank 500,000 − 90,000 − 3,600 = 406,400 → available 521,400.
    // Restricted: coop 80,000 + fixed deposit 200,000 = 280,000. Earmark 30,000 → free 491,400.
    const ap = await text(page, '#autopilot-body');
    assert.match(ap, /Cash Now \(actual\)₦521,400/);
    assert.match(ap, /of which earmarked₦30,000/);
    assert.match(ap, /free to use \(after earmarks\)₦491,400/);
    assert.match(ap, /Restricted \(coop, fixed deposit\)₦280,000/);
    assert.match(await text(page, '#runway-meta'), /Available Cash₦521,400/);
    // Spending runway = 521,400 / ((90,000 expense + 600 interest) / 90 days) = 518 days (history capped at 90 days).
    // Counting the 5,000 withdrawal or the 3,000 principal would give a different number.
    assert.equal(await text(page, '#runway-days'), '518');
    assert.match(await text(page, '#runway-meta'), /Monthly Burn₦30,200/);
    assert.match(await text(page, '#runway-meta'), /History90 days/);
    assert.match(await text(page, '#runway-basis'), /Spending runway: expenses \+ interest\/fees; excludes owner withdrawals and loan principal/);
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Cash Now \(gross\)₦521,400Free to Use \(after earmarks\)₦491,400Obligations₦0Left After\+₦491,400/);
    assert.match(await text(page, '#cal-summary'), /Free to Use₦491,400/);
    await nav(page, 'networth');
    assert.equal(await text(page, '#nw-assets'), '₦801,400', 'restricted accounts are still assets');
    await nav(page, 'capital');
    assert.match(await text(page, '#cap-summary'), /Capital Injected₦20,000/, 'saved capital only, no sample injections');
    await nav(page, 'ownerimpact');
    assert.match(await text(page, '#wd-stats'), /This Month₦5,000/, 'voided withdrawal excluded');
    // Earmarks do not change actual balances.
    const cards = await page.$$eval('.acct-card', cs => cs.map(c => c.textContent));
    assert.ok(cards.some(c => /Opay₦115,000/.test(c)), 'Opay card shows its full balance: ' + cards.join(' | '));
    assert.ok(cards.some(c => /Fictional Fixed Deposit₦200,000.*Restricted/.test(c)), 'restricted account marked on its card');
    assert.deepEqual(await noSampleText(page), []);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: coop overridden to "available" is counted; the change is shown in the review step', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page, { earmark: 0 });
  assert.match(await text(page, '#autopilot-body'), /Cash Now \(actual\)₦600,000/, 'coop restricted by default');
  await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.locator('#setup-accounts [data-acct-row="2"] [data-f=access]').selectOption('immediate');
  await page.click('#setup-save-btn');
  assert.match(await text(page, '#setup-confirm'), /Fictional Coop availability: default for its type → available to spend/);
  await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  assert.match(await text(page, '#autopilot-body'), /Cash Now \(actual\)₦680,000/);
  assert.equal((await storedSetup(context, 'KoboFlowDB-test')).accounts.find(a => a.label === 'Fictional Coop').access, 'immediate');
  await context.close();
});

test('TEST build: over-earmarking is flagged and still never changes a balance', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page, { earmark: 150000 }); // Opay holds 100,000
  const ap = await text(page, '#autopilot-body');
  assert.match(ap, /Earmarks in Opay \(₦150,000\) exceed its balance \(₦100,000\) by ₦50,000/);
  assert.match(ap, /free to use \(after earmarks\)₦500,000/, 'over-earmarked account contributes nothing, never a negative');
  const cards = await page.$$eval('.acct-card', cs => cs.map(c => c.textContent));
  assert.ok(cards.some(c => /Opay₦100,000/.test(c)));
  await context.close();
});

for (const b of BUILDS) {
  test(`${b.label}: vehicle figures come from saved transactions, persist across reload, and exclude voided entries`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0 });
    await nav(page, 'vehicles');
    const log = async (vid, amount, cat, desc) => {
      await page.click(`.vtab[data-vid="${vid}"]`);
      await page.click(`.vehicle-panel[data-panel="${vid}"] .add-vlog-btn`);
      await page.waitForSelector('#vlog-modal-overlay[data-form-ready="1"]');
      await page.fill('#vlog-amount', String(amount)); await page.selectOption('#vlog-cat', cat); await page.fill('#vlog-desc', desc);
      await page.click('#vlog-save-btn');
      await page.waitForFunction(() => !document.getElementById('vlog-modal-overlay').classList.contains('open'));
    };
    await log('fjr', 3000, 'Fuel', 'Fictional fill-up');
    await log('green', 5000, 'Repair', 'Fictional repair');
    await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
    await page.fill('#modal-amount', '2000'); await page.fill('#modal-desc', 'Fictional wash'); await page.selectOption('#modal-cat', 'Vehicle: Sportage Black');
    await page.click('#modal-save-btn');
    await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
    await seed(context, b.dbName, [{ id: 92001, amount: 7000, desc: 'Fictional voided fuel', cat: 'Vehicle: FJR1300AE', type: 'expense', vehicle: 'fjr', state: 'Linked', date: today(), time: '10:00', fromAcct: 'acc_opay', toAcct: '', voided: true }]);
    await openApp(page, b.url);
    await nav(page, 'vehicles');
    assert.equal(await text(page, '[data-vehicle-spent="fjr"]'), '₦3,000', 'voided entry excluded');
    assert.equal(await text(page, '[data-vehicle-spent="green"]'), '₦5,000');
    assert.equal(await text(page, '[data-vehicle-spent="black"]'), '₦2,000', 'Add Entry with a vehicle category counts');
    const panels = await text(page, '#vehicle-panels');
    assert.match(panels, /Fictional fill-up \(FJR1300AE\)/, 'saved log survives reload');
    assert.match(panels, /Category not recorded/, 'the Add Entry has no log category: not guessed');
    const stored = await storedTxns(context, b.dbName);
    const fjr = stored.filter(t => t.vehicle === 'fjr' && !t.voided);
    assert.equal(fjr.length, 1, 'one ledger entry per log, no duplicates');
    assert.equal(fjr[0].vehicleCat, 'Fuel', 'the log category is saved');
    assert.match(await text(page, '#autopilot-body'), /Vehicle Spending₦10,000/);
    await nav(page, 'analytics');
    assert.match(await text(page, '#insights-list'), /Vehicle spending this month, from recorded entries: ₦10,000/);
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: a bare "fuel" or "petrol" capture goes to Needs Review with no vehicle; a named vehicle still maps`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0 });
    for (const c of ['5000 fuel', '1500 petrol for generator', '2500 fuel fjr', '15000 fuel green']) {
      await page.fill('#capture-input', c); await page.press('#capture-input', 'Enter');
      await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    }
    const stored = await storedTxns(context, b.dbName);
    const by = d => stored.find(t => t.desc === d);
    for (const d of ['fuel', 'petrol for generator']) {
      assert.equal(by(d).vehicle, null, `"${d}" is not assigned to any vehicle`);
      assert.equal(by(d).cat, 'Vehicle fuel (vehicle not set)');
      assert.equal(by(d).state, 'Needs Review');
    }
    assert.equal(by('fuel fjr').vehicle, 'fjr');
    assert.equal(by('fuel green').vehicle, 'green');
    await nav(page, 'vehicles');
    assert.equal(await text(page, '[data-vehicle-spent="fjr"]'), '₦2,500', 'the unassigned fuel is not added to the FJR');
    await nav(page, 'inbox');
    assert.match(await text(page, '#inbox-list'), /Vehicle fuel \(vehicle not set\)/);
    await context.close();
  });

  test(`${b.label}: "Bill paid" records one paid expense, keeps the stored "obligation" type, and is labelled as paid`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0 });
    await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
    assert.equal(await text(page, '.type-chip[data-type="obligation"]'), 'Bill paid');
    await page.click('.type-chip[data-type="obligation"]');
    assert.match(await text(page, '#type-chip-hint'), /Bill paid records money already paid\. Upcoming bills are added separately\./);
    assert.equal(await page.isVisible('#type-chip-hint'), true);
    assert.equal(await page.inputValue('#modal-cat'), 'Other', 'Add Entry no longer preselects a vehicle category');
    await page.fill('#modal-amount', '7000'); await page.fill('#modal-desc', 'Fictional electricity bill');
    await page.selectOption('#modal-from', 'acc_opay');
    await page.click('#modal-save-btn');
    await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
    const stored = (await storedTxns(context, b.dbName)).filter(t => t.desc === 'Fictional electricity bill');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].type, 'obligation', 'stored type unchanged for compatibility');
    assert.match(await text(page, '#autopilot-body'), /Cash Now \(actual\)₦593,000/, 'it is a payment: cash goes down by 7,000');
    assert.match(await text(page, '#autopilot-body'), /Vehicle Spending₦0/, 'a bill is not counted as vehicle spending');
    await nav(page, 'inbox');
    const pills = await page.$$eval('#inbox-list .pill', ps => ps.map(p => p.textContent));
    assert.ok(pills.includes('bill paid'), 'shown as "bill paid": ' + pills.join(','));
    assert.ok(!pills.includes('obligation'));
    await context.close();
  });
}

for (const b of BUILDS) {
  test(`${b.label}: spending runway with under 30 days of history is "not enough history", never an optimistic number`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0, baselineDays: 10 }); // 11 days recorded, including today
    await seed(context, b.dbName, [
      { id: 93001, amount: 50000, desc: 'Fictional stock purchase', cat: 'Restocking', type: 'expense', state: 'Linked', date: today(), time: '09:00', fromAcct: 'acc_opay', toAcct: '' },
    ]);
    await openApp(page, b.url);
    // The old rule (÷ 90 days whatever the history) showed 550,000 / (50,000 / 90) = 990 days here.
    assert.equal(await text(page, '#runway-days'), '--');
    assert.equal(await text(page, '#runway-status'), 'NOT ENOUGH SPENDING HISTORY YET');
    const meta = await text(page, '#runway-meta');
    assert.match(meta, /Available Cash₦550,000/);
    assert.match(meta, /Monthly Burn--/);
    assert.match(meta, /Daily Burn--/);
    assert.match(meta, /History11 of 30 days needed/);
    assert.match(await text(page, '#runway-basis'), /^Spending runway: expenses \+ interest\/fees; excludes owner withdrawals and loan principal\..*at least 30 days are needed\.$/);
    const ap = await text(page, '#autopilot-body');
    assert.match(ap, /Financial Health \(rule-of-thumb\)Not available: not enough spending history yet/);
    assert.doesNotMatch(ap, /Spending runway is critical/);
    assert.doesNotMatch(ap, /\d+\/100/, 'no health score from an unavailable runway');
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: spending runway with 45 days of history averages over 45 days, counting expenses + interest/fees only`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page, { earmark: 0, baselineDays: 44 }); // 45 days recorded, including today
    const st = await storedSetup(context, b.dbName);
    const bank = idOf(st, 'Fictional Bank');
    await seed(context, b.dbName, [
      { id: 94001, amount: 40000, desc: 'Fictional stock purchase', cat: 'Restocking', type: 'expense', state: 'Linked', date: today(), time: '09:00', fromAcct: bank, toAcct: '' },
      { id: 94002, amount: 5500, desc: 'Fictional loan repayment', cat: 'Loan Repayment', type: 'loan_repayment', state: 'Linked', date: today(), time: '09:01', fromAcct: bank, toAcct: '', alloc: { principal: 5000, interest: 400, fees: 100, unsplit: 0 } },
      { id: 94003, amount: 20000, desc: 'Fictional owner withdrawal', cat: 'Owner Withdrawal', type: 'owner_withdrawal', state: 'Linked', date: today(), time: '09:02', fromAcct: 'acc_opay', toAcct: '' },
    ]);
    await openApp(page, b.url);
    // Available: Opay 100,000 − 20,000 = 80,000; bank 500,000 − 40,000 − 5,500 = 454,500 → 534,500.
    // Spending: 40,000 expense + 400 interest + 100 fees = 40,500 over 45 days = 900/day; 900 × 30 = 27,000/month.
    // Runway 534,500 / 900 = 593.9 → 594 days. Counting the withdrawal or the principal would lower it.
    const meta = await text(page, '#runway-meta');
    assert.match(meta, /Available Cash₦534,500/);
    assert.match(meta, /Monthly Burn₦27,000/);
    assert.match(meta, /Daily Burn₦900/);
    assert.match(meta, /History45 days/);
    assert.equal(await text(page, '#runway-days'), '594');
    assert.equal(await text(page, '#runway-status'), 'STRONG');
    assert.match(await text(page, '#autopilot-body'), /Financial Health \(rule-of-thumb\)\d+\/100/);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

for (const b of BUILDS) {
  test(`${b.label}: Pressure, Calendar, Autopilot and Opportunity Analysis agree on free-to-use cash after earmarks and obligations`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page); // Opay 100,000 (30,000 earmarked), bank 500,000; coop and fixed deposit restricted
    // A fictional loan: 150,000 received into Opay; 4 monthly instalments of 55,455, the first in 20 days.
    await nav(page, 'loans');
    await page.click('#new-agr-btn');
    await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
    await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
    await page.fill('#agr-first', await page.evaluate(() => KoboFin.addDays(KoboFin.today(), 20)));
    await page.fill('#agr-inst', '55455');
    await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
    await page.waitForSelector('#agr-preview .sched');
    await page.click('#agr-save-btn');
    await page.waitForSelector('#screen-agreement.active');
    // Cash Now 250,000 + 500,000 = 750,000; earmarked 30,000 → free to use 720,000.
    // Due in 30 days: one instalment, 55,455 → left after 664,545; pressure round(55,455 / 720,000 × 100) = 8.
    const ap = await text(page, '#autopilot-body');
    assert.match(ap, /Cash Now \(actual\)₦750,000/);
    assert.match(ap, /free to use \(after earmarks\)₦720,000/);
    assert.match(ap, /Committed: Next 30 Days₦55,455/);
    assert.match(ap, /Left After Known Obligations \(free to use\)\+₦664,545/);
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Cash Now \(gross\)₦750,000Free to Use \(after earmarks\)₦720,000Obligations₦55,455Left After\+₦664,545/);
    assert.equal(await text(page, '#pressure-score'), '8', 'measured against free-to-use cash, not gross (which gives 7)');
    assert.match(await text(page, '#screen-pressure .screen-sub'), /free-to-use cash \(after earmarks\)/);
    await nav(page, 'calendar');
    const cal = await text(page, '#cal-summary');
    const due60 = Number(/Due \(60 days\)₦([\d,]+)/.exec(cal)[1].replace(/,/g, ''));
    assert.ok(due60 >= 55455 && due60 % 55455 === 0, 'whole instalments in the 60-day window: ' + due60);
    assert.ok(cal.includes('Free to Use₦720,000'), cal);
    assert.ok(cal.includes('Left After+₦' + (720000 - due60).toLocaleString('en-NG')), cal);
    assert.match(cal, /Free to use = Cash Now ₦750,000 less ₦30,000 earmarked/);
    await nav(page, 'opportunity');
    await page.fill('#opp-name', 'Fictional offer'); await page.fill('#opp-received', '150000');
    await page.selectOption('#opp-structure', 'fixed_total'); await page.fill('#opp-inst', '55455'); await page.fill('#opp-count', '4');
    await page.fill('#opp-first-due', await page.evaluate(() => KoboFin.addDays(KoboFin.today(), 30)));
    await page.fill('#opp-profit', '90000');
    await page.click('#opp-calc-btn');
    assert.match(await text(page, '#opp-result'), /Uncommitted cash today \(after 30-day bills & loans\)₦664,545/, 'freeCash(): the same figure as Autopilot and Pressure');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: the per-screen sample check catches a sample figure on a screen that is not the last one opened', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page, { earmark: 0 });
  await openApp(page, '/koboflow-test/');
  assert.deepEqual(await noSampleText(page), [], 'clean before the injected regression');
  // Simulate a regression: a sample figure rendered on Cash Drop (opened mid-way, not last). Page DOM only; no stored data.
  await page.evaluate(() => { const d = document.createElement('div'); d.textContent = 'Chain sprocket ₦32,500'; document.getElementById('screen-cashdrop').appendChild(d); });
  const all = await screens(page);
  assert.notEqual(all[all.length - 1], 'cashdrop');
  // The previous check (visit every screen, then read the page once) only saw the last screen and missed it.
  await visitAll(page);
  const lastOnly = await page.evaluate(() => document.body.innerText);
  assert.equal(lastOnly.includes('Chain sprocket'), false, 'old approach is blind to hidden screens');
  assert.deepEqual(await noSampleText(page), ['cashdrop: Chain sprocket', 'cashdrop: 32,500']);
  // A hard-coded target claim in new wording, on another non-last screen, is caught by its shape.
  await page.evaluate(() => { document.getElementById('screen-cashdrop').lastChild.remove(); const d = document.createElement('div'); d.textContent = 'Savings vs ₦2.5M Target'; document.getElementById('screen-networth').appendChild(d); });
  assert.deepEqual(await noSampleText(page), [String.raw`networth: /₦\s?\d+(?:\.\d+)?\s?[mk]\b/`, String.raw`networth: /\bvs\.?\s+₦[\d,.]+\s*[mk]?\s+(?:goal|target)/`]);
  await context.close();
});

test('TEST build: demo mode keeps its clearly labelled sample figures', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  assert.match(await text(page, '#score-num'), /^\d+$/, 'demo health score is a number');
  assert.match(await text(page, '#budget-list'), /Household/);
  await nav(page, 'cashdrop');
  assert.doesNotMatch(await text(page, '#drop-list'), /Not available/);
  await nav(page, 'networth');
  assert.match(await text(page, '#nw-change'), /sample trend/);
  assert.equal(await text(page, '#fi-goal-label'), 'Net Worth vs ₦10M Goal (sample)', 'demo goal is labelled as a sample');
  await nav(page, 'vehicles');
  assert.match(await text(page, '#vehicle-panels'), /Chain sprocket/);
  await nav(page, 'analytics');
  assert.match(await text(page, '#insights-list'), /\(sample\)/);
  assert.match(await text(page, '#mode-note'), /Demo mode/);
  await context.close();
});
