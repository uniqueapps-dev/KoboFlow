// STAGE 2 — the screens, in the browser, on both builds (plan v11 sections 4, 5 J, 3B display rule, 3E.4–3E.6,
// 6.4; tests CF6, CF7 and the cross-screen rules R1–R12). Every figure a screen shows is read from the page and
// compared with ONE measures result computed by this file's engine on the same records, and the screens are
// compared with each other. Also: read-only rendering (no read-write transaction, identical stores), DB_VERSION 4,
// both switches OFF, the runway display rule, and offline use of the TEST site. Fictional data only; every test
// uses a fresh, disposable browser context served from 127.0.0.1 with every other host blocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const F = require('./load-engine')();
const gen = require('../scripts/build-test-file.js');
const { execFileSync } = require('child_process');
const STAGE1 = '3bdacf30f1ffbe257b324534ee9c1153c1e04651'; // the accepted Stage 1 source
const stage1 = {};
for (const [k, f] of [['test1', 'koboflow-test.html'], ['prod1', 'koboflow.html']]) { try { stage1[k] = execFileSync('git', ['show', `${STAGE1}:${f}`], { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 27 }); } catch (e) { stage1[k] = null; } }

const ROOT = path.join(__dirname, '..');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';
const SITE_DIR = process.env.KOBOFLOW_SITE_DIR || null;
const K = n => Math.round(n * 100);
const OPC = 'This is the cash movement from classified pharmacy operations only. Unresolved and provisional payments from pharmacy accounts are shown separately below and are not included in this figure.';

/* ── The shared fictional dataset (plan 5 J) ── */
const CONF = '2026-09-01T09:00:00.000Z';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, institution: 'Fictional', ...o });
const ALIASES = { pharma_cash: 'opay', pharma_bank: 'tb', pers_cash: '__outside', pers_bank: '', coop: '', emergency: '', fixed_dep: '' };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dates() {
  const now = new Date(), today = iso(now), yest = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const monthStart = today.slice(0, 8) + '01', monthEnd = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const baseline = iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), early = iso(new Date(now.getFullYear(), now.getMonth() - 2, 6));
  return { today, yest, monthStart, monthEnd, baseline, early };
}
function seedJ() {
  const D = dates();
  let i = 30000; const t = o => ({ id: i++, type: 'expense', amount: 1000, desc: 'Fictional', cat: 'Other', date: D.today, time: '12:00', fromAcct: '', toAcct: '', state: 'Manual', ...o });
  const accounts = [acct('opay', 'business', { kind: 'wallet', opening: 600000, primary: true }), acct('tb', 'business', { opening: 100000 }), acct('pb', 'personal', { opening: 80000 }),
    acct('sh', 'shared', { opening: 110000, sharedPortion: { amount: 100000, declaredAt: '2026-09-01' } }), acct('un', 'business', { opening: 20000, useConfirmedAt: null, useConfirmedValue: null })];
  const txns = [
    t({ type: 'income', amount: 120000, toAcct: 'opay', desc: 'Sales', time: '09:00' }),
    t({ type: 'income', amount: 5000, toAcct: '', purpose: 'pharmacy', desc: 'Account-less receipt' }),
    t({ type: 'income', amount: 8000, toAcct: 'sh', split: { method: 'amount', pharmacy: 8000, personal: 0 }, desc: 'Receipt into Shared', time: '08:00' }),
    t({ type: 'income', amount: 4000, toAcct: 'opay', fromAcct: 'pers_bank', desc: 'Receipt from an unresolved account' }),
    t({ type: 'income', amount: 2500, toAcct: 'opay', purpose: 'unclassified', desc: 'Receipt, purpose unknown' }),
    t({ type: 'income', amount: 9000, toAcct: 'pb', desc: 'Personal income' }),
    t({ amount: 85000, fromAcct: 'opay', desc: 'Stock', cat: 'Restocking' }),
    t({ amount: 15000, fromAcct: 'pb', desc: 'Groceries', cat: 'Food' }),
    t({ amount: 6000, fromAcct: 'pb', purpose: 'pharmacy', desc: 'Pharmacy item paid personally', cat: 'Restocking' }),
    t({ amount: 3000, fromAcct: 'un', purpose: 'pharmacy', desc: 'Paid from an unconfirmed account', cat: 'Utilities' }),
    t({ amount: 20000, fromAcct: 'sh', purpose: 'pharmacy', desc: 'Shared pharmacy payment', cat: 'Utilities', time: '10:00' }),
    t({ amount: 5000, fromAcct: 'opay', purpose: 'unclassified', desc: 'Payment, purpose unknown' }),
    t({ type: 'loan_repayment', amount: 45000, fromAcct: 'opay', alloc: { principal: 40000, interest: 5000, fees: 0 }, desc: 'Loan repayment' }),
    t({ type: 'loan_receipt', amount: 100000, toAcct: 'tb', desc: 'Loan received' }),
    t({ type: 'owner_withdrawal', amount: 100000, fromAcct: 'opay', toAcct: 'pb', desc: 'Withdrawal' }),
    t({ type: 'transfer', amount: 50000, fromAcct: 'pb', toAcct: 'opay', desc: 'Contribution' }),
    t({ type: 'capital_injection', amount: 20000, toAcct: 'tb', fundingKind: 'capital_injection', desc: 'Capital, source not confirmed' }),
    t({ type: 'income', amount: 7000, toAcct: 'opay', date: D.yest, desc: 'Yesterday sales' }),
    t({ amount: 2000, fromAcct: 'opay', date: D.yest, desc: 'Yesterday stock', cat: 'Restocking' }),
    t({ amount: 50000, fromAcct: 'opay', date: D.early, desc: 'Earlier stock', cat: 'Restocking' }),
  ];
  const setup = { id: 'ledgerSetup', mode: 'live', baselineDate: D.baseline, aliases: { ...ALIASES }, accounts, buckets: [{ id: 'bk1', label: 'Fictional rent', parentId: 'opay', amount: 30000 }],
    budgets: [{ cat: 'Food', amount: 20000 }, { cat: 'Restocking', amount: 200000 }] };
  return { setup, txns, D };
}
const measures = (seed, from, to) => F.financialMeasures(seed.setup.accounts, seed.txns, { aliases: seed.setup.aliases, baselineDate: seed.setup.baselineDate, from, to, today: seed.D.today, historyStart: seed.setup.baselineDate });

/* ── Server and browser ── */
let server, base, browser;
const site = Object.fromEntries(gen.buildTestSite());
const pageFor = { test: () => fs.readFileSync(path.join(ROOT, 'koboflow-test.html')), prod: () => fs.readFileSync(path.join(ROOT, 'koboflow.html')), site: () => SITE_DIR && fs.readFileSync(path.join(SITE_DIR, 'index.html')),
  test1: () => stage1.test1, prod1: () => stage1.prod1 };
const DBN = { test: 'KoboFlowDB-test', prod: 'KoboFlowDB', site: 'KoboFlowDB-test', test1: 'KoboFlowDB-test', prod1: 'KoboFlowDB' };
const BUILDS = ['test', 'prod'].concat(SITE_DIR ? ['site'] : []);
const LABEL = { test: 'TEST build', prod: 'production candidate', site: 'built TEST-site files' };
test.before(async () => {
  if (!pw) return;
  const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/html';
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (b, t) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-cache' }); res.end(b); };
    if (p.startsWith('/koboflow-test/')) { const rel = p.slice('/koboflow-test/'.length) || 'index.html'; if (site[rel]) return send(site[rel], type(rel)); }
    const k = p.replace(/\//g, ''), f = pageFor[k], b = f && f();
    if (b) return send(b, 'text/html');
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function openSeeded(key, seed, url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await context.addInitScript(n => { window.__rw = 0; const T = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (s, m) { if (m === 'readwrite' && this.name === n) window.__rw++; return T.apply(this, arguments); }; }, DBN[key]);
  const page = await context.newPage(); page.errors = [];
  page.on('pageerror', er => page.errors.push(er.message)); page.on('dialog', d => d.accept());
  const u = url || `${base}/${key}/`;
  await page.goto(u); await page.waitForSelector('body[data-kf-ready="1"]');
  if (seed) {
    await page.evaluate(([n, s]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction(['meta', 'transactions'], 'readwrite'); tx.objectStore('meta').put(s.setup); s.txns.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), [DBN[key], seed]);
    await page.goto(u); await page.waitForSelector('body[data-kf-ready="1"]');
  }
  return { context, page };
}
const snapAll = (page, n) => page.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result, names = [...d.objectStoreNames].sort(), o = {}; const t = d.transaction(names); let l = names.length; names.forEach(s => { const g = t.objectStore(s).getAll(); g.onsuccess = () => { o[s] = g.result; if (--l === 0) { d.close(); res(JSON.stringify(o)); } }; }); }; }), n);
const nav = async (page, s) => { await page.click(`.nav-btn[data-screen="${s}"]`); await page.waitForSelector(`#screen-${s}.active`); };
// Every [data-fig] value inside a container, by key (the first one of each key).
const figs = (page, sel) => page.$$eval(`${sel} [data-fig]`, els => { const o = {}; for (const e of els) { const k = e.getAttribute('data-fig'); if (!(k in o)) o[k] = Number(e.getAttribute('data-value')); } return o; });
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const money = s => { const m = /(-?)₦([\d,]+(?:\.\d+)?)/.exec(s); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) : NaN; };
async function openSheet(page, sel) {
  await page.click(sel); await page.waitForSelector('#explain-modal.open [data-explain-sheet]');
  const r = await page.evaluate(() => { const s = document.querySelector('#explain-modal [data-explain-sheet]'), fig = s.querySelector('[data-explain-figure]');
    return { key: s.getAttribute('data-explain-sheet'), figure: Number(fig.getAttribute('data-value')), total: Number(s.querySelector('[data-explain-total]').getAttribute('data-explain-total')),
      entries: [...s.querySelectorAll('[data-explain-entry]')].map(e => Number(e.getAttribute('data-contribution'))),
      opc: [...s.querySelectorAll('[data-opc]')].map(e => ({ next: e.nextElementSibling && e.nextElementSibling.matches('[data-opc-qualification]') ? e.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : null })) }; });
  await page.click('#explain-modal [data-close="explain-modal"]'); await page.waitForSelector('#explain-modal.open', { state: 'detached' }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('explain-modal').classList.contains('open'));
  return r;
}

for (const key of BUILDS) {
  test(`${LABEL[key]}: CF6 and CF7 — the Cash Flow operating section shows OP-R and OP-C named and reconciled, equal to cashFlowStatement; the OP-C qualification appears verbatim immediately below every displayed OP-C figure, and nowhere else`, { skip }, async () => {
    const seed = seedJ(), D = seed.D, { context, page } = await openSeeded(key, seed);
    await nav(page, 'cashflow');
    const want = F.cashFlowStatement(measures(seed, D.monthStart, D.monthEnd)), m = measures(seed, D.monthStart, D.monthEnd);
    const got = await figs(page, '#cf-s2');
    assert.equal(got.opResult, want.operatingResult); assert.equal(got.opCash, want.operatingCash); assert.equal(got.opDiff, want.difference.total);
    assert.equal(got.burnUnresolvedBusiness, m.figures.burnUnresolvedBusiness); assert.equal(got.burnUnresolvedShared, m.figures.burnUnresolvedShared);
    assert.equal(got.unresolvedIncomeConfirmedPharmacy, m.figures.unresolvedIncomeConfirmedPharmacy); assert.equal(got.held, m.confirmedPharmacyCash.heldUnresolvedInflows);
    for (const k of ['pharmacyReceipts', 'incomeCashReceived', 'incomeNotConfirmedCash', 'incomeOtherAccount', 'incomeNoAccount', 'b1', 'f1', 'f2', 'f3', 'f4', 'f2Counted', 'loanReceipts', 'principalRepaid', 'ownerWithdrawals', 'ownerContributions'])
      assert.equal(got[k], m.figures[k], k);
    // Hand check on this dataset: OP-R = 145,000 − 114,000 = 31,000 (with yesterday when it is in this month).
    assert.equal(K(got.opResult) - K(got.opCash), (K(got.incomeNotConfirmedCash) + K(got.incomeOtherAccount) + K(got.incomeNoAccount)) - (K(got.f3) + K(got.f4) + K(m.figures.f2NotCounted) + K(m.figures.f2PreOpening)));
    assert.equal(got.f2Counted, 20000, 'the Shared payment crosses the threshold: C2 = min(₦20,000, ₦100,000)');
    // CF6: no unnamed operating total remains.
    const cfText = await text(page, '#screen-cashflow');
    assert.ok(!/Operating Cash Flow/i.test(cfText), 'no element labelled "Operating Cash Flow"'); assert.equal(await page.$('#cf-op-total'), null);
    // CF7: every displayed OP-C figure is followed immediately by the qualification, verbatim.
    const opc = await page.$$eval('#screen-cashflow [data-opc]', els => els.map(e => ({ value: Number(e.getAttribute('data-value')), next: e.nextElementSibling && e.nextElementSibling.matches('[data-opc-qualification]') ? e.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : null, inGrid: !!e.closest('#cf-s2-grid'), inCard: !!e.closest('#cf-op-cash') })));
    assert.equal(opc.length, 2, 'OP-C is displayed in the summary grid and in the operating card');
    assert.ok(opc.some(x => x.inGrid) && opc.some(x => x.inCard));
    for (const x of opc) { assert.equal(x.next, OPC); assert.equal(x.value, want.operatingCash, 'the value is unchanged by the qualification'); }
    assert.equal(await page.$$eval('#screen-cashflow [data-opc-qualification]', e => e.length), opc.length, 'one qualification per OP-C display, none extra');
    for (const k of ['opResult', 'opDiff']) assert.equal(await page.$$eval(`#screen-cashflow [data-fig="${k}"]`, els => els.filter(e => e.nextElementSibling && e.nextElementSibling.matches('[data-opc-qualification]')).length), 0, k + ' does not carry it');
    // The OP-C explanation sheet, opened from both places: the qualification is directly under its figure; its entries sum to OP-C.
    for (const sel of ['#cf-s2-grid [data-explain="opCash"]', '#cf-op-cash [data-explain="opCash"]']) {
      const sh = await openSheet(page, sel);
      assert.equal(sh.key, 'opCash'); assert.deepEqual(sh.opc, [{ next: OPC }]); assert.equal(sh.figure, want.operatingCash);
      assert.equal(K(sh.total), K(want.operatingCash)); assert.equal(sh.entries.reduce((s, v) => s + K(v), 0), K(want.operatingCash), 'R10');
    }
    for (const k of ['opResult', 'opDiff']) {
      const sh = await openSheet(page, `#cf-s2 [data-explain="${k}"]`);
      assert.deepEqual(sh.opc, [], k + ' sheet has no OP-C qualification'); assert.equal(K(sh.total), K(sh.figure)); assert.equal(K(sh.figure), K(k === 'opResult' ? want.operatingResult : want.difference.total));
    }
    assert.deepEqual(page.errors, []); await context.close();
  });

  test(`${LABEL[key]}: cross-screen agreement R1–R12 on one dataset — Analytics, Cash Flow, budgets, Home, Timeline, Owner Impact, runway, burn, Director, Capital and explanation sheets show one set of figures; legitimate differences are labelled`, { skip }, async () => {
    const seed = seedJ(), D = seed.D, { context, page } = await openSeeded(key, seed);
    const s0 = await snapAll(page, DBN[key]), rw0 = await page.evaluate(() => window.__rw);
    const m = measures(seed, D.monthStart, D.today), f = m.figures;
    await nav(page, 'analytics'); const ana = await figs(page, '#ana-s2');
    await nav(page, 'cashflow'); const cf = await figs(page, '#cf-s2');
    await nav(page, 'ownerimpact'); const oi = await figs(page, '#oi-s2');
    await nav(page, 'capital'); const cap = await figs(page, '#cap-financing');
    // R1 pharmacy income: Analytics = Cash Flow = Σ Timeline daily = the measure, line by line.
    await nav(page, 'timeline');
    const days = await page.$$eval('.tl-day-net[data-day]', els => els.map(e => ({ day: e.getAttribute('data-day'), phIn: Number(e.getAttribute('data-ph-in')), phOut: Number(e.getAttribute('data-ph-out')), peIn: Number(e.getAttribute('data-pe-in')), peOut: Number(e.getAttribute('data-pe-out')) })));
    const inMonth = days.filter(d => d.day >= D.monthStart && d.day <= D.today);
    for (const k of ['pharmacyReceipts', 'incomeCashReceived', 'incomeNotConfirmedCash', 'incomeOtherAccount', 'incomeNoAccount']) { assert.equal(ana[k], f[k], 'Analytics ' + k); assert.equal(cf[k], f[k], 'Cash Flow ' + k); }
    assert.equal(K(f.incomeCashReceived) + K(f.incomeNotConfirmedCash) + K(f.incomeOtherAccount) + K(f.incomeNoAccount), K(f.pharmacyReceipts));
    assert.equal(inMonth.reduce((s, d) => s + K(d.phIn), 0), K(f.pharmacyReceipts), 'R1: Σ Timeline daily pharmacy income');
    assert.equal(inMonth.reduce((s, d) => s + K(d.phOut), 0), K(f.b1), 'Σ Timeline daily pharmacy spending = B1');
    // R2 pharmacy spending: Analytics = Σ budget pharmacy + un-budgeted pharmacy categories = B1, same funding lines everywhere.
    await nav(page, 'home');
    const budgets = await page.$$eval('#budget-list [data-budget]', els => els.map(e => ({ cat: e.getAttribute('data-budget'), ph: Number(e.getAttribute('data-pharmacy')), pe: Number(e.getAttribute('data-personal')) })));
    await nav(page, 'analytics');
    const cats = await page.$$eval('#ana-s2 [data-cat-row]', els => els.map(e => ({ cat: e.getAttribute('data-cat-row'), ph: Number(e.getAttribute('data-pharmacy')), pe: Number(e.getAttribute('data-personal')) })));
    const bset = new Set(budgets.map(b => b.cat));
    assert.equal(budgets.reduce((s, b) => s + K(b.ph), 0) + cats.filter(c => !bset.has(c.cat)).reduce((s, c) => s + K(c.ph), 0), K(f.b1), 'R2');
    for (const k of ['b1', 'f1', 'f2', 'f3', 'f4', 'f2Counted']) { assert.equal(ana[k], f[k], 'Analytics ' + k); assert.equal(cf[k], f[k], 'Cash Flow ' + k); }
    // R3 personal spending: Analytics = Σ personal budget + un-budgeted = Owner Impact personal activity = the measure.
    assert.equal(budgets.reduce((s, b) => s + K(b.pe), 0) + cats.filter(c => !bset.has(c.cat)).reduce((s, c) => s + K(c.pe), 0), K(f.personalExpenses), 'R3');
    assert.equal(ana.personalExpenses, f.personalExpenses); assert.equal(oi.personalExpenses, f.personalExpenses);
    // R4 owner movements: Owner Impact = Cash Flow owner lines = Autopilot input.
    assert.equal(oi.ownerWithdrawals, f.ownerWithdrawals); assert.equal(cf.ownerWithdrawals, f.ownerWithdrawals); assert.equal(oi.ownerContributions, f.ownerContributions); assert.equal(cf.ownerContributions, f.ownerContributions);
    await nav(page, 'home');
    assert.equal(money((await text(page, '#autopilot-body')).split('Owner W/D This Month')[1]), f.ownerWithdrawals, 'R4: Autopilot');
    // R5 financing: Cash Flow = Analytics = Capital (all financing in this dataset is this month).
    for (const k of ['loanReceipts', 'principalRepaid', 'externalFunding', 'capitalInjectionsSourceUnconfirmed', 'capitalOwnMoney']) { assert.equal(ana[k], f[k], 'Analytics ' + k); assert.equal(cap[k], f[k], 'Capital ' + k); }
    for (const k of ['loanReceipts', 'principalRepaid', 'externalFunding', 'capitalInjectionsSourceUnconfirmed']) assert.equal(cf[k], f[k], 'Cash Flow ' + k);
    assert.match(await text(page, '#cap-summary'), new RegExp('Capital Injected₦' + (f.capitalOwnMoney + f.externalFunding + f.capitalInjectionsSourceUnconfirmed).toLocaleString('en-NG')));
    // R6 burn: the runway's daily burn × days = the runway burn = the window explanation sum.
    const rd = await page.evaluate(() => ({ daily: Number(document.querySelector('[data-runway="daily"]').getAttribute('data-value')), available: Number(document.querySelector('[data-runway="available"]').getAttribute('data-value')),
      after: Number(document.querySelector('[data-runway="after-commitments"]').getAttribute('data-value')), days: document.getElementById('runway-days').textContent.trim() }));
    assert.equal(Math.round(rd.daily * m.runway.historyDays * 100), K(m.runway.burn), 'R6');
    const bs = await openSheet(page, '[data-runway="daily"]'); assert.equal(K(bs.total), K(m.runway.burn)); assert.equal(K(bs.figure), K(m.runway.burn));
    // R7 available cash: runway = Director Cash Now. R8 cash after known commitments: runway = Director "free after commitments".
    await nav(page, 'director');
    const dir = await page.$$eval('#director-body [data-dir-row]', rs => Object.fromEntries(rs.map(r => [r.getAttribute('data-dir-row'), r.querySelector('.autopilot-val').textContent.trim()])));
    assert.equal(money(dir.cash), rd.available, 'R7'); assert.equal(money(dir.after), rd.after, 'R8');
    assert.equal(rd.days, String(Math.round(rd.available / rd.daily)), 'runway days = available ÷ daily burn');
    // Director income (S-6): pharmacy income today, with all recorded income as the comparison.
    const mt = measures(seed, D.today, D.today);
    assert.equal(money(dir['today-income']), mt.figures.pharmacyReceipts); assert.equal(money(dir['today-all-income']), mt.figures.allRecordedIncome);
    assert.notEqual(mt.figures.pharmacyReceipts, mt.figures.allRecordedIncome, 'a legitimate, labelled difference');
    // R9 Home "yesterday" = the Timeline row for yesterday.
    await nav(page, 'home');
    const yd = await page.evaluate(() => ['yd-in', 'yd-out', 'yd-net'].map(id => Number(document.getElementById(id).getAttribute('data-value'))));
    const ty = days.find(d => d.day === D.yest) || { phIn: 0, phOut: 0 };
    assert.deepEqual(yd, [ty.phIn, ty.phOut, (K(ty.phIn) - K(ty.phOut)) / 100], 'R9');
    // R10 explanations for a spread of figures; R11 OP-R; R12 OP-C and the burn.
    await nav(page, 'analytics');
    for (const k of ['pharmacyReceipts', 'incomeCashReceived', 'b1', 'f2', 'f3', 'f4', 'burn', 'unresolvedSpending', 'personalIncome', 'loanReceipts']) {
      const sh = await openSheet(page, `#ana-s2 [data-s2-row="${k}"]`); assert.equal(K(sh.total), K(f[k]), 'R10 ' + k); assert.equal(sh.entries.reduce((s, v) => s + K(v), 0), K(f[k]));
    }
    assert.equal(K(cf.opResult), K(ana.pharmacyReceipts) - K(ana.b1), 'R11');
    assert.equal(K(cf.opCash), K(ana.incomeCashReceived) - K(ana.f1) - K(ana.f2Counted), 'R12');
    assert.equal(K(ana.f1) + K(ana.f2Counted) + K(cf.burnUnresolvedBusiness) + K(cf.burnUnresolvedShared), K(ana.burn), 'R12: OP-C outflow + separate lines = the period burn');
    // Labels: only line (i) is called cash received; recorded income is never called sales; the owner wording is used.
    const all = await text(page, '#ana-s2');
    assert.ok(all.includes('Recorded income — not sales. Pharmacy sales are recorded in PBSRx.'));
    assert.equal((all.match(/Cash received into confirmed pharmacy accounts — not sales\./g) || []).length, 1, 'only line (i) carries "Cash received"');
    for (const w of ['Implicit owner contribution — not a formal capital contribution.', 'Counted in full as a precaution — not pharmacy-owned money.', 'Amount not counted against the confirmed pharmacy portion.'])
      assert.ok(all.includes(w) || (await text(page, '#screen-cashflow')).includes(w), w);
    // Read-only: nothing was written while every screen rendered and every sheet opened.
    assert.equal(await page.evaluate(() => window.__rw) - rw0, 0, 'no read-write transaction');
    assert.equal(await snapAll(page, DBN[key]), s0, 'every store unchanged');
    assert.equal(await page.evaluate(() => new Dexie().newFinancialFormat), false, 'switch OFF');
    assert.match(await page.evaluate(() => document.getElementById('db-engine').textContent), /IndexedDB v4\b/, 'DB_VERSION 4');
    assert.deepEqual(page.errors, []); await context.close();
  });

  // Acceptance correction (owner-authorised): the OP-C qualification is checked by its RENDERED position, not by the
  // order of the page's code. For every displayed OP-C figure (summary tile, operating card, explanation sheet), at
  // phone widths, the sentence's box starts at or below the figure's bottom edge (never beside it), close under it,
  // and overlaps it horizontally.
  test(`${LABEL[key]}: OP-C qualification is visually directly below every displayed OP-C figure (summary tile, operating card, explanation sheet), at 360 and 390 px wide`, { skip }, async () => {
    for (const width of [360, 390]) {
      const seed = seedJ(), { context, page } = await openSeeded(key, seed);
      await page.setViewportSize({ width, height: 844 });
      await nav(page, 'cashflow');
      const geo = sel => page.$$eval(sel, els => els.map(f => { const q = f.nextElementSibling, a = f.getBoundingClientRect(), b = q.getBoundingClientRect();
        return { where: f.closest('#cf-s2-grid') ? 'summary tile' : f.closest('#cf-op-cash') ? 'operating card' : 'explanation sheet', isQual: q.matches('[data-opc-qualification]'), text: q.textContent.replace(/\s+/g, ' ').trim(),
          figBottom: a.bottom, figLeft: a.left, figRight: a.right, qTop: b.top, qLeft: b.left, qRight: b.right, qVisible: b.width > 0 && b.height > 0 && getComputedStyle(q).visibility !== 'hidden' && getComputedStyle(q).display !== 'none' }; }));
      const placed = await geo('#screen-cashflow [data-opc]');
      await page.click('#cf-op-cash [data-explain="opCash"]'); await page.waitForSelector('#explain-modal.open [data-explain-sheet]'); await page.waitForTimeout(150);
      const sheet = await geo('#explain-modal [data-opc]');
      const all = placed.concat(sheet);
      assert.deepEqual(all.map(x => x.where).sort(), ['explanation sheet', 'operating card', 'summary tile'], `${width}px: the three OP-C displays`);
      for (const x of all) {
        assert.ok(x.isQual && x.text === OPC, `${width}px ${x.where}: the sentence follows the figure, verbatim`);
        assert.ok(x.qVisible, `${width}px ${x.where}: the sentence is visible`);
        assert.ok(x.qTop >= x.figBottom - 1, `${width}px ${x.where}: the sentence starts below the figure (figure bottom ${x.figBottom}, sentence top ${x.qTop}), not beside it`);
        assert.ok(x.qTop - x.figBottom <= 24, `${width}px ${x.where}: directly below (gap ${x.qTop - x.figBottom}px)`);
        assert.ok(x.qLeft < x.figRight && x.qRight > x.figLeft, `${width}px ${x.where}: under the figure (horizontal overlap)`);
      }
      assert.deepEqual(page.errors, []); await context.close();
    }
  });

  // Acceptance correction: the Director's unresolved warnings are amber (their rendered colour equals var(--amber)).
  test(`${LABEL[key]}: the Director's unresolved spending and income warnings render in amber`, { skip }, async () => {
    const seed = seedJ(), { context, page } = await openSeeded(key, seed);
    await nav(page, 'director');
    const r = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--amber)'; document.body.appendChild(probe); const amber = getComputedStyle(probe).color; probe.remove();
      const muted = getComputedStyle(document.querySelector('#director-body .muted-note:not([data-dir-quality^="s2_"])')).color;
      return { amber, muted, lines: [...document.querySelectorAll('[data-dir-quality^="s2_"]')].map(e => ({ key: e.getAttribute('data-dir-quality'), color: getComputedStyle(e).color, cursor: getComputedStyle(e).cursor, styleAttrs: (e.outerHTML.match(/\sstyle=/g) || []).length })) }; });
    assert.ok(r.lines.length >= 2, 'the unresolved spending and income lines are shown');
    assert.ok(r.lines.some(l => l.key === 's2_unresolved_spending') && r.lines.some(l => l.key === 's2_unresolved_income'));
    assert.notEqual(r.amber, r.muted, 'amber differs from the muted grey');
    for (const l of r.lines) { assert.equal(l.color, r.amber, l.key + ' is amber'); assert.equal(l.cursor, 'pointer', l.key + ' still opens its explanation'); assert.equal(l.styleAttrs, 1, l.key + ': one style attribute'); }
    // No element on any Stage 2 screen carries two style attributes.
    for (const s of ['home', 'analytics', 'cashflow', 'ownerimpact', 'capital', 'director', 'timeline']) {
      await nav(page, s);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.screen.active *')].filter(e => (e.outerHTML.slice(0, e.outerHTML.indexOf('>') + 1).match(/\sstyle=/g) || []).length > 1).length), 0, s + ': no element with two style attributes');
    }
    assert.deepEqual(page.errors, []); await context.close();
  });

  // Acceptance correction: the Briefing and Capital content Stage 2 does not change is preserved. Every Briefing row
  // except "Owner W/D This Month" and "Financial Health", every Briefing note and every warning other than the two
  // reworded ones, and every Capital tile except "Capital Injected", equal the accepted Stage 1 build on the same data.
  if (key !== 'site') test(`${LABEL[key]}: unchanged Briefing rows, notes and warnings and unchanged Capital tiles equal the accepted Stage 1 build (${STAGE1.slice(0, 7)})`, { skip }, async (t) => {
    if (!stage1[key + '1']) { t.skip('Stage 1 commit not in this checkout'); return; }
    const seed = seedJ();
    const read = async k => { const { context, page } = await openSeeded(k, seed);
      const o = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#autopilot-body .autopilot-row')].map(r => [r.querySelector('.autopilot-lbl').textContent.trim(), r.querySelector('.autopilot-val').textContent.trim(), r.querySelector('.autopilot-val').getAttribute('style')]),
        notes: [...document.querySelectorAll('#autopilot-body .muted-note, #autopilot-body .autopilot-ok')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
        warnings: [...document.querySelectorAll('#autopilot-body .autopilot-warning')].flatMap(w => w.innerHTML.split(/<br\s*\/?>/i).map(x => x.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').replace(/^⚠\s*/, '').trim())),
        reminders: (document.getElementById('autopilot-body').innerHTML.split('<div class="autopilot-row"')[0] || '').replace(/\s+/g, ' ') }));
      await nav(page, 'capital'); o.tiles = await page.$$eval('#cap-summary .stat-card', els => els.map(e => [e.querySelector('.stat-label').textContent.trim(), e.querySelector('.stat-val').textContent.trim()]));
      assert.deepEqual(page.errors, []); await context.close(); return o; };
    const now = await read(key), before = await read(key + '1');
    const CHANGED_ROWS = ['Owner W/D This Month', 'Financial Health (rule-of-thumb)'], REWORDED = ['runway is critical', 'Owner withdrawals exceed 30% of'];
    assert.deepEqual(now.rows.map(r => r[0]), before.rows.map(r => r[0]), 'the same Briefing rows, in the same order');
    const keepRows = rs => rs.filter(r => !CHANGED_ROWS.includes(r[0]));
    assert.equal(keepRows(now.rows).length, now.rows.length - 2);
    assert.deepEqual(keepRows(now.rows), keepRows(before.rows), 'every unchanged Briefing row: same label, value and colour');
    assert.deepEqual(now.notes, before.notes, 'the Briefing notes');
    const keepW = ws => ws.filter(w => !REWORDED.some(p => w.includes(p)));
    assert.deepEqual(keepW(now.warnings), keepW(before.warnings), 'every warning other than the two reworded ones');
    assert.equal(now.reminders, before.reminders, 'the reminders above the Briefing');
    assert.deepEqual(now.tiles.map(x => x[0]), ['Loans Outstanding', 'Capital Injected', 'Loan Repayments (30d)', 'Active Loans']);
    assert.deepEqual(now.tiles.filter(x => x[0] !== 'Capital Injected'), before.tiles.filter(x => x[0] !== 'Capital Injected'), 'every unchanged Capital tile');
  });

  test(`${LABEL[key]}: runway display rule — available ₦0 → 0 days, "No confirmed available pharmacy cash."; available −₦5,000 → 0 days, the negative message, and −₦5,000 still shown; otherwise the normal days`, { skip }, async () => {
    for (const [spent, days, msg, avail] of [[50000, '0', 'No confirmed available pharmacy cash.', 0], [55000, '0', 'Available pharmacy cash is negative — no positive runway.', -5000], [25000, null, null, 25000]]) {
      const D = dates();
      const seed = { D, setup: { id: 'ledgerSetup', mode: 'live', baselineDate: D.baseline, aliases: { ...ALIASES }, accounts: [acct('opay', 'business', { kind: 'wallet', opening: 50000, primary: true })], buckets: [] },
        txns: [{ id: 40001, type: 'expense', amount: spent, desc: 'Fictional stock', cat: 'Restocking', date: D.early, time: '09:00', fromAcct: 'opay', toAcct: '', state: 'Manual' }] };
      const { context, page } = await openSeeded(key, seed);
      const m = measures(seed, D.monthStart, D.today);
      assert.equal(await text(page, '#runway-days'), days === null ? String(Math.round(25000 / m.runway.dailyBurn)) : days);
      if (msg) assert.equal(await text(page, '[data-runway-msg]'), msg); else assert.equal(await page.$('[data-runway-msg]'), null);
      assert.equal(await page.evaluate(() => Number(document.querySelector('[data-runway="available"]').getAttribute('data-value'))), avail);
      assert.ok((await text(page, '[data-runway="available"]')).endsWith((avail < 0 ? '-' : '') + '₦' + Math.abs(avail).toLocaleString('en-NG')), 'the signed available figure is shown unchanged');
      assert.deepEqual(page.errors, []); await context.close();
    }
  });
}

test('static: the OP-C qualification occurs exactly once in each source file (one constant); the generated TEST file is byte-identical to the build output', () => {
  for (const f of ['koboflow.html', 'koboflow-test.html']) assert.equal(fs.readFileSync(path.join(ROOT, f), 'utf8').split(OPC).length - 1, 1, f);
  assert.equal(fs.readFileSync(path.join(ROOT, 'koboflow-test.html'), 'utf8'), gen.build(fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8')));
  // No Stage 2 report path calls classifyTxn or the old report helpers (plan 5 "also").
  const html = fs.readFileSync(path.join(ROOT, 'koboflow.html'), 'utf8'), s = html.indexOf('/* ═══════════════ STAGE 2 — ONE MEASURES RESULT'), e = html.indexOf('function renderAll(){');
  const block = html.slice(s, e);
  assert.ok(s > 0 && e > s);
  for (const fn of ['classifyTxn', 'cashFlowSummary', 'spendingRunway', 'budgetProgress']) assert.ok(!block.includes(fn + '('), 'Stage 2 block never calls ' + fn);
  assert.match(html, /var NEW_FINANCIAL_FORMAT=false;|NEW_FINANCIAL_FORMAT\s*=\s*false/);
});

test('offline: the TEST site, once loaded, renders every Stage 2 screen with the network blocked', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  const u = base + '/koboflow-test/';
  await page.goto(u); await page.waitForSelector('body[data-kf-ready="1"]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]'); }
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
  const seed = seedJ();
  await page.evaluate(([n, s]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction(['meta', 'transactions'], 'readwrite'); tx.objectStore('meta').put(s.setup); s.txns.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), ['KoboFlowDB-test', seed]);
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  for (const s of ['analytics', 'cashflow', 'ownerimpact', 'capital', 'director', 'timeline', 'home']) { await nav(page, s); }
  assert.equal(await page.$$eval('#cf-s2 [data-opc]', e => e.length), 2);
  assert.ok((await page.$$eval('#ana-s2 [data-fig]', e => e.length)) > 20);
  assert.notEqual(await text(page, '#runway-days'), '--');
  await context.setOffline(false);
  assert.deepEqual(errors, []); await context.close();
});
