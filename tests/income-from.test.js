// Historical "income recorded with a From account" (quick entry kept the default From for "pharmacy
// sales" and "salary", in the v2 app and in this app until it was fixed): a read-only data-quality
// warning lists such entries, says why each was flagged and what it does to balances now, and offers
// the normal edit form. It never rewrites, reverses or deletes anything, and it changes no figure.
// Engine checks run in Node; screen checks run on the TEST site and the production candidate. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = require('./load-engine.js')();
const gen = require('../scripts/build-test-file.js');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';

// ── Engine ──────────────────────────────────────────────────────────────────────────────────────

const ALIASES = { pers_cash: 'acc_opay', pharma_cash: 'acc_opay', pharma_bank: 'acc_bank' };
const IDS = ['acc_opay', 'acc_bank', 'acc_coop'];
const tx = (id, o) => Object.assign({ id, amount: 1000, date: '2026-10-10', time: '10:00', state: 'AI Categorized', desc: 'Fictional ' + id, cat: 'Other', fromAcct: '', toAcct: '' }, o);
const LEGIT = [
  tx(1, { type: 'transfer', fromAcct: 'acc_opay', toAcct: 'acc_bank', cat: 'Savings' }),
  tx(2, { type: 'transfer', fromAcct: 'pers_cash', toAcct: 'coop', cat: 'Savings' }), // a legacy-id transfer
  tx(3, { type: 'income', toAcct: 'acc_opay', cat: 'Pharmacy Sales' }),
  tx(4, { type: 'income', toAcct: 'pharma_cash', cat: 'Income', receivedFrom: 'Fictional customer' }),
  tx(5, { type: 'capital_injection', fromAcct: 'acc_bank', toAcct: 'acc_opay', cat: 'Capital Injection', fundingKind: 'capital_injection' }), // From is optional for capital
  tx(6, { type: 'expense', fromAcct: 'acc_opay', cat: 'Food' }),
  tx(7, { type: 'owner_withdrawal', fromAcct: 'acc_bank', toAcct: 'acc_opay', cat: 'Owner Withdrawal' }),
  tx(8, { type: 'income', fromAcct: 'pers_cash', toAcct: 'pharma_cash', cat: 'Pharmacy Sales', voided: true }), // reversed: no effect
  tx(9, { type: 'income', fromAcct: 'pers_cash', toAcct: 'pharma_cash', cat: 'Pharmacy Sales', demo: true }), // sample
];
const AFFECTED = [
  tx(21, { type: 'income', fromAcct: 'pers_cash', toAcct: 'pharma_cash', cat: 'Pharmacy Sales' }),  // v2 quick entry, raw ids
  tx(22, { type: 'income', fromAcct: 'acc_opay', toAcct: 'acc_opay', cat: 'Income' }),               // live quick entry, resolved ids
  tx(23, { type: 'income', fromAcct: 'acc_bank', toAcct: 'acc_opay', cat: 'Other' }),                // From chosen in Add Entry
  tx(24, { type: 'income', fromAcct: 'acc_bank', toAcct: '', cat: 'Other' }),                        // no To: money out
  tx(25, { type: 'income', fromAcct: 'emergency', toAcct: 'acc_opay', cat: 'Income' }),              // From not set up: acts as income
  tx(27, { type: 'income', fromAcct: 'acc_bank', toAcct: 'ghost', cat: 'Other' }),                   // To not set up: money out only
  tx(28, { type: 'income', fromAcct: 'emergency', toAcct: 'ghost', cat: 'Other' }),                  // neither set up: no effect
  tx(26, { type: 'income', fromAcct: 'pers_cash', toAcct: 'pharma_cash', cat: 'Pharmacy Sales', date: '2026-08-01' }), // before baseline
];
const OPTS = { aliases: ALIASES, accountIds: IDS, baselineDate: '2026-09-01' };

test('engine: only non-reversed income with a From account is flagged; transfers and correct income never are', () => {
  assert.deepEqual(F.incomeFromFindings(LEGIT, OPTS), [], 'legitimate transfers, correct income, capital with a From account, reversed and sample entries: nothing');
  assert.deepEqual(F.incomeFromFindings(LEGIT.concat(AFFECTED), OPTS), [
    { id: 21, pattern: 'quick', effect: 'none', beforeBaseline: false, balanceDiff: true },
    { id: 22, pattern: 'quick', effect: 'none', beforeBaseline: false, balanceDiff: true },
    { id: 23, pattern: 'chosen', effect: 'moved', beforeBaseline: false, balanceDiff: true },
    { id: 24, pattern: 'chosen', effect: 'out_only', beforeBaseline: false, balanceDiff: true },
    { id: 25, pattern: 'chosen', effect: 'to_only', beforeBaseline: false, balanceDiff: false },
    { id: 27, pattern: 'chosen', effect: 'out_only', beforeBaseline: false, balanceDiff: true },
    { id: 28, pattern: 'chosen', effect: 'no_account', beforeBaseline: false, balanceDiff: false },
    { id: 26, pattern: 'quick', effect: 'none', beforeBaseline: true, balanceDiff: false },
  ]);
  // Without aliases (a v2 database before setup) the raw pers_cash default still reads as the quick-entry pattern.
  assert.deepEqual(F.incomeFromFindings([AFFECTED[0]], {}), [{ id: 21, pattern: 'quick', effect: 'moved', beforeBaseline: false, balanceDiff: true }]);
  // A different category with the same From is not assumed to be the quick-entry bug.
  assert.equal(F.incomeFromFindings([tx(30, { type: 'income', fromAcct: 'pers_cash', toAcct: 'pharma_cash', cat: 'Other' })], OPTS)[0].pattern, 'chosen');
});

test('engine: the data-quality warning lists exactly the affected entries; clean data gets no warning', () => {
  const dq = txns => F.dataQuality(Object.assign({ txns, today: '2026-10-21' }, OPTS));
  assert.equal(dq(LEGIT).find(q => q.key === 'income_with_from'), undefined);
  const w = dq(LEGIT.concat(AFFECTED)).find(q => q.key === 'income_with_from');
  assert.equal(w.severity, 'high'); assert.equal(w.count, 8);
  assert.deepEqual(w.ids, [21, 22, 23, 24, 25, 27, 28, 26]);
  assert.match(w.text, /^8 income entries may be misclassified and need review: income normally only adds to the account it is received in, but these also name a From account\. 5 of them currently leave your balances different from income received \(see each below\), so balance figures may be off until they are reviewed\. Reports count them as income either way\. If it was money received, set From to None; if it was a move between your own accounts, change it to a Transfer\. Nothing has been changed\.$/);
  assert.doesNotMatch(w.text, /like a transfer|moves money out/, 'no claim that every entry moves money');
});

test('engine: severity follows the balance effect; entries that leave balances as income would are not reported as affecting the figures', () => {
  const dq = txns => F.dataQuality(Object.assign({ txns, today: '2026-10-21' }, OPTS)).find(q => q.key === 'income_with_from');
  const quiet = [AFFECTED[4], AFFECTED[6], AFFECTED[7]]; // From not set up; neither set up; before the baseline
  let w = dq(quiet);
  assert.equal(w.severity, 'info', 'nothing to fix in the balances: not shown as high');
  assert.match(w.text, /^3 income entries may be misclassified[\s\S]*None of them changes your balances differently from income received[\s\S]*the balance figures are not affected\./);
  assert.doesNotMatch(w.text, /may be off/);
  const plan = quality => F.directorPlan({ today: '2026-10-21', cashNow: 600000, restricted: 80000, earmarkedGeneral: 30000, reservedLinked: 0, freeToUse: 570000, obligations: [], floor: 200000, quality, overEarmarked: [], staleReservations: [] });
  const p = plan([w]);
  assert.equal(p.actions.some(a => a.kind === 'data_quality'), false, 'no "these records affect the figures" advice');
  assert.equal(p.qualified, false);
  // One entry that does differ makes it high, and says how many.
  w = dq(quiet.concat([AFFECTED[1]]));
  assert.equal(w.severity, 'high');
  assert.match(w.text, /^4 income entries may be misclassified[\s\S]*1 of them currently leave your balances different from income received/);
  w = dq([AFFECTED[4]]);
  assert.match(w.text, /^1 income entry may be misclassified and needs review[\s\S]*It does not change your balances differently/);
});

test('engine: the effect matches the balance engine exactly, including a To account that is not set up', () => {
  const accts = IDS.map(id => ({ id, opening: 0 }));
  const delta = t => F.accountBalances(accts, [t], { aliases: ALIASES });
  const asIncome = t => delta(Object.assign({}, t, { fromAcct: '' }));
  const EXPECTED = { 21: 'none', 22: 'none', 23: 'moved', 24: 'out_only', 25: 'to_only', 27: 'out_only', 28: 'no_account' };
  // What each effect means in account movements, checked against the balance engine itself.
  const MOVES = { none: [false, false], no_account: [false, false], moved: [true, true], out_only: [true, false], to_only: [false, true] };
  for (const t of AFFECTED.filter(x => x.date >= OPTS.baselineDate)) {
    const [x] = F.incomeFromFindings([t], OPTS), d = delta(t), vals = Object.values(d);
    assert.equal(x.effect, EXPECTED[t.id], `entry ${t.id}`);
    assert.deepEqual([vals.some(v => v < 0), vals.some(v => v > 0)], MOVES[x.effect], `entry ${t.id}: "${x.effect}" is what the engine does`);
    assert.equal(x.balanceDiff, JSON.stringify(d) !== JSON.stringify(asIncome(t)), `entry ${t.id}: balanceDiff is exactly "differs from income received"`);
  }
  // The reported case: From set up, To not set up. The engine only takes money out of From.
  const ghost = tx(40, { type: 'income', amount: 2500, fromAcct: 'acc_bank', toAcct: 'ghost' });
  assert.deepEqual(delta(ghost), { acc_opay: 0, acc_bank: -2500, acc_coop: 0 });
  assert.equal(F.incomeFromFindings([ghost], OPTS)[0].effect, 'out_only');
});

test('engine: the warning has no financial effect: records unchanged, balances, cash flow and Director figures identical', () => {
  const all = LEGIT.concat(AFFECTED), before = JSON.stringify(all);
  const accts = IDS.map(id => ({ id, opening: 100000 }));
  const bal0 = F.accountBalances(accts, all, OPTS), cf0 = F.cashFlowSummary(all, '2026-10-01', '2026-11-01');
  const q = F.dataQuality(Object.assign({ txns: all, today: '2026-10-21' }, OPTS));
  F.incomeFromFindings(all, OPTS);
  assert.equal(JSON.stringify(all), before, 'no record is changed');
  assert.deepEqual(F.accountBalances(accts, all, OPTS), bal0);
  assert.deepEqual(F.cashFlowSummary(all, '2026-10-01', '2026-11-01'), cf0);
  const plan = quality => F.directorPlan({ today: '2026-10-21', cashNow: 600000, restricted: 80000, earmarkedGeneral: 30000, reservedLinked: 0, freeToUse: 570000, obligations: [], floor: 200000, quality, overEarmarked: [], staleReservations: [] });
  const withW = plan(q), without = plan([]);
  assert.deepEqual(withW.figures, without.figures, 'every Director figure is the same');
  assert.ok(withW.actions.some(a => a.kind === 'data_quality'), 'it only adds advice to review the entries');
  assert.equal(withW.qualified, true);
});

// ── Screens ─────────────────────────────────────────────────────────────────────────────────────

const BUILDS = [
  { label: 'TEST build', url: '/koboflow-test/', dbName: 'KoboFlowDB-test' },
  { label: 'production candidate', url: '/KoboFlow/', dbName: 'KoboFlowDB' },
];
const LEGACY = ['pharma_cash', 'pharma_bank', 'pers_cash', 'pers_bank', 'coop', 'emergency', 'fixed_dep'];

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
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const storedTxns = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), n);
const seed = (context, n, recs) => probe(context, ([n, rs]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); rs.forEach(r => tx.objectStore('transactions').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = rej; }; }), [n, recs]);
const acctBal = async (page, label) => { await nav(page, 'home'); return page.$$eval('.acct-card', (cs, l) => { const c = cs.find(x => x.querySelector('.acct-name').textContent.trim().endsWith(l)); return c ? Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, '')) : null; }, label); };
const dirRows = async page => { await nav(page, 'director'); return page.$$eval('#director-body [data-dir-row]', rs => Object.fromEntries(rs.map(r => [r.getAttribute('data-dir-row'), r.querySelector('.autopilot-val').textContent.trim()]))); };

// Opay 100,000 and Fictional Bank 500,000; every legacy account (pers_cash, pharma_cash, …) maps to Opay.
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
  for (const k of LEGACY) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}

for (const b of BUILDS) {
  test(`${b.label}: the warning lists each affected entry with its reason and effect, changes nothing, and correction goes through the normal review`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    const bank = await page.$eval('#modal-from', s => Array.from(s.options).find(o => o.textContent.trim() === 'Fictional Bank').value);
    const day = daysAgo(2);
    const r = (id, o) => Object.assign({ id, amount: 10000, date: day, time: '10:00', state: 'AI Categorized', fromAcct: '', toAcct: '' }, o);
    // As saved by the v2 app's quick entry (raw ids), by this app's Add Entry with a chosen From, plus a
    // legitimate transfer and correctly recorded income.
    const recs = [
      r(801, { type: 'income', desc: 'Fictional pharmacy sales', cat: 'Pharmacy Sales', fromAcct: 'pers_cash', toAcct: 'pharma_cash' }),
      r(802, { type: 'income', desc: 'Fictional bank interest', cat: 'Other', fromAcct: bank, toAcct: 'acc_opay', amount: 2000 }),
      r(803, { type: 'transfer', desc: 'Fictional savings move', cat: 'Savings', fromAcct: 'acc_opay', toAcct: bank, amount: 5000 }),
      r(804, { type: 'income', desc: 'Fictional correct sales', cat: 'Pharmacy Sales', toAcct: 'acc_opay', amount: 3000 }),
      r(805, { type: 'income', desc: 'Fictional refund', cat: 'Other', fromAcct: bank, toAcct: 'fictional_unknown', amount: 1500 }),
    ];
    await seed(context, b.dbName, recs);
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
    const stored0 = await storedTxns(context, b.dbName);

    // Balances follow the existing rule exactly (the warning does not alter them):
    // 801 pers_cash→pharma_cash are both Opay: 0. 802 Bank −2,000 → Opay +2,000. 803 Opay −5,000 → Bank +5,000.
    // 804 Opay +3,000. 805 Bank −1,500 only (its To account is not set up).
    assert.equal(await acctBal(page, 'Opay'), 100000);
    assert.equal(await acctBal(page, 'Fictional Bank'), 501500);
    const rows0 = await dirRows(page);
    assert.equal(rows0.cash, '₦601,500');

    // The warning and its list.
    const w = await text(page, '#director-body [data-dir-quality="income_with_from"]');
    assert.match(w, /^3 income entries may be misclassified and need review[\s\S]*They currently leave your balances different from income received[\s\S]*Nothing has been changed\.$/);
    const listed = await page.$$eval('#director-body [data-dq-entry]', es => es.map(e => [e.getAttribute('data-dq-entry'), e.getAttribute('data-dq-pattern'), e.textContent.replace(/\s+/g, ' ')]));
    assert.deepEqual(listed.map(x => x[0]).sort(), ['801', '802', '805'], 'the transfer and the correct income are not listed');
    const e801 = listed.find(x => x[0] === '801'), e802 = listed.find(x => x[0] === '802');
    assert.equal(e801[1], 'quick');
    assert.match(e801[2], /Fictional pharmacy sales[\s\S]*From Opay → To Opay[\s\S]*most likely money received[\s\S]*From and To are the same account, so it changes no balance\. Recorded as income received, it would add ₦10,000 to Opay\./);
    assert.equal(e802[1], 'chosen');
    assert.match(e802[2], /From Fictional Bank → To Opay[\s\S]*change it to a Transfer[\s\S]*takes ₦2,000 out of Fictional Bank and adds it to Opay, so your total cash does not go up/);
    const e805 = listed.find(x => x[0] === '805');
    assert.match(e805[2], /its To account is not set up, so it only takes ₦1,500 out of Fictional Bank, the opposite of income\./, 'not "moved": the engine only takes money out');
    assert.doesNotMatch(e805[2], /adds it to/);

    // Showing it changed nothing: records, balances and every Director figure are the same after a restart.
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
    assert.deepEqual(await storedTxns(context, b.dbName), stored0, 'no record rewritten, reversed or deleted');
    assert.deepEqual(await dirRows(page), rows0);

    // REVIEW opens the normal edit form; cancelling writes nothing.
    await page.click('#director-body [data-dq-entry="801"] [data-edit-txn]');
    await page.waitForSelector('#edit-modal.open[data-form-ready="1"]');
    assert.equal(await page.inputValue('#edit-from'), 'pers_cash');
    await page.click('#edit-cancel-btn');
    await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
    assert.deepEqual(await storedTxns(context, b.dbName), stored0);
    // The user decides: From → None, through the review and CONFIRM AND SAVE.
    await page.click('#director-body [data-dq-entry="801"] [data-edit-txn]');
    await page.waitForSelector('#edit-modal.open[data-form-ready="1"]');
    await page.selectOption('#edit-from', '');
    await page.click('#edit-save-btn'); await page.waitForSelector('#edit-confirm-btn[data-ready="1"]');
    assert.match(await text(page, '#edit-review-list'), /From[\s\S]*→ \(none\)/);
    await page.click('#edit-confirm-btn');
    await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
    const after = await storedTxns(context, b.dbName);
    assert.equal(after.length, 5, 'corrected in place');
    const c = after.find(t => t.id === 801);
    assert.equal(c.fromAcct, ''); assert.equal(c.toAcct, 'pharma_cash'); assert.equal(c.type, 'income'); assert.equal(c.edits.length, 1);
    assert.deepEqual(after.filter(t => t.id !== 801), stored0.filter(t => t.id !== 801), 'other entries untouched');
    // Now it is income: Opay +10,000; one entry left on the list.
    assert.equal(await acctBal(page, 'Opay'), 110000);
    await nav(page, 'director');
    assert.match(await text(page, '#director-body [data-dir-quality="income_with_from"]'), /^2 income entries may be misclassified/);
    assert.deepEqual((await page.$$eval('#director-body [data-dq-entry]', es => es.map(e => e.getAttribute('data-dq-entry')))).sort(), ['802', '805']);
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}
