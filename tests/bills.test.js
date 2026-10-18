// Bills (database v4): adding one-time and recurring bills, full and partial payment, linked
// earmarks, linking a payment recorded elsewhere, changes, cancellation, failed saves, and the
// working-capital floor in Opportunity Analysis. TEST site and production candidate. Fictional data only.
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

// Fail-able writes (same switch as the account-setup tests): window.__fail.write makes every put throw.
const switches = () => {
  window.__fail = {};
  const P = IDBObjectStore.prototype, put = P.put;
  P.put = function () { if (window.__fail.write) throw new DOMException('simulated write failure', 'QuotaExceededError'); return put.apply(this, arguments); };
};
async function ctxF() { const r = await ctx(); await r.context.addInitScript(switches); return r; }
async function liveSetup(page, { floor = '' } = {}) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(60));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  for (const [i, label, kind, opening] of [[1, 'Fictional Bank', 'bank', 500000], [2, 'Fictional Coop', 'coop', 80000]]) {
    await page.click('#setup-add-acct');
    await row(i).locator('[data-f=label]').fill(label); await row(i).locator('[data-f=kind]').selectOption(kind); await row(i).locator('[data-f=opening]').fill(String(opening));
  }
  await page.click('#setup-add-bucket');
  const b = page.locator('#setup-buckets [data-bucket-row="0"]');
  await b.locator('[data-f=label]').fill('Fictional Rent'); await b.locator('[data-f=parentId]').selectOption('acc_opay'); await b.locator('[data-f=amount]').fill('30000');
  if (floor) await page.fill('#setup-wc-floor', String(floor));
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
async function addBill(page, { name, amount, due, repeat = 'monthly', cat = 'Business Overhead' }) {
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await page.fill('#bill-name', name); await page.selectOption('#bill-cat', cat); await page.fill('#bill-amount', String(amount));
  await page.fill('#bill-first', await plusDays(page, due)); await page.selectOption('#bill-repeat', repeat);
  await page.click('#bill-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
}
const storedBills = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('bills').objectStore('bills').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), n);
const dirRow = async (page, k) => (await text(page, `#director-body [data-dir-row="${k}"] .autopilot-val`)).trim();
const firstOcc = page => page.getAttribute('#bills-due [data-bill-occ]', 'data-bill-occ');
async function pay(page, occ, { amount, account, dbl = false } = {}) {
  await nav(page, 'bills'); await page.click(`[data-bill-pay="${occ}"]`); await page.waitForSelector('#bill-pay-modal.open');
  if (amount !== undefined) await page.fill('#bill-pay-amount', String(amount));
  if (account) await page.selectOption('#bill-pay-account', { label: account });
  if (dbl) await page.dblclick('#bill-pay-save-btn'); else await page.click('#bill-pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
}

for (const b of BUILDS) {
  test(`${b.label}: a recurring bill is one record whose dates appear once on every screen; part and full payments reconcile`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await addBill(page, { name: 'Fictional shop rent', amount: 50000, due: 5 });
    // Cash Now 600,000; general earmark 30,000 → free to use 570,000; 50,000 due in 5 days (30-day window).
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'free'), '₦570,000');
    assert.equal(await dirRow(page, 'uncovered'), '₦50,000');
    assert.equal(await dirRow(page, 'after'), '₦520,000');
    assert.match(await text(page, '#director-body [data-dir-obl]'), /Fictional shop rent[\s\S]*Not funded/);
    assert.match(await text(page, '#director-body [data-dir-action="due_soon"]'), /Set aside ₦50,000 for Fictional shop rent/);
    const ap = await text(page, '#autopilot-body');
    assert.match(ap, /Committed: Next 30 Days₦50,000/);
    assert.match(ap, /Left After Known Obligations \(free to use\)\+₦520,000/);
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Cash Now \(gross\)₦600,000Free to Use \(after earmarks\)₦570,000Obligations₦50,000Left After\+₦520,000/);
    assert.match(await text(page, '#pressure-items'), /Fictional shop rent/);
    await nav(page, 'calendar');
    assert.match(await text(page, '#cal-summary'), /Due \(60 days\)₦100,000[\s\S]*Left After\+₦470,000/, 'two monthly dates inside 60 days');
    await nav(page, 'home');
    assert.match(await text(page, '#ob-list'), /Fictional shop rent/);
    // Reload: still one bill, each date once.
    await openApp(page, b.url);
    assert.equal((await storedBills(context, b.dbName)).length, 1);
    await nav(page, 'bills');
    assert.equal(await page.$$eval('#bills-due [data-bill-occ]', r => r.length), 2);
    // Part payment, double-tapped: one payment, cash down once; the bill's remaining is the only obligation left.
    const occ = await firstOcc(page);
    await pay(page, occ, { amount: 20000, account: 'Fictional Bank', dbl: true });
    let paid = (await storedTxns(context, b.dbName)).filter(t => t.billOcc === occ);
    assert.equal(paid.length, 1, 'double tap saved once');
    assert.deepEqual([paid[0].type, paid[0].amount, paid[0].billId.length > 0], ['obligation', 20000, true]);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦580,000');
    assert.equal(await dirRow(page, 'uncovered'), '₦30,000');
    assert.equal(await dirRow(page, 'after'), '₦520,000', 'paying a bill does not change free cash after commitments');
    await nav(page, 'bills');
    assert.match(await text(page, '#bills-due'), /paid ₦20,000, left ₦30,000[\s\S]*Part paid/);
    await pay(page, occ, {});
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦550,000');
    assert.equal(await dirRow(page, 'uncovered'), '₦0', 'a paid bill is no longer due');
    assert.equal(await dirRow(page, 'after'), '₦520,000');
    await nav(page, 'bills');
    assert.equal(await page.$$eval('#bills-due [data-bill-occ]', r => r.length), 1, 'only next month remains');
    assert.match(await text(page, '#bills-list'), /Payments: [\s\S]*₦20,000[\s\S]*₦30,000/);
    await nav(page, 'home');
    assert.doesNotMatch(await text(page, '#ob-list'), /Fictional shop rent/);
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: an earmark linked to a bill covers it once; after payment it reserves the next date`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await addBill(page, { name: 'Fictional shop rent', amount: 50000, due: 5 });
    await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
    await page.click('#setup-add-bucket');
    const nb = page.locator('#setup-buckets [data-bucket-row="1"]');
    await nb.locator('[data-f=label]').fill('Rent money'); await nb.locator('[data-f=parentId]').selectOption({ label: 'Fictional Bank' }); await nb.locator('[data-f=amount]').fill('50000');
    await nb.locator('[data-f=reservedFor]').selectOption({ label: 'Bill: Fictional shop rent' });
    await page.click('#setup-save-btn');
    assert.match(await text(page, '#setup-confirm'), /New earmark: Rent money ₦50,000 inside Fictional Bank for Bill: Fictional shop rent/);
    await page.click('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'linked'), '₦50,000');
    assert.equal(await dirRow(page, 'free'), '₦520,000');
    assert.equal(await dirRow(page, 'uncovered'), '₦0');
    assert.equal(await dirRow(page, 'after'), '₦520,000', 'not 470,000: the reserved naira is deducted once');
    assert.match(await text(page, '#director-body [data-dir-obl]'), /₦50,000 reserved[\s\S]*Funded/);
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Obligations₦50,000Left After\+₦520,000Covered by Linked Earmarks₦50,000/);
    await nav(page, 'bills');
    await pay(page, await firstOcc(page), { account: 'Fictional Bank' });
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦550,000');
    assert.equal(await dirRow(page, 'linked'), '₦50,000', 'now reserving next month');
    assert.equal(await dirRow(page, 'free'), '₦470,000');
    assert.equal(await dirRow(page, 'after'), '₦470,000');
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: a payment entered in Add Entry links to its bill; an unlinked one is flagged and can be linked, never counted twice`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await addBill(page, { name: 'Fictional electricity', amount: 7000, due: 3, repeat: 'none', cat: 'Utilities' });
    await addBill(page, { name: 'Fictional water', amount: 4000, due: 2, repeat: 'none', cat: 'Utilities' });
    await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
    await page.click('.type-chip[data-type="obligation"]');
    assert.equal(await page.isVisible('#modal-bill'), true);
    const elec = await page.$eval('#modal-bill', s => Array.from(s.options).find(o => /Fictional electricity/.test(o.textContent)).value);
    await page.selectOption('#modal-bill', elec);
    await page.fill('#modal-amount', '7000'); await page.fill('#modal-desc', 'Electricity token'); await page.selectOption('#modal-from', 'acc_opay');
    await page.click('#modal-save-btn');
    await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
    // A water payment recorded without choosing the bill.
    await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
    await page.click('.type-chip[data-type="obligation"]');
    await page.fill('#modal-amount', '4000'); await page.fill('#modal-desc', 'Water bill'); await page.selectOption('#modal-from', 'acc_opay');
    await page.click('#modal-save-btn');
    await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
    await nav(page, 'director');
    assert.match(await text(page, '#director-body [data-dir-quality="bill_maybe_paid"]'), /"Water bill" \(₦4,000[\s\S]*may be the payment for Fictional water/);
    assert.equal(await dirRow(page, 'uncovered'), '₦4,000', 'electricity is paid; water still looks due');
    await nav(page, 'bills');
    assert.doesNotMatch(await text(page, '#bills-due'), /Fictional electricity/);
    assert.match(await text(page, '#bills-due'), /Fictional water[\s\S]*a matching payment may already be recorded/);
    const before = (await storedTxns(context, b.dbName)).length;
    await page.click(`[data-bill-pay="${await firstOcc(page)}"]`); await page.waitForSelector('#bill-pay-modal.open');
    assert.match(await text(page, '#bill-pay-candidates'), /Water bill[\s\S]*LINK THIS PAYMENT/);
    await page.click('[data-bill-link]');
    await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
    const txs = await storedTxns(context, b.dbName);
    assert.equal(txs.length, before, 'linked, not recorded again');
    assert.match(txs.find(t => t.desc === 'Water bill').billOcc, /@/);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'uncovered'), '₦0');
    assert.equal(await page.$('#director-body [data-dir-quality="bill_maybe_paid"]'), null);
    assert.equal(await dirRow(page, 'cash'), '₦589,000', '600,000 − 7,000 − 4,000: each payment once');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: overdue, "not owed", an amount change from a date, a reversed payment and cancellation; history is kept', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  await addBill(page, { name: 'Fictional salary', amount: 40000, due: -10 });
  await nav(page, 'director');
  assert.match(await text(page, '#director-body [data-dir-action="overdue"]'), /^1\. Pay Fictional salary: 10 days overdue/);
  await nav(page, 'networth');
  assert.match(await text(page, '#nw-liabs-list'), /Fictional salary \(overdue bill/);
  assert.equal(await text(page, '#nw-liabs'), '₦40,000');
  // Not owed (waived): no longer due, and not a liability.
  await nav(page, 'bills');
  await page.click(`[data-bill-skip="${await firstOcc(page)}"]`);
  await page.waitForFunction(() => /Marked not owed/.test(document.getElementById('bills-list').textContent));
  await nav(page, 'networth');
  assert.equal(await text(page, '#nw-liabs'), '₦0');
  // Amount change from 25 days ahead: the date in 20 days keeps 40,000; the one in 50 days is 45,000.
  await nav(page, 'bills');
  await page.click('[data-bill-edit]'); await page.waitForSelector('#bill-modal.open');
  assert.equal(await page.isDisabled('#bill-first'), false, 'no payments yet: schedule still editable');
  await page.fill('#bill-amount', '45000'); await page.fill('#bill-amount-from', await plusDays(page, 25));
  await page.click('#bill-save-btn'); await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
  const due = await page.$$eval('#bills-due [data-bill-occ]', r => r.map(x => x.textContent));
  assert.match(due[0], /₦40,000/); assert.match(due[1], /₦45,000/);
  const [bill] = await storedBills(context, 'KoboFlowDB-test');
  assert.equal(bill.amountChanges.length, 1);
  assert.equal(bill.history.length, 3, 'created, not owed, amount change');
  // Pay, then reverse: the bill is due again and the money is back.
  const occ = await firstOcc(page);
  await pay(page, occ, {});
  await nav(page, 'director'); const cashPaid = await dirRow(page, 'cash');
  assert.equal(cashPaid, '₦560,000');
  await nav(page, 'bills');
  assert.equal(await page.isDisabled('[data-bill-edit]') , false);
  await page.click('[data-bill-reverse]');
  await page.waitForFunction(() => /\(reversed\)/.test(document.getElementById('bills-list').textContent));
  assert.equal((await storedTxns(context, 'KoboFlowDB-test')).find(t => t.billOcc === occ).voided, true, 'kept, marked reversed');
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'cash'), '₦600,000');
  // With a (reversed) payment on record the schedule is still editable only if no live payment exists.
  await pay(page, occ, {});
  await nav(page, 'bills'); await page.click('[data-bill-edit]'); await page.waitForSelector('#bill-modal.open');
  assert.equal(await page.isDisabled('#bill-first'), true, 'a bill with payments keeps its schedule');
  await page.click('[data-close="bill-modal"]');
  // Cancel: nothing further is due; the paid date stays paid.
  await page.click('[data-bill-cancel]');
  await page.waitForFunction(() => /Cancelled from/.test(document.getElementById('bills-list').textContent));
  assert.equal(await page.$$eval('#bills-due [data-bill-occ]', r => r.length), 0);
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'uncovered'), '₦0');
  assert.equal((await storedBills(context, 'KoboFlowDB-test'))[0].status, 'cancelled');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: a failed bill save or payment shows no success, keeps the input, and a retry saves exactly once', { skip }, async () => {
  const { context, page } = await ctxF();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await page.fill('#bill-name', 'Fictional internet'); await page.fill('#bill-amount', '12000'); await page.fill('#bill-first', await plusDays(page, 4));
  await page.evaluate(() => { window.__fail.write = true; });
  await page.click('#bill-save-btn');
  await page.waitForFunction(() => /Not saved/.test(document.getElementById('bill-form-msg').textContent));
  assert.equal(await page.isVisible('#bill-modal'), true);
  assert.equal(await page.inputValue('#bill-name'), 'Fictional internet');
  assert.deepEqual(await storedBills(context, 'KoboFlowDB-test'), []);
  await page.evaluate(() => { window.__fail.write = false; });
  await page.click('#bill-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
  assert.equal((await storedBills(context, 'KoboFlowDB-test')).length, 1, 'one bill, not two');
  await nav(page, 'bills'); await page.click(`[data-bill-pay="${await firstOcc(page)}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.evaluate(() => { window.__fail.write = true; });
  await page.click('#bill-pay-save-btn');
  await page.waitForFunction(() => /Payment NOT recorded/.test(document.getElementById('bill-pay-msg').textContent));
  assert.equal((await storedTxns(context, 'KoboFlowDB-test')).filter(t => t.billId).length, 0);
  await page.evaluate(() => { window.__fail.write = false; });
  await page.click('#bill-pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  assert.equal((await storedTxns(context, 'KoboFlowDB-test')).filter(t => t.billId).length, 1, 'exactly one payment after the retry');
  await context.close();
});

test('TEST build: Opportunity Analysis and the Director apply the same working-capital floor once; no floor is stated plainly', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page, { floor: 500000 });
  await addBill(page, { name: 'Fictional shop rent', amount: 50000, due: 5 });
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'after'), '₦520,000');
  assert.equal(await dirRow(page, 'floor'), '₦500,000');
  assert.equal(await dirRow(page, 'safe'), '₦20,000');
  const analyse = async () => {
    await nav(page, 'opportunity');
    await page.fill('#opp-name', 'Fictional offer'); await page.fill('#opp-received', '150000');
    await page.selectOption('#opp-structure', 'fixed_total'); await page.fill('#opp-inst', '55455'); await page.fill('#opp-count', '4');
    await page.fill('#opp-first-due', await plusDays(page, 30)); await page.fill('#opp-profit', '90000');
    await page.selectOption('#opp-period', '180'); await page.selectOption('#opp-recovery', 'end');
    await page.click('#opp-calc-btn');
    return text(page, '#opp-result');
  };
  // All four instalments (221,820) fall due before any cash comes back, and the monthly rent falls due three more
  // times in that period (150,000): lowest free cash 520,000 − 221,820 − 150,000 = 148,180.
  const r = await analyse();
  assert.match(r, /Free cash after known payments due in 30 days \(before this commitment\)₦520,000/);
  assert.match(r, /Working-capital floor \(your setting\)₦500,000/);
  assert.match(r, /Free to allocate before this commitment₦20,000/, 'the same figure as the Director');
  assert.match(r, /Your other known payments due after 30 days, during the repayment period₦150,000/);
  assert.match(r, /Lowest free cash while repaying \(after this commitment\)₦148,180/);
  assert.match(r, /Compared with your floor₦351,820 below/);
  assert.match(r, /below your working-capital floor of ₦500,000/);
  assert.match(r, /Money received from this funding is not income/);
  // Without a floor: the result is qualified, never a made-up target.
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-wc-floor', '');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
  const n = await analyse();
  assert.match(n, /Working-capital floor \(your setting\)Not set/);
  assert.match(n, /Free to allocate before this commitment₦520,000 \(no floor set\)/);
  assert.match(n, /No working-capital floor is set, so this check does not protect money you need for restocking/);
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'safe'), '₦520,000');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: an HTML-looking bill name is shown as text on every screen and never runs', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  const evil = '<img src=x onerror="window.__pwned=1">Rent';
  await addBill(page, { name: evil, amount: 1000, due: 2 });
  for (const sc of ['bills', 'director', 'pressure', 'calendar', 'home']) {
    await nav(page, sc);
    assert.ok((await page.textContent(`#screen-${sc}`)).includes(evil), sc + ' shows the name literally');
  }
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.click('#setup-add-bucket');
  assert.ok((await page.locator('#setup-buckets [data-bucket-row="1"] [data-f=reservedFor]').innerText()).includes('Bill: ' + evil));
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.$$eval('img[src="x"]', i => i.length), 0);
  await context.close();
});

async function createLoan(page, { first = 20 } = {}) {
  await nav(page, 'loans'); await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, first)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched'); await page.click('#agr-save-btn'); await page.waitForSelector('#screen-agreement.active');
}

for (const b of BUILDS) {
  test(`${b.label}: one dataset (loan, monthly bill with a linked earmark, overdue bill, general earmark) reconciles on every screen`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await createLoan(page);
    await addBill(page, { name: 'Fictional shop rent', amount: 50000, due: 5 });
    await addBill(page, { name: 'Fictional salary', amount: 40000, due: -3, repeat: 'none' });
    await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
    await page.click('#setup-add-bucket');
    const nb = page.locator('#setup-buckets [data-bucket-row="1"]');
    await nb.locator('[data-f=label]').fill('Rent money'); await nb.locator('[data-f=parentId]').selectOption({ label: 'Fictional Bank' }); await nb.locator('[data-f=amount]').fill('50000');
    await nb.locator('[data-f=reservedFor]').selectOption({ label: 'Bill: Fictional shop rent' });
    await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
    await openApp(page, b.url);
    // Cash Now 100,000 + 150,000 + 500,000 = 750,000. Earmarks: 30,000 general + 50,000 linked → free to use 670,000.
    // Due in 30 days: rent 50,000 (fully reserved), loan #1 55,455, overdue salary 40,000 → 145,455 due, 50,000 covered,
    // 95,455 uncovered → free after commitments 574,545. Coop 80,000 is restricted: in net worth, not in cash.
    await nav(page, 'director');
    const D = {}; for (const k of ['cash', 'general', 'linked', 'free', 'uncovered', 'after', 'floor', 'safe', 'restricted']) D[k] = await dirRow(page, k);
    assert.deepEqual(D, { cash: '₦750,000', general: '₦30,000', linked: '₦50,000', free: '₦670,000', uncovered: '₦95,455', after: '₦574,545', floor: 'Not set', safe: '₦574,545', restricted: '₦80,000' });
    assert.equal((await page.$$eval('#director-body [data-dir-action]', a => a.map(x => x.dataset.dirAction)))[0], 'overdue');
    const ap = await text(page, '#autopilot-body');
    for (const re of [/Cash Now \(actual\)₦750,000/, /of which earmarked₦80,000/, /free to use \(after earmarks\)₦670,000/, /Restricted \(coop, fixed deposit\)₦80,000/, /Committed: Next 30 Days₦145,455/, /covered by linked earmarks₦50,000/, /Left After Known Obligations \(free to use\)\+₦574,545/]) assert.match(ap, re);
    await nav(page, 'pressure');
    assert.match(await text(page, '#pressure-vs'), /Cash Now \(gross\)₦750,000Free to Use \(after earmarks\)₦670,000Obligations₦145,455Left After\+₦574,545Covered by Linked Earmarks₦50,000/);
    await nav(page, 'calendar');
    const cal = await text(page, '#cal-summary');
    const due60 = Number(/Due \(60 days\)₦([\d,]+)/.exec(cal)[1].replace(/,/g, ''));
    // 60 days: rent ×2 (100,000), loan #1 and #2 (110,910), salary (40,000) = 250,910; 50,000 reserved → 670,000 − 200,910.
    assert.equal(due60, 250910);
    assert.match(cal, /Free to Use₦670,000[\s\S]*Left After\+₦469,090/);
    await nav(page, 'home');
    assert.match(await text(page, '#director-teaser'), /Free to allocate now₦574,545/);
    const ob = await text(page, '#ob-list');
    assert.match(ob, /Fictional shop rent/); assert.match(ob, /Fictional salary/);
    await nav(page, 'networth');
    // Assets 750,000 + 80,000 = 830,000. Liabilities: loan 221,820 + overdue salary 40,000 = 261,820. Earmarks are not assets.
    assert.equal(await text(page, '#nw-assets'), '₦830,000');
    assert.equal(await text(page, '#nw-liabs'), '₦261,820');
    assert.equal(await text(page, '#nw-total'), '₦568,180');
    await nav(page, 'loans');
    assert.match(await text(page, '#loan-summary'), /221,820/);
    // Opportunity Analysis starts from the same free cash.
    await nav(page, 'opportunity');
    await page.fill('#opp-name', 'Fictional offer'); await page.fill('#opp-received', '150000');
    await page.selectOption('#opp-structure', 'fixed_total'); await page.fill('#opp-inst', '55455'); await page.fill('#opp-count', '4');
    await page.fill('#opp-first-due', await plusDays(page, 30)); await page.fill('#opp-profit', '90000');
    await page.click('#opp-calc-btn');
    assert.match(await text(page, '#opp-result'), /Free cash after known payments due in 30 days \(before this commitment\)₦574,545/);
    // Paying the overdue bill: cash and the liability fall by the same 40,000; net worth unchanged; nothing double-counted.
    await nav(page, 'bills');
    const sal = await page.$eval('#bills-due', el => Array.from(el.querySelectorAll('[data-bill-occ]')).find(r => /Fictional salary/.test(r.textContent)).dataset.billOcc);
    await pay(page, sal, {});
    await nav(page, 'networth');
    assert.equal(await text(page, '#nw-assets'), '₦790,000');
    assert.equal(await text(page, '#nw-liabs'), '₦221,820');
    assert.equal(await text(page, '#nw-total'), '₦568,180');
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦710,000');
    assert.equal(await dirRow(page, 'uncovered'), '₦55,455');
    assert.equal(await dirRow(page, 'after'), '₦574,545', 'paying a due bill leaves free cash after commitments unchanged');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: a payment linked from Add Entry can be unlinked (still money spent), never voided by mistake', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, '/koboflow-test/');
  await liveSetup(page);
  await addBill(page, { name: 'Fictional water', amount: 4000, due: 2, repeat: 'none', cat: 'Utilities' });
  await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
  await page.click('.type-chip[data-type="obligation"]');
  await page.fill('#modal-amount', '4000'); await page.fill('#modal-desc', 'Water bill'); await page.selectOption('#modal-from', 'acc_opay');
  await page.click('#modal-save-btn'); await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
  await nav(page, 'bills');
  await page.click(`[data-bill-pay="${await firstOcc(page)}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.click('[data-bill-link]'); await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  assert.equal(await page.$('[data-bill-reverse]'), null, 'no Reverse for a payment recorded elsewhere');
  await page.click('[data-bill-unlink]');
  await page.waitForFunction(() => document.querySelectorAll('#bills-due [data-bill-occ]').length === 1);
  const t = (await storedTxns(context, 'KoboFlowDB-test')).find(x => x.desc === 'Water bill');
  assert.equal(t.voided, undefined, 'still money spent');
  assert.equal(t.billId, undefined);
  assert.equal(t.billLinks.length, 1, 'the link history is kept');
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'cash'), '₦596,000', 'the 4,000 stays spent');
  assert.equal(await dirRow(page, 'uncovered'), '₦4,000', 'the bill is due again');
  await context.close();
});
