// Integrated financial-intelligence build: reservations linked to obligations, the Daily Money
// Director, planning targets (working-capital floor, net-worth goal, budgets) and correcting an
// uncertain entry. Runs against the generated TEST site and the production candidate. Fictional data only.
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
const plusDays = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const storedSetup = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('ledgerSetup'); g.onsuccess = () => { q.result.close(); res(g.result || null); }; }; }), n);
const storedTxns = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), n);
const seed = (context, n, recs) => probe(context, ([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), [n, recs]);

// Live setup: Opay wallet 100,000 (earmark "Fictional Rent" 30,000, general); bank 500,000; coop 80,000 restricted.
async function liveSetup(page, { baselineDays = 60 } = {}) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(baselineDays));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  for (const [i, label, kind, opening] of [[1, 'Fictional Bank', 'bank', 500000], [2, 'Fictional Coop', 'coop', 80000]]) {
    await page.click('#setup-add-acct');
    await row(i).locator('[data-f=label]').fill(label); await row(i).locator('[data-f=kind]').selectOption(kind); await row(i).locator('[data-f=opening]').fill(String(opening));
  }
  // Stage 1 (item C): "Used For" no longer defaults to Business; none of this file's scenarios
  // are about ownership, so every account is chosen and confirmed explicitly.
  for (const i of [0, 1, 2]) await row(i).locator('[data-f=use]').selectOption('business');
  await page.click('#setup-add-bucket');
  const b = page.locator('#setup-buckets [data-bucket-row="0"]');
  await b.locator('[data-f=label]').fill('Fictional Rent'); await b.locator('[data-f=parentId]').selectOption('acc_opay'); await b.locator('[data-f=amount]').fill('30000');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await saveSetup(page);
}
async function saveSetup(page) {
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
async function openSetupForm(page) { await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open'); }
// Fictional loan: 150,000 received into Opay; 4 monthly instalments of 55,455, the first in `first` days.
async function createLoan(page, { first = 20 } = {}) {
  await nav(page, 'loans');
  await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, first)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#screen-agreement.active');
}
const dirRow = async (page, k) => (await text(page, `#director-body [data-dir-row="${k}"] .autopilot-val`)).trim();

for (const b of BUILDS) {
  test(`${b.label}: an earmark linked to a loan covers its instalment once; every screen agrees; paying moves the reservation on`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await createLoan(page);
    // Before linking: Cash Now 750,000; general earmark 30,000 → free to use 720,000; 55,455 due in 30 days, unreserved.
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'after'), '₦664,545');
    assert.match(await text(page, '#director-body [data-dir-action="due_soon"], #director-body [data-dir-action="reserve"]'), /Reserve ₦55,455 for Fictional Loan #1|Set aside ₦55,455 for Fictional Loan #1/);
    // Link a 55,455 earmark in the bank to the loan.
    await openSetupForm(page);
    await page.click('#setup-add-bucket');
    const nb = page.locator('#setup-buckets [data-bucket-row="1"]');
    await nb.locator('[data-f=label]').fill('Fictional instalment money'); await nb.locator('[data-f=parentId]').selectOption({ label: 'Fictional Bank' }); await nb.locator('[data-f=amount]').fill('55455');
    assert.match(await nb.locator('[data-f=reservedFor]').innerText(), /General purpose[\s\S]*Loan: Fictional Loan/);
    await nb.locator('[data-f=reservedFor]').selectOption({ label: 'Loan: Fictional Loan' });
    await page.click('#setup-save-btn');
    assert.match(await text(page, '#setup-confirm'), /New earmark: Fictional instalment money ₦55,455 inside Fictional Bank for Loan: Fictional Loan/);
    await page.click('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    const st = await storedSetup(context, b.dbName);
    assert.match(st.buckets[1].reservedFor, /^agr:/, 'link saved');
    await openApp(page, b.url); // after reload
    // Linked: earmarks 85,455 → free to use 664,545; the instalment is fully covered, so nothing more is subtracted.
    const ap = await text(page, '#autopilot-body');
    assert.match(ap, /Cash Now \(actual\)₦750,000/);
    assert.match(ap, /free to use \(after earmarks\)₦664,545/);
    assert.match(ap, /Committed: Next 30 Days₦55,455/);
    assert.match(ap, /covered by linked earmarks₦55,455/);
    assert.match(ap, /Left After Known Obligations \(free to use\)\+₦664,545/, 'not 609,090: the reserved naira is not deducted twice');
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Free to Use \(after earmarks\)₦664,545Obligations₦55,455Left After\+₦664,545Covered by Linked Earmarks₦55,455/);
    assert.equal(await text(page, '#pressure-score'), '0', 'a fully reserved payment adds no pressure');
    await nav(page, 'calendar');
    assert.match(await text(page, '#cal-summary'), /₦55,455 of the amount due is already covered by linked earmarks/);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦750,000');
    assert.equal(await dirRow(page, 'general'), '₦30,000');
    assert.equal(await dirRow(page, 'linked'), '₦55,455');
    assert.equal(await dirRow(page, 'free'), '₦664,545');
    assert.equal(await dirRow(page, 'uncovered'), '₦0');
    assert.equal(await dirRow(page, 'after'), '₦664,545');
    assert.equal(await dirRow(page, 'floor'), 'Not set');
    assert.equal(await dirRow(page, 'safe'), '₦664,545');
    assert.match(await text(page, '#director-body [data-dir-obl]'), /Fictional Loan #1[\s\S]*₦55,455, ₦55,455 reserved[\s\S]*Funded/);
    assert.equal(await page.$('#director-body [data-dir-action="reserve"], #director-body [data-dir-action="due_soon"]'), null, 'nothing left to reserve');
    assert.match(await text(page, '#director-body [data-dir-action="set_floor"]'), /Set a working-capital floor/);
    assert.match(await text(page, '#director-teaser'), /Free to allocate now₦664,545/);
    // Opportunity Analysis uses the same free cash after commitments.
    await nav(page, 'opportunity');
    await page.fill('#opp-name', 'Fictional offer'); await page.fill('#opp-received', '150000');
    await page.selectOption('#opp-structure', 'fixed_total'); await page.fill('#opp-inst', '55455'); await page.fill('#opp-count', '4');
    await page.fill('#opp-first-due', await plusDays(page, 30)); await page.fill('#opp-profit', '90000');
    await page.click('#opp-calc-btn');
    assert.match(await text(page, '#opp-result'), /Uncommitted cash today \(after 30-day bills & loans\)₦664,545/);
    // Pay instalment #1 from the bank. The reservation moves on to the remaining instalments (still owed),
    // the payment is not counted again as an obligation, and the bank balance falls once.
    await nav(page, 'loans');
    await page.click('#loan-active .agr-card');
    await page.click('[data-act="pay"]');
    await page.selectOption('#pay-account', { label: 'Fictional Bank' }).catch(async () => page.selectOption('#pay-account', st.buckets[1].parentId));
    await page.click('#pay-save-btn');
    await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
    const ap2 = await text(page, '#autopilot-body');
    assert.match(ap2, /Cash Now \(actual\)₦694,545/, '750,000 − 55,455 paid');
    assert.match(ap2, /of which earmarked₦85,455/, 'still reserved: 166,365 is still owed on the loan');
    assert.match(ap2, /Committed: Next 30 Days₦0/);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'free'), '₦609,090');
    assert.equal(await dirRow(page, 'after'), '₦609,090');
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: planning targets are optional, reviewed before saving, persist, and drive the Director, budgets and the net-worth goal`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await openSetupForm(page);
    assert.equal(await page.inputValue('#setup-wc-floor'), '', 'nothing pre-filled');
    assert.equal(await page.inputValue('#setup-nw-goal'), '');
    await page.fill('#setup-wc-floor', '500000');
    await page.fill('#setup-nw-goal', '2000000');
    await page.click('#setup-add-budget');
    const br = page.locator('#setup-budgets [data-budget-row="0"]');
    await br.locator('[data-f=cat]').selectOption('Food'); await br.locator('[data-f=amount]').fill('20000');
    await page.click('#setup-save-btn');
    const conf = await text(page, '#setup-confirm');
    assert.match(conf, /Working-capital floor: not set → ₦500,000/);
    assert.match(conf, /Net-worth goal: not set → ₦2,000,000/);
    assert.match(conf, /New budget: Food ₦20,000 a month/);
    await page.click('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    const st = await storedSetup(context, b.dbName);
    assert.deepEqual(st.planning, { workingCapitalFloor: 500000, netWorthGoal: 2000000 });
    assert.deepEqual(st.budgets.map(x => [x.cat, x.amount]), [['Food', 20000]]);
    await seed(context, b.dbName, [
      { id: 95001, amount: 5000, desc: 'Fictional groceries', cat: 'Food', type: 'expense', state: 'Linked', date: today(), time: '09:00', fromAcct: 'acc_opay', toAcct: '' },
    ]);
    await openApp(page, b.url);
    // Cash Now 595,000; earmark 30,000 → free 565,000; nothing due; floor 500,000 → free to allocate 65,000.
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'free'), '₦565,000');
    assert.equal(await dirRow(page, 'floor'), '₦500,000');
    assert.equal(await dirRow(page, 'safe'), '₦65,000');
    assert.match(await text(page, '#director-body [data-dir-action="free"]'), /₦65,000 can go to other purposes[\s\S]*and your working-capital floor/);
    await nav(page, 'home');
    assert.match(await text(page, '#budget-list'), /Food₦5,000 of ₦20,00025%/);
    assert.match(await text(page, '#score-num'), /^\d+$/, 'a score only now that a budget exists');
    assert.match(await text(page, '#score-msg'), /From 1 budget you set/);
    await nav(page, 'networth');
    // Net worth = 595,000 + 80,000 coop = 675,000 → 34% of 2,000,000.
    assert.equal(await text(page, '#fi-goal-label'), 'Progress toward the goal you set (₦2,000,000)');
    assert.equal(await text(page, '#fi-pct-label'), '34%');
    // Floor above free cash: the Director protects it and offers nothing to allocate.
    await openSetupForm(page);
    await page.fill('#setup-wc-floor', '600000');
    await saveSetup(page);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'safe'), '₦0');
    assert.match(await text(page, '#director-body [data-dir-action="floor_breach"]'), /Protect pharmacy working capital: ₦35,000 below your floor/);
    assert.equal(await page.$('#director-body [data-dir-action="free"]'), null);
    // Clearing a target returns it to "not set".
    await openSetupForm(page);
    await page.fill('#setup-wc-floor', '');
    await page.click('#setup-save-btn');
    assert.match(await text(page, '#setup-confirm'), /Working-capital floor: ₦600,000 → not set/);
    await page.click('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    assert.equal((await storedSetup(context, b.dbName)).planning.workingCapitalFloor, null);
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: an uncertain fuel entry can be assigned to a vehicle from the Inbox; the change is kept and the original noted`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await page.fill('#capture-input', '5000 fuel'); await page.press('#capture-input', 'Enter');
    await page.waitForFunction(() => document.getElementById('capture-input').value === '');
    await nav(page, 'director');
    assert.match(await text(page, '#director-body [data-dir-quality="needs_review"]'), /1 entry needs review/);
    assert.match(await text(page, '#director-body [data-dir-status]'), /Some information is missing or uncertain/);
    await nav(page, 'inbox');
    const id = (await storedTxns(context, b.dbName)).find(t => t.desc === 'fuel').id;
    await page.selectOption(`[data-reclass-sel="${id}"]`, 'Vehicle: Sportage Green');
    await page.click(`[data-reclass="${id}"]`);
    await page.waitForFunction(() => !document.querySelector('[data-reclass]'));
    const t = (await storedTxns(context, b.dbName)).find(x => x.id === id);
    assert.deepEqual([t.cat, t.vehicle, t.vehicleCat, t.state, t.amount], ['Vehicle: Sportage Green', 'green', 'Fuel', 'Linked', 5000]);
    assert.equal(t.reclassified[0].from, 'Vehicle fuel (vehicle not set)');
    await openApp(page, b.url);
    await nav(page, 'vehicles');
    assert.equal(await text(page, '[data-vehicle-spent="green"]'), '₦5,000');
    assert.equal(await text(page, '[data-vehicle-spent="fjr"]'), '₦0');
    await nav(page, 'director');
    assert.equal(await page.$('#director-body [data-dir-quality="needs_review"]'), null);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: the Director ranks an overdue loan instalment first and reports a shortfall without suggesting anything to allocate', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  await createLoan(page, { first: -3 }); // first instalment 3 days overdue
  // Spend most of the cash so the overdue and upcoming instalments cannot be met.
  const st = await storedSetup(context, 'KoboFlowDB-test');
  const bank = st.accounts.find(a => a.label === 'Fictional Bank').id;
  await seed(context, 'KoboFlowDB-test', [{ id: 96001, amount: 580000, desc: 'Fictional large restock', cat: 'Restocking', type: 'expense', state: 'Linked', date: today(), time: '09:00', fromAcct: bank, toAcct: '' }]);
  await openApp(page, '/koboflow-test/');
  await nav(page, 'director');
  // Opay 250,000; bank 500,000 − 580,000 = −80,000 (overdrawn) → Cash Now 170,000; earmark 30,000 → free 140,000
  // (the negative bank balance counts in full: free-to-use never exceeds Cash Now). Flagged as a record problem. Due in 30 days: #1 (overdue) and #2 (in ~27 days) = 110,910 → +29,090.
  const kinds = await page.$$eval('#director-body [data-dir-action]', as => as.map(a => a.dataset.dirAction));
  assert.equal(kinds[0], 'overdue');
  assert.match(await text(page, '#director-body [data-dir-action="overdue"]'), /^1\. Pay Fictional Loan #1: 3 days overdue/);
  assert.equal(await dirRow(page, 'cash'), '₦170,000');
  assert.equal(await dirRow(page, 'free'), '₦140,000');
  assert.match(await text(page, '#director-body [data-dir-quality="negative_balance"]'), /Fictional Bank shows a negative balance \(-₦80,000\)/);
  assert.match(await text(page, '#autopilot-body'), /free to use \(after earmarks\)₦140,000/);
  const due = Number((await dirRow(page, 'uncovered')).replace(/[^\d]/g, ''));
  assert.ok(due === 55455 || due === 110910, 'one or two instalments inside 30 days: ' + due);
  assert.equal(await dirRow(page, 'after'), '₦' + (140000 - due).toLocaleString('en-NG'));
  // Make it a shortfall: an additional fictional expense.
  await seed(context, 'KoboFlowDB-test', [{ id: 96002, amount: 120000, desc: 'Fictional rent paid', cat: 'Business Overhead', type: 'expense', state: 'Linked', date: today(), time: '10:00', fromAcct: bank, toAcct: '' }]);
  await openApp(page, '/koboflow-test/');
  await nav(page, 'director');
  // Free 20,000 against the instalments due → shortfall; nothing offered to allocate.
  const k2 = await page.$$eval('#director-body [data-dir-action]', as => as.map(a => a.dataset.dirAction));
  assert.deepEqual(k2.slice(0, 2), ['overdue', 'shortfall']);
  assert.equal(await dirRow(page, 'safe'), '₦0');
  assert.equal(await page.$('#director-body [data-dir-action="free"]'), null);
  assert.match(await text(page, '#director-body [data-dir-action="shortfall"]'), /Shortfall of ₦[\d,]+ against payments due in 30 days[\s\S]*Restricted money \(coop, fixed deposit\) is not counted/);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: today\'s recorded income is shown as already inside Cash Now, never allocated a second time; PBSRx is not assumed', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  await seed(context, 'KoboFlowDB-test', [{ id: 97001, amount: 30000, desc: 'Fictional pharmacy sales', cat: 'Pharmacy Sales', type: 'income', state: 'Linked', date: today(), time: '18:00', fromAcct: '', toAcct: 'acc_opay' }]);
  await openApp(page, '/koboflow-test/');
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'cash'), '₦630,000', 'the 30,000 is already in the Opay balance');
  assert.equal(await dirRow(page, 'today-income'), '₦30,000');
  assert.match(await text(page, '#director-body'), /already inside Cash Now above[\s\S]*not allocated a second time/);
  assert.match(await text(page, '#director-body'), /PBSRx sales are not imported/);
  assert.equal(await dirRow(page, 'safe'), '₦600,000', '630,000 − 30,000 earmark; no percentage split of the sale');
  await context.close();
});
