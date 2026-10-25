// Loan principal and settlement integrity: extra principal reduces what is owed exactly once, a
// schedule amendment never subtracts it again, the original instalments stay until the lender
// confirms new ones (flagged for review), paying off the principal keeps known interest and fees,
// and only a confirmed, already-paid settlement closes a loan. Engine checks plus screen checks on the
// generated TEST site and the production candidate. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F = require('./load-engine')();
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

// The engine of the release before this change, read from git (same loader as tests/load-engine.js).
const PREV_COMMIT = '740ded125751e6f92e01b23cfb7b4d13fdb0334d';
let PREV = null;
try {
  const html = execFileSync('git', ['-C', ROOT, 'show', PREV_COMMIT + ':koboflow.html'], { maxBuffer: 1 << 26 }).toString();
  const m = /<script id="kobo-finance-engine">([\s\S]*?)<\/script>/.exec(html);
  const sb = { module: { exports: {} }, console };
  vm.createContext(sb); vm.runInContext(m[1], sb);
  const plain = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  PREV = {};
  for (const [k, v] of Object.entries(sb.module.exports)) PREV[k] = typeof v === 'function' ? (...a) => plain(v(...a)) : v;
} catch (e) { /* not available */ }

/* ───────────── Engine ───────────── */
const TODAY = '2026-10-20';
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
// The audit's fictional loan: 3 instalments of 34,500 (30,000 principal + 4,500 interest).
const ROWS = [['2026-11-15', 30000, 4500, 0], ['2026-12-15', 30000, 4500, 0], ['2027-01-15', 30000, 4500, 0]];
const TERMS = { nature: 'debt', structure: 'manual', principal: 90000 };
const inst = (rows = ROWS, o = {}) => rows.map(([d, p, i, f], k) => Object.assign({ id: `L_v1_${k + 1}`, agreementId: 'L', seq: k + 1, dueDate: d, principal: p, interest: i, fees: f, total: p + i + f, version: 1 }, o));
const extra = (txnId, amount, o = {}) => Object.assign({ id: `al_${txnId}_0`, agreementId: 'L', txnId, instalmentId: null, kind: 'extra_principal', principal: amount, interest: 0, fees: 0, unsplit: 0, date: '2026-10-18', reversed: false }, o);
const rowsOf = (txnId, plan) => plan.rows.map((r, k) => Object.assign({ id: `al_${txnId}_${k}`, agreementId: 'L', txnId, reversed: false }, r));
// The lender's revised schedule after an amendment, replacing the old unpaid rows.
function amend(old, rows, o = {}) {
  return old.map(i => Object.assign({}, i, { supersededBy: 'amd1' })).concat(rows.map(([d, p, i, f], k) => Object.assign({
    id: `L_v2_${k + 1}`, agreementId: 'L', seq: 10 + k, dueDate: d, principal: p, interest: i, fees: f, total: p + i + f, version: 2, amendmentId: 'amd1', createdAt: '2026-10-19T09:00:00.000Z' }, o)));
}
const bal = (I, A, T = []) => F.agreementBalances(TERMS, I, A, T, TODAY);
const codes = b => b.review.map(r => r.code);
const remaining = b => b.states.map(s => s.remaining);
// The loan obligations the forecast screens use (same rule as loanEntries in the app).
const forecastTotal = b => sum(b.states.filter(s => s.remaining > 0), s => s.remaining);

test('extra principal reduces the liability once; original instalments stay; the forecast equals the liability; flagged for review', () => {
  const b = bal(inst(), [extra(9, 30000)]);
  assert.equal(b.outstanding.principal, 60000);
  assert.equal(b.outstanding.interest, 13500);
  assert.equal(b.outstanding.total, 73500);
  assert.deepEqual(remaining(b), [34500, 34500, 4500], 'next instalments as agreed; the last one carries the extra');
  assert.deepEqual(b.states.map(s => s.total), [34500, 34500, 34500], 'agreed instalments unchanged');
  assert.equal(forecastTotal(b), b.outstanding.total, 'no instalment is still due for money already repaid');
  assert.equal(b.paid.principal, 30000);
  assert.equal(b.scheduled.principal, 90000);
  assert.equal(b.extraUnconfirmed, 30000);
  assert.deepEqual(codes(b), ['extra_unconfirmed']);
  assert.equal(b.settled, false);
  assert.equal(b.principalSettled, false);
});

test('amendment that reflects the extra principal does not subtract it again (audit D3)', () => {
  const lender = [['2026-11-15', 20000, 4500, 0], ['2026-12-15', 20000, 4500, 0], ['2027-01-15', 20000, 4500, 0]];
  const b = bal(amend(inst(), lender, { extraAbsorbed: ['al_9_0'] }), [extra(9, 30000)]);
  assert.equal(b.outstanding.principal, 60000, 'not 30,000');
  assert.equal(b.outstanding.total, 73500, 'not 43,500');
  assert.equal(b.scheduled.principal, 90000, 'whole loan principal: new rows plus the extra already paid');
  assert.equal(b.paid.principal, 30000);
  assert.equal(b.extraAbsorbed, 30000);
  assert.equal(b.extraUnconfirmed, 0);
  assert.deepEqual(codes(b), [], 'lender confirmed: no longer needs review');
  assert.equal(forecastTotal(b), 73500);
  // The same amendment saved as "does not reflect it" keeps counting the extra once, against the new rows.
  const same = bal(amend(inst(), ROWS, { extraAbsorbed: [] }), [extra(9, 30000)]);
  assert.equal(same.outstanding.total, 73500);
  assert.deepEqual(remaining(same), [34500, 34500, 4500]);
});

test('several extra principal payments, before and after an amendment, each count once', () => {
  let b = bal(inst(), [extra(9, 10000), extra(10, 25000)]);
  assert.equal(b.outstanding.principal, 55000);
  assert.equal(b.outstanding.total, 68500);
  assert.deepEqual(remaining(b), [34500, 29500, 4500], 'filled from the last instalment backwards');
  assert.equal(b.paid.principal, 35000);
  // Amendment reflects the first two; a third extra after it applies to the new rows only.
  const lender = [['2026-11-15', 27500, 4500, 0], ['2026-12-15', 27500, 4500, 0]];
  const I = amend(inst(), lender, { extraAbsorbed: ['al_9_0', 'al_10_0'] });
  b = bal(I, [extra(9, 10000), extra(10, 25000), extra(11, 5000)]);
  assert.equal(b.outstanding.principal, 50000);
  assert.equal(b.outstanding.total, 59000);
  assert.equal(b.paid.principal, 40000);
  assert.equal(b.scheduled.principal, 90000);
  assert.deepEqual(codes(b), ['extra_unconfirmed']);
  assert.equal(b.extraUnconfirmed, 5000);
});

test('full principal payoff with scheduled interest left: principal settled, interest kept, loan not settled', () => {
  const b = bal(inst(), [extra(9, 90000)]);
  assert.equal(b.outstanding.principal, 0);
  assert.equal(b.principalSettled, true);
  assert.equal(b.outstanding.interest, 13500, 'known interest is not dropped');
  assert.equal(b.outstanding.total, 13500);
  assert.equal(b.settled, false);
  assert.deepEqual(remaining(b), [4500, 4500, 4500]);
  assert.ok(codes(b).includes('charges_after_principal'));
  // Lender confirms 3,000 closes it: settlement applies it to interest, waives the rest, settles.
  const st = F.instalmentStates(inst(), [extra(9, 90000)], TODAY);
  const plan = F.settlementPlan(st, 3000);
  assert.equal(plan.ok, true);
  assert.equal(sum(plan.rows, r => r.principal), 0, 'no principal paid twice');
  const I = inst().map(i => plan.waive.some(w => w.instalmentId === i.id) ? Object.assign({}, i, { waived: true }) : i);
  const end = bal(I, [extra(9, 90000)].concat(rowsOf(12, plan)));
  assert.equal(end.settled, true);
  assert.equal(end.waived, 10500);
  assert.deepEqual(codes(end), []);
});

test('full principal payoff with no known charges left settles the loan', () => {
  const free = ROWS.map(([d, p]) => [d, p, 0, 0]);
  const b = bal(inst(free), [extra(9, 90000)]);
  assert.equal(b.outstanding.total, 0);
  assert.equal(b.principalSettled, true);
  assert.equal(b.settled, true);
  assert.deepEqual(codes(b), []);
  assert.equal(forecastTotal(b), 0, 'nothing left in any forecast');
});

test('normal instalments and partial payments after extra principal never take principal twice', () => {
  let A = [extra(9, 30000)];
  const pay = (id, amt, opts) => { const p = F.allocatePayment(F.instalmentStates(inst(), A, TODAY), amt, opts || {}); assert.equal(p.ok, true, p.error); A = A.concat(rowsOf(id, p)); return p; };
  pay(1, 34500);
  let p = pay(2, 10000);
  assert.equal(p.split.interest, 4500); assert.equal(p.split.principal, 5500);
  let b = bal(inst(), A);
  assert.equal(b.states[1].status, 'partial');
  assert.equal(b.outstanding.total, 73500 - 34500 - 10000);
  pay(3, 24500);
  b = bal(inst(), A);
  assert.equal(b.outstanding.principal, 0);
  assert.equal(b.outstanding.total, 4500);
  const over = F.allocatePayment(F.instalmentStates(inst(), A, TODAY), 34500, {});
  assert.equal(over.ok, false, 'the original 34,500 would overpay: the extra already covered its principal');
  p = pay(4, 4500);
  assert.equal(p.split.principal, 0); assert.equal(p.split.interest, 4500);
  b = bal(inst(), A);
  assert.equal(b.settled, true);
  assert.equal(b.paid.principal, 90000);
  assert.equal(b.paid.interest, 13500);
});

test('recalculating, reopening and reversing never duplicate a payment', () => {
  const A = [extra(9, 30000), extra(10, 5000)];
  const one = bal(inst(), A), again = bal(inst(), A.slice().reverse());
  assert.deepEqual(again.outstanding, one.outstanding, 'order of stored records does not matter');
  assert.deepEqual(remaining(again), remaining(one));
  assert.deepEqual(bal(inst(), A), one, 'recomputing gives the same figures');
  // Reversing an extra payment restores the instalments; reversing its replacement nothing more.
  const rev = bal(inst(), [extra(9, 30000, { reversed: true }), extra(10, 5000)]);
  assert.equal(rev.outstanding.total, 103500 - 5000);
  assert.deepEqual(remaining(rev), [34500, 34500, 29500]);
  // An absorbed extra later reversed: figures follow the lender's schedule, flagged for review.
  const lender = [['2026-11-15', 20000, 4500, 0], ['2026-12-15', 20000, 4500, 0], ['2027-01-15', 20000, 4500, 0]];
  const r2 = bal(amend(inst(), lender, { extraAbsorbed: ['al_9_0'] }), [extra(9, 30000, { reversed: true })]);
  assert.equal(r2.outstanding.total, 73500);
  assert.ok(codes(r2).includes('absorbed_reversed'));
});

test('failed or cancelled settlement changes nothing; a reversed settlement reopens the loan', () => {
  const A = [extra(9, 30000)];
  const st = F.instalmentStates(inst(), A, TODAY);
  assert.equal(F.settlementPlan(st, 0).ok, false);
  assert.deepEqual(bal(inst(), A), bal(inst(), A), 'a plan alone is not a payment');
  const plan = F.settlementPlan(st, 65000);
  assert.equal(sum(plan.rows, r => r.principal), 60000, 'only the principal still owed');
  assert.equal(plan.waived, 8500);
  const I = inst().map(i => plan.waive.some(w => w.instalmentId === i.id) ? Object.assign({}, i, { waived: true }) : i);
  const settledB = bal(I, A.concat(rowsOf(12, plan)));
  assert.equal(settledB.settled, true);
  // Reversal: allocations reversed and waivers lifted, as the app does.
  const back = bal(inst(), A.concat(rowsOf(12, plan).map(r => Object.assign({}, r, { reversed: true }))));
  assert.equal(back.settled, false);
  assert.equal(back.outstanding.total, 73500);
});

test('older records: amendments saved before this change are not double-subtracted and are flagged', () => {
  const lender = [['2026-11-15', 20000, 4500, 0], ['2026-12-15', 20000, 4500, 0], ['2027-01-15', 20000, 4500, 0]];
  const I = amend(inst(), lender); // no extraAbsorbed field: an older amendment
  const txns = [{ id: 9, type: 'loan_repayment', amount: 30000, createdAt: '2026-10-18T10:00:00.000Z' }];
  const b = bal(I, [extra(9, 30000)], txns);
  assert.equal(b.outstanding.total, 73500);
  assert.equal(b.outstanding.principal, 60000);
  assert.deepEqual(codes(b), ['legacy_amendment']);
  // An extra payment made after that older amendment still counts against the new rows.
  const later = bal(I, [extra(9, 30000), extra(13, 4000)], txns.concat([{ id: 13, type: 'loan_repayment', amount: 4000, createdAt: '2026-10-19T12:00:00.000Z' }]));
  assert.equal(later.outstanding.total, 69500);
  assert.deepEqual(codes(later), ['extra_unconfirmed', 'legacy_amendment']);
  // Without transactions the payment date is compared with the amendment date.
  assert.equal(bal(I, [extra(9, 30000)]).outstanding.total, 73500);
});

test('older records: without extra principal or amendments, every figure matches the previous release', { skip: !PREV && 'previous release not available from git' }, () => {
  const E = { nature: 'debt', structure: 'equal_instalment', principal: 150000, cashReceived: 150000, instalmentAmount: 55455, count: 4, frequency: 'monthly', firstDueDate: '2026-11-15', method: 'lender' };
  const I = F.buildSchedule(E).instalments.map(r => Object.assign({ id: `a_v1_${r.seq}`, agreementId: 'a' }, r));
  const keep = ['states', 'scheduled', 'paid', 'outstanding', 'extraPrincipal', 'waived', 'repaidToDate', 'overdue', 'next', 'settled'];
  const pick = (b) => { const o = {}; keep.forEach(k => { o[k] = b[k]; }); o.states = b.states.map(s => { const c = Object.assign({}, s); delete c.extraApplied; return c; }); if (o.next) { o.next = Object.assign({}, o.next); delete o.next.extraApplied; } return o; };
  let cases = 0;
  for (const amt of [1000, 30000, 55455, 70000, 110910, 221820]) for (const mode of ['schedule', 'provisional']) for (const day of ['2026-10-15', '2026-12-20', '2027-04-01']) {
    const p = F.allocatePayment(F.instalmentStates(I, [], day), amt, { mode });
    const A = p.ok ? p.rows.map((r, k) => Object.assign({ id: `al_1_${k}`, agreementId: 'a', txnId: 1, reversed: false }, r)) : [];
    const T = [{ id: 1, type: 'loan_repayment', amount: amt }];
    assert.deepEqual(pick(F.agreementBalances(E, I, A, T, day)), pick(PREV.agreementBalances(E, I, A, T, day)), `${amt} ${mode} ${day}`);
    cases++;
  }
  // With extra principal (no amendment) the liability is unchanged; only the instalments now show it.
  for (const x of [5000, 37500, 100000, 150000]) {
    const A = [{ id: 'al_2_0', agreementId: 'a', txnId: 2, instalmentId: null, kind: 'extra_principal', principal: x, interest: 0, fees: 0, unsplit: 0, reversed: false }];
    const now = F.agreementBalances(E, I, A, [], '2026-10-15'), was = PREV.agreementBalances(E, I, A, [], '2026-10-15');
    assert.equal(now.outstanding.total, was.outstanding.total, `total, extra ${x}`);
    assert.equal(now.outstanding.principal, was.outstanding.principal, `principal, extra ${x}`);
    assert.equal(now.paid.principal, was.paid.principal);
    assert.equal(forecastTotal(now), now.outstanding.total, 'forecast now matches the liability');
    assert.ok(forecastTotal(was) > was.outstanding.total, 'the previous release still forecast repaid money');
    cases++;
  }
  assert.equal(cases, 40);
});

/* ───────────── Screens: both builds ───────────── */
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
  page.errors = []; page.dialogs = []; page.answers = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', async d => { page.dialogs.push(d.message()); const a = page.answers.length ? page.answers.shift() : true; if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : undefined); });
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const text = (page, sel) => page.textContent(sel);
const idle = page => page.waitForFunction(() => !window.__kfSaving);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const plusDays = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
const money = s => Number(String(s).replace(/[^0-9-]/g, ''));
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const stored = (context, n, store) => probe(context, ([n, s]) => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), [n, store]);
const acctBal = (page, label) => page.$$eval('.acct-card', (cards, l) => {
  const c = cards.find(x => x.querySelector('.acct-name').textContent.trim().endsWith(l));
  return c ? Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, '')) : null;
}, label);

// Live setup: Opay wallet 100,000 and bank 500,000 available; no earmarks; every alias mapped to Opay.
async function liveSetup(page) {
  await page.click('#settings-nav-btn'); await page.click('#setup-open-btn'); await page.waitForSelector('#setup-modal.open');
  await page.fill('#setup-baseline', daysAgo(60));
  const row = i => page.locator(`#setup-accounts [data-acct-row="${i}"]`);
  await row(0).locator('[data-f=opening]').fill('100000');
  await page.click('#setup-add-acct');
  await row(1).locator('[data-f=label]').fill('Fictional Bank'); await row(1).locator('[data-f=kind]').selectOption('bank'); await row(1).locator('[data-f=opening]').fill('500000');
  // Stage 1 (item C): "Used For" no longer defaults to Business; none of this file's scenarios
  // are about ownership, so every account is chosen and confirmed explicitly.
  await row(0).locator('[data-f=use]').selectOption('business'); await row(1).locator('[data-f=use]').selectOption('business');
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
// Fictional loan: 150,000 into Opay; 4 monthly instalments of 55,455 (37,500 principal + 17,955 interest), first in 20 days.
async function createLoan(page) {
  await nav(page, 'loans');
  await page.click('#new-agr-btn');
  await page.waitForFunction(() => document.getElementById('agr-modal').classList.contains('open') && document.querySelector('#agr-modal .modal-box').getAnimations().every(a => a.playState === 'finished'));
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, 20)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched');
  await page.click('#agr-save-btn');
  await page.waitForSelector('#screen-agreement.active');
}
const openLoan = async page => { await nav(page, 'loans'); await page.click('#screen-loans [data-open-agr]'); await page.waitForSelector('#screen-agreement.active'); };
const kv = async (page, label) => page.$$eval('#agr-detail .kv-row', (rows, l) => { const r = rows.find(x => x.querySelector('.k').textContent.trim() === l); return r ? r.querySelector('.v').textContent.trim() : null; }, label);
// Every screen's view of the loan: loan screen, Loans summary, Net Worth, Calendar, Director.
async function figures(page) {
  await openLoan(page);
  const f = { outstanding: money(await kv(page, 'Outstanding')), principal: await kv(page, 'of which principal'), charges: money(await kv(page, 'of which scheduled interest & fees')),
    review: await page.$$eval('#agr-review [data-review]', els => els.map(e => e.getAttribute('data-review'))) };
  await nav(page, 'loans');
  const stat = l => page.$$eval('#loan-summary .stat-card', (c, l) => { const x = c.find(e => e.querySelector('.stat-label').textContent.trim() === l); return x.querySelector('.stat-val').textContent; }, l);
  // H5: "Total Owed" is now the current liability (principal + interest/fees already due, never
  // future interest) and "Scheduled Still to Pay" stays the full remaining schedule — the two can
  // differ whenever the next instalment is not yet due (see the figures() callers below).
  f.totalOwed = money(await stat('Total Owed (current liability)')); f.scheduledLeft = money(await stat('Scheduled Still to Pay (full payoff)'));
  await nav(page, 'networth');
  f.netWorthLiab = await page.$$eval('#nw-liabs-list [data-open-agr] .nw-row-val', els => els.reduce((t, e) => t + Number(e.textContent.replace(/[^0-9]/g, '')), 0)); // a settled loan has no row
  await nav(page, 'calendar');
  f.cal60 = money(await page.$eval('#cal-summary .stat-card .stat-val', e => e.textContent));
  await nav(page, 'director');
  f.dirFree = money(await text(page, '#director-body [data-dir-row="free"] .autopilot-val'));
  f.dirUncovered = money(await text(page, '#director-body [data-dir-row="uncovered"] .autopilot-val'));
  f.dirAfter = money(await text(page, '#director-body [data-dir-row="after"] .autopilot-val'));
  return f;
}
async function payExtra(page, amount) {
  await openLoan(page);
  await page.click('[data-act="pay"]');
  await page.selectOption('#pay-mode', 'extra_principal');
  await page.selectOption('#pay-account', 'acc_opay');
  await page.fill('#pay-amount', String(amount));
  await page.waitForSelector('#pay-preview .form-ok');
  assert.match(await text(page, '#pay-preview'), /agreed instalments stay as they are until the lender confirms new ones/);
  await page.click('#pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('pay-modal').classList.contains('open'));
  await idle(page);
}

for (const b of BUILDS) {
  test(`${b.label}: extra principal then a lender-confirmed amendment; every screen agrees and nothing is subtracted twice`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await createLoan(page);
    let f = await figures(page);
    // H5: the full schedule (outstanding/scheduledLeft) is 221,820, but nothing is yet due (the
    // first instalment is 20 days out), so the current liability (totalOwed/netWorthLiab) is
    // principal only: 150,000. The 71,820 difference is future interest, in the forecast only.
    assert.deepEqual([f.outstanding, f.totalOwed, f.scheduledLeft, f.netWorthLiab], [221820, 150000, 221820, 150000]);
    assert.deepEqual(f.review, []);

    await payExtra(page, 37500);
    f = await figures(page);
    // Liability 221,820 − 37,500 = 184,320 on the full-schedule figures; still nothing due, so
    // the current liability is principal only, 150,000 − 37,500 = 112,500.
    assert.deepEqual([f.outstanding, f.totalOwed, f.scheduledLeft, f.netWorthLiab], [184320, 112500, 184320, 112500]);
    assert.equal(f.principal, '₦112,500');
    assert.equal(f.charges, 71820);
    assert.deepEqual(f.review, ['extra_unconfirmed']);
    assert.equal(f.cal60, 110910, 'instalments 1 and 2 unchanged in the 60-day calendar');
    assert.equal(f.dirFree, 712500, 'Cash Now 750,000 − 37,500 paid');
    assert.equal(f.dirUncovered, 55455, 'the next instalment is still due in full');
    assert.equal(f.dirAfter, 712500 - 55455);
    await openLoan(page);
    const sched = await page.$$eval('#agr-detail table.sched', t => t[t.length - 1].innerText);
    assert.match(sched, /incl\. ₦37,500 extra principal/);
    assert.match(await text(page, '#agr-extra-note'), /₦37,500 is counted against the last instalments until the lender confirms revised terms/);
    await nav(page, 'loans');
    assert.match(await text(page, '#loan-active'), /Schedule needs review/);

    // Amendment: the lender drops the last instalment (term shortened). The choice is required.
    await openLoan(page);
    await page.click('[data-act="amend"]');
    await page.waitForSelector('#amend-extra input[value="included"]');
    const rows = (await page.inputValue('#amend-rows')).split('\n');
    assert.equal(rows.length, 4, 'the original agreed rows are offered, not invented ones');
    await page.fill('#amend-rows', rows.slice(0, 3).join('\n'));
    await page.fill('#amend-reason', 'Lender shortened the term after the extra payment');
    const before = (await stored(context, b.dbName, 'instalments')).length;
    await page.click('#amend-save-btn');
    assert.match(await text(page, '#amend-preview'), /Choose whether the lender's new instalments already take the extra principal into account/);
    assert.equal((await stored(context, b.dbName, 'instalments')).length, before, 'nothing saved without the choice');
    await page.check('#amend-extra input[value="included"]');
    assert.doesNotMatch(await text(page, '#amend-preview'), /Check the lender's figures/, '112,500 principal in the new rows, as expected');
    await page.click('#amend-save-btn');
    await page.waitForFunction(() => !document.getElementById('amend-modal').classList.contains('open'));
    await idle(page);
    const inst = await stored(context, b.dbName, 'instalments');
    const live = inst.filter(i => !i.supersededBy);
    assert.equal(live.length, 3);
    const alloc = (await stored(context, b.dbName, 'allocations')).find(a => a.kind === 'extra_principal');
    live.forEach(i => assert.deepEqual(i.extraAbsorbed, [alloc.id]));
    f = await figures(page);
    // The amendment reshapes the schedule (shortening the term lowers total future interest to
    // 53,865, so the full schedule is 166,365) but does not change remaining principal: current
    // liability stays 112,500 (still nothing due) — not 128,865: the extra is not subtracted again.
    assert.deepEqual([f.outstanding, f.totalOwed, f.scheduledLeft, f.netWorthLiab], [166365, 112500, 166365, 112500]);
    assert.equal(f.principal, '₦112,500');
    assert.deepEqual(f.review, []);
    assert.equal(f.cal60, 110910);
    assert.equal(f.dirAfter, 712500 - 55455);
    // Restart: same figures, one repayment, one allocation.
    await openApp(page, b.url);
    const again = await figures(page);
    assert.deepEqual(again, f);
    const reps = (await stored(context, b.dbName, 'transactions')).filter(t => t.type === 'loan_repayment');
    assert.equal(reps.length, 1);
    assert.equal(reps[0].amount, 37500);
    assert.deepEqual(page.errors, []);
    await context.close();
  });

  test(`${b.label}: paying off the principal keeps known interest; a settlement is saved only when confirmed and paid`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await createLoan(page);
    await payExtra(page, 150000);
    let f = await figures(page);
    assert.equal(f.principal, 'Fully repaid');
    assert.equal(f.outstanding, 71820, 'scheduled interest is still shown as owed');
    // H5: principal is fully repaid and nothing is yet due, so the current liability (what Net
    // Worth counts) is 0 — the 71,820 is all future interest, not yet demonstrably due.
    assert.equal(f.netWorthLiab, 0);
    assert.deepEqual(f.review, ['extra_unconfirmed', 'charges_after_principal']);
    await openLoan(page);
    assert.match(await text(page, '#agr-detail .screen-sub'), /Active/);
    const snapshot = async () => ({ txns: (await stored(context, b.dbName, 'transactions')).length, alloc: (await stored(context, b.dbName, 'allocations')).length,
      waived: (await stored(context, b.dbName, 'instalments')).filter(i => i.waived).length, status: (await stored(context, b.dbName, 'agreements'))[0].status });
    const start = await snapshot();
    // A payoff quote to compare (e.g. to qualify for a larger loan): preview only, nothing saved.
    await page.click('[data-act="settle"]');
    await page.fill('#settle-amount', '10000');
    await page.fill('#settle-reason', 'Fictional payoff quote');
    await page.waitForSelector('#settle-preview .form-ok');
    assert.match(await text(page, '#settle-preview'), /Still scheduled: ₦71,820\. Lender's figure: ₦10,000\./);
    assert.match(await text(page, '#settle-preview'), /principal ₦0, interest ₦10,000/);
    // Neither box ticked, then only one: refused, nothing saved.
    await page.click('#settle-save-btn');
    assert.match(await text(page, '#settle-preview'), /Nothing was saved/);
    await page.check('#settle-confirmed');
    await page.click('#settle-save-btn');
    assert.match(await text(page, '#settle-preview'), /Nothing was saved/);
    assert.deepEqual(await snapshot(), start);
    // Both ticked but the final confirmation cancelled: nothing saved.
    await page.check('#settle-paid');
    page.answers.push(false);
    await page.click('#settle-save-btn');
    await idle(page);
    assert.deepEqual(await snapshot(), start);
    await page.click('[data-close="settle-modal"]');
    f = await figures(page);
    assert.equal(f.outstanding, 71820);
    assert.equal(f.dirFree, 750000 - 150000);
    // Confirmed and paid: settled, the rest waived, 10,000 left the account once.
    await openLoan(page);
    await page.click('[data-act="settle"]');
    assert.equal(await page.isChecked('#settle-confirmed'), false, 'boxes start unticked each time');
    await page.fill('#settle-amount', '10000');
    await page.fill('#settle-reason', 'Fictional payoff confirmed');
    await page.check('#settle-confirmed'); await page.check('#settle-paid');
    await page.click('#settle-save-btn');
    await page.waitForFunction(() => /Settled/.test(document.querySelector('#agr-detail .screen-sub').textContent));
    await idle(page);
    f = await figures(page);
    assert.equal(f.outstanding, 0);
    assert.equal(f.dirFree, 750000 - 160000);
    // Reverse the settlement: the loan reopens and the interest is owed again.
    await openLoan(page);
    page.answers.push('Fictional bank reversal');
    await page.click('#agr-detail [data-reverse]');
    await page.waitForFunction(() => /Active/.test(document.querySelector('#agr-detail .screen-sub').textContent));
    await idle(page);
    f = await figures(page);
    assert.equal(f.outstanding, 71820);
    assert.equal(f.dirFree, 750000 - 150000);
    assert.equal((await stored(context, b.dbName, 'instalments')).filter(i => i.waived).length, 0, 'waivers lifted');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

for (const b of BUILDS) {
  test(`${b.label}: an older backup with an amendment after extra principal imports unchanged and is not double-subtracted`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const rows = (v, list, o) => list.map(([d, p, i], k) => Object.assign({ id: `agr_old_v${v}_${k + 1}`, agreementId: 'agr_old', seq: (v - 1) * 10 + k + 1, dueDate: d, principal: p, interest: i, fees: 0, total: p + i, version: v }, o));
    const original = rows(1, [[day(20), 30000, 4500], [day(50), 30000, 4500], [day(80), 30000, 4500]], { supersededBy: 'amd_old', supersededAt: daysAgo(1) + 'T09:00:00.000Z' });
    const amended = rows(2, [[day(20), 20000, 4500], [day(50), 20000, 4500], [day(80), 20000, 4500]], { amendmentId: 'amd_old', createdAt: daysAgo(1) + 'T09:00:00.000Z' }); // older format: no extraAbsorbed
    const backup = {
      version: '4.0',
      transactions: [
        { id: 501, amount: 90000, desc: 'Loan received: Old Fictional Loan', cat: 'Loan', type: 'loan_receipt', state: 'Linked', date: daysAgo(10), time: '09:00', fromAcct: '', toAcct: 'pharma_bank', agreementId: 'agr_old', createdAt: daysAgo(10) + 'T09:00:00.000Z' },
        { id: 502, amount: 30000, desc: 'Loan repayment: Old Fictional Loan', cat: 'Loan Repayment', type: 'loan_repayment', state: 'Linked', date: daysAgo(3), time: '10:00', fromAcct: 'pharma_bank', toAcct: '', agreementId: 'agr_old',
          alloc: { principal: 30000, interest: 0, fees: 0, unsplit: 0 }, allocMode: 'extra_principal', idemKey: 'pay_old', createdAt: daysAgo(3) + 'T10:00:00.000Z' },
      ],
      agreements: [{ id: 'agr_old', name: 'Old Fictional Loan', counterparty: 'Fictional Lender', category: 'bank', status: 'active', version: 2, accountId: 'pharma_bank', receivedDate: daysAgo(10), receiptTxnId: 501, agreementDate: daysAgo(10),
        terms: { nature: 'debt', structure: 'manual', principal: 90000, cashReceived: 90000 } }],
      instalments: original.concat(amended),
      allocations: [{ id: 'al_502_0', agreementId: 'agr_old', txnId: 502, instalmentId: null, kind: 'extra_principal', principal: 30000, interest: 0, fees: 0, unsplit: 0, date: daysAgo(3), provisional: false, reversed: false }],
      agreementEvents: [],
    };
    await page.click('#settings-nav-btn');
    await page.setInputFiles('#import-file-input', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => document.getElementById('agr-store-count').textContent === '1');
    await idle(page);
    const inst = await stored(context, b.dbName, 'instalments');
    assert.deepEqual(inst.sort((x, y) => x.id < y.id ? -1 : 1), backup.instalments.slice().sort((x, y) => x.id < y.id ? -1 : 1), 'records imported exactly, nothing rewritten');
    await openLoan(page);
    assert.equal(money(await kv(page, 'Outstanding')), 73500, 'not 43,500');
    assert.equal(await kv(page, 'of which principal'), '₦60,000');
    assert.deepEqual(await page.$$eval('#agr-review [data-review]', els => els.map(e => e.getAttribute('data-review'))), ['legacy_amendment']);
    // Opening the amendment form and cancelling writes nothing.
    await page.click('[data-act="amend"]');
    await page.waitForSelector('#amend-modal.open');
    assert.equal(await page.$('#amend-extra input'), null, 'the old extra already counts as reflected: no question asked');
    await page.click('[data-close="amend-modal"]');
    assert.deepEqual((await stored(context, b.dbName, 'instalments')).length, 6);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}
