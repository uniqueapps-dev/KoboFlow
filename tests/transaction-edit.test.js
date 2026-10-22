// Editing a saved entry: the original record changes in place (same id, no second record), cancel
// writes nothing, every figure follows the edit, linked entries keep their links, entries owned by
// a loan agreement are refused, failed or conflicting saves change nothing, and an older backup
// cannot bring a pre-edit version back. TEST site and production candidate. Fictional data only.
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
const TEST = BUILDS[0];
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

// Fail-able writes (same switch as the bills tests): window.__fail.write makes every put throw.
const switches = () => {
  window.__fail = {};
  const P = IDBObjectStore.prototype, put = P.put;
  P.put = function () { if (window.__fail.write) throw new DOMException('simulated write failure', 'QuotaExceededError'); return put.apply(this, arguments); };
};
async function ctx() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await context.addInitScript(switches);
  const page = await context.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
  return { context, page };
}
const openApp = async (page, url) => { await page.goto(base + url); await page.waitForSelector('body[data-kf-ready="1"]'); };
const nav = (page, sc) => page.click(`.nav-btn[data-screen="${sc}"]`);
const text = (page, sel) => page.textContent(sel);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const plusDays = (page, n) => page.evaluate(n => KoboFin.addDays(KoboFin.today(), n), n);
async function probe(context, fn, arg) { const p = await context.newPage(); await p.goto(base + '/probe'); const r = await p.evaluate(fn, arg); await p.close(); return r; }
const storedTxns = (context, n) => probe(context, n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; }; }), n);
const putTxn = (context, n, rec) => probe(context, ([n, rec]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction('transactions', 'readwrite'); tx.objectStore('transactions').put(rec); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = rej; }; }), [n, rec]);
const dbNames = context => probe(context, () => indexedDB.databases().then(d => d.map(x => x.name)));
const acctBal = (page, label) => page.$$eval('.acct-card', (cards, l) => {
  const c = cards.find(x => x.querySelector('.acct-name').textContent.trim().endsWith(l));
  return c ? Number(c.querySelector('.acct-bal').textContent.replace(/[^0-9]/g, '')) : null;
}, label);
const dirRow = async (page, k) => (await text(page, `#director-body [data-dir-row="${k}"] .autopilot-val`)).trim();
const acctId = (page, label) => page.$eval('#modal-from', (s, l) => Array.from(s.options).find(o => o.textContent.trim() === l).value, label);
// Taps an entry the way an old or stale link would: a control carrying the entry's id, outside any Edit button.
const tapEditLink = (page, id) => page.evaluate(id => { const el = document.createElement('span'); el.setAttribute('data-edit-txn', id); document.getElementById('timeline-list').appendChild(el); el.click(); el.remove(); }, String(id));

// Live setup: Opay 100,000 (earmark "Fictional Rent" 30,000); Fictional Bank 500,000; Fictional Coop 80,000 (restricted).
async function liveSetup(page) {
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
  for (const k of ALIASES) await page.selectOption(`#setup-aliases [data-alias="${k}"]`, 'acc_opay');
  await page.click('#setup-save-btn'); await page.click('#setup-confirm-btn');
  await page.waitForFunction(() => !document.getElementById('setup-modal').classList.contains('open'));
}
async function addEntry(page, { type = 'expense', amount, desc, cat, from = '', to = '' }) {
  await page.click('#add-btn'); await page.waitForSelector('#modal-overlay[data-form-ready="1"]');
  await page.click(`.type-chip[data-type="${type}"]`);
  await page.fill('#modal-amount', String(amount)); await page.fill('#modal-desc', desc);
  if (cat) await page.selectOption('#modal-cat', cat);
  await page.selectOption('#modal-from', from); await page.selectOption('#modal-to', to);
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('modal-overlay').classList.contains('open'));
}
const byDesc = (txs, d) => txs.find(t => t.desc === d);
// Opens the edit form from History (or the Inbox) with the entry's EDIT button.
async function openEditFrom(page, where, id) {
  await nav(page, where === 'inbox' ? 'inbox' : 'timeline');
  await page.click(`#${where === 'inbox' ? 'inbox' : 'timeline'}-list button[data-edit-txn="${id}"]`);
  await page.waitForSelector('#edit-modal.open[data-form-ready="1"]');
}
const form = page => page.evaluate(() => ({
  type: document.getElementById('edit-type').value, typeLocked: document.getElementById('edit-type').disabled,
  amount: document.getElementById('edit-amount').value, desc: document.getElementById('edit-desc').value,
  cat: document.getElementById('edit-cat').value, date: document.getElementById('edit-date').value, time: document.getElementById('edit-time').value,
  from: document.getElementById('edit-from').value, to: document.getElementById('edit-to').value,
}));
// Saving is two taps: SAVE CHANGES shows the in-form review of the changes (nothing written yet),
// then CONFIRM AND SAVE writes them. The review is part of the page, never a browser dialog.
const closed = page => page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
const reviewChanges = async page => {
  await page.click('#edit-save-btn');
  await page.waitForSelector('#edit-review', { state: 'visible' });
  return (await text(page, '#edit-review')).replace(/\s+/g, ' ').trim();
};
// The listed changes, one "Label: from → to" per changed field.
const reviewRows = page => page.$$eval('#edit-review-list [data-edit-change]', rows => rows.map(r => r.querySelector('.k').textContent.trim() + ': ' + r.querySelector('.v').textContent.trim()));
const confirmReview = async page => { await page.waitForSelector('#edit-confirm-btn[data-ready="1"]'); await page.click('#edit-confirm-btn'); };
const saveEditForm = async page => { await reviewChanges(page); await confirmReview(page); await closed(page); };
// A refused value is reported on SAVE CHANGES, before any review.
const editError = async page => { await page.click('#edit-save-btn'); await page.waitForSelector('#edit-msg .form-err'); return (await text(page, '#edit-msg')).trim(); };
// A failure while writing is reported after CONFIRM AND SAVE; the form returns to the fields.
const confirmError = async page => { await reviewChanges(page); await confirmReview(page); await page.waitForSelector('#edit-msg .form-err'); return (await text(page, '#edit-msg')).trim(); };

for (const b of BUILDS) {
  test(`${b.label}: editing an expense's amount, description and category changes the same record; balances and reports follow`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await addEntry(page, { amount: 5000, desc: 'Fictional lunch', cat: 'Food', from: 'acc_opay' });
    const before = await storedTxns(context, b.dbName);
    assert.equal(before.length, 1);
    const orig = before[0];
    await nav(page, 'home');
    assert.equal(await acctBal(page, 'Opay'), 95000);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦595,000');
    await nav(page, 'cashflow');
    assert.equal((await text(page, '#cf-op-total')).trim(), '-₦5,000');

    // The form opens from History, prefilled with exactly what was saved.
    await openEditFrom(page, 'timeline', orig.id);
    assert.deepEqual(await form(page), { type: 'expense', typeLocked: false, amount: '5000', desc: 'Fictional lunch', cat: 'Food', date: orig.date, time: orig.time, from: 'acc_opay', to: '' });
    await page.fill('#edit-amount', '7500'); await page.fill('#edit-desc', 'Fictional lunch and drinks'); await page.selectOption('#edit-cat', 'Household');
    await reviewChanges(page);
    assert.deepEqual(await reviewRows(page), ['Amount: ₦5,000 → ₦7,500', 'Description: Fictional lunch → Fictional lunch and drinks', 'Category: Food → Household'], 'the review lists every change');
    await confirmReview(page); await closed(page);

    const after = await storedTxns(context, b.dbName);
    assert.equal(after.length, 1, 'edited in place: no second record');
    const t = after[0];
    assert.equal(t.id, orig.id, 'same identity');
    assert.equal(t.amount, 7500); assert.equal(t.desc, 'Fictional lunch and drinks'); assert.equal(t.cat, 'Household');
    for (const k of ['type', 'date', 'time', 'fromAcct', 'toAcct', 'state']) assert.equal(t[k], orig[k], `${k} unchanged`);
    assert.equal(t.edits.length, 1);
    assert.deepEqual(t.edits[0].changes, { amount: { from: 5000, to: 7500 }, desc: { from: 'Fictional lunch', to: 'Fictional lunch and drinks' }, cat: { from: 'Food', to: 'Household' } });
    assert.equal(t.edits[0].prevSig, [orig.date, orig.time, 5000, 'expense', 'Fictional lunch', 'acc_opay', ''].join('|'));
    assert.ok(t.updatedAt);

    // Every figure follows the edit, once.
    await nav(page, 'home');
    assert.equal(await acctBal(page, 'Opay'), 92500);
    await nav(page, 'director');
    assert.equal(await dirRow(page, 'cash'), '₦592,500');
    await nav(page, 'cashflow');
    assert.equal((await text(page, '#cf-op-total')).trim(), '-₦7,500');
    await nav(page, 'timeline');
    const tl = await text(page, '#timeline-list');
    assert.match(tl, /Fictional lunch and drinks[\s\S]*Household[\s\S]*-₦7,500/);
    assert.doesNotMatch(tl, /₦5,000/);
    await nav(page, 'inbox');
    assert.match(await text(page, '#inbox-list'), /Fictional lunch and drinks[\s\S]*Household[\s\S]*-₦7,500/);
    assert.match(await text(page, '#inbox-meta'), /^1 entries/);

    // The edit survives a restart.
    await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
    await nav(page, 'home');
    assert.equal(await acctBal(page, 'Opay'), 92500);
    if (b === TEST) assert.ok(!(await dbNames(context)).includes('KoboFlowDB'), 'the TEST build never creates or opens the live database');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

for (const b of BUILDS) {
  // Android acceptance defect: SAVE CHANGES saved at once, with no confirmation. The confirmation is now a
  // review step inside the form (not a browser dialog), and this test drives that real path.
  test(`${b.label}: SAVE CHANGES first shows the changes for confirmation; confirming saves once, going back or cancelling saves nothing`, { skip }, async () => {
    const { context, page } = await ctx();
    await openApp(page, b.url);
    await liveSetup(page);
    await addEntry(page, { amount: 5000, desc: 'Fictional acceptance expense', cat: 'Food', from: 'acc_opay' });
    const [orig] = await storedTxns(context, b.dbName);
    const unchanged = async why => {
      assert.deepEqual(await storedTxns(context, b.dbName), [orig], why);
      await nav(page, 'timeline');
      assert.match(await text(page, '#timeline-list'), /Fictional acceptance expense[\s\S]*-₦5,000/, why);
      await nav(page, 'home');
      assert.equal(await acctBal(page, 'Opay'), 95000, why);
    };
    const dialogsBefore = page.dialogs.length;

    // 1. SAVE CHANGES shows the proposed changes and writes nothing.
    await openEditFrom(page, 'inbox', orig.id);
    await page.fill('#edit-amount', '6000'); await page.fill('#edit-desc', 'ACCEPTANCE TEST - EDITED.');
    const review = await reviewChanges(page);
    assert.match(review, /Check your changes\. Nothing is saved until you tap CONFIRM AND SAVE/);
    assert.match(review, /Changes to “Fictional acceptance expense”/);
    assert.deepEqual(await reviewRows(page), ['Amount: ₦5,000 → ₦6,000', 'Description: Fictional acceptance expense → ACCEPTANCE TEST - EDITED.'], 'exactly the changed fields are listed');
    assert.equal(await page.isVisible('#edit-fields'), false);
    assert.equal(await page.isVisible('#edit-save-btn'), false);
    assert.equal(await page.isVisible('#edit-confirm-btn'), true);
    assert.equal(await page.isVisible('#edit-modal'), true);
    assert.deepEqual(await storedTxns(context, b.dbName), [orig], 'nothing is saved while the changes are shown');

    // 2. BACK TO EDITING returns to the fields with the typed values; still nothing saved.
    await page.waitForSelector('#edit-confirm-btn[data-ready="1"]');
    await page.click('#edit-back-btn');
    assert.equal(await page.isVisible('#edit-fields'), true);
    assert.equal(await page.inputValue('#edit-amount'), '6000');
    assert.equal(await page.inputValue('#edit-desc'), 'ACCEPTANCE TEST - EDITED.');
    assert.deepEqual(await storedTxns(context, b.dbName), [orig]);

    // 3. A fast double tap on SAVE CHANGES cannot also confirm: the second tap is ignored.
    await page.dblclick('#edit-save-btn');
    await page.waitForSelector('#edit-review', { state: 'visible' });
    await page.waitForTimeout(250);
    assert.deepEqual(await storedTxns(context, b.dbName), [orig], 'a double tap shows the review, it does not save');
    assert.equal(await page.isVisible('#edit-modal'), true);

    // 4. CANCEL from the review closes the form and saves nothing.
    await page.waitForSelector('#edit-confirm-btn[data-ready="1"]');
    await page.click('#edit-cancel-btn'); await closed(page);
    await unchanged('cancelled from the review: the original is unchanged');

    // 5. Confirming saves the reviewed changes once, even with a double tap on CONFIRM AND SAVE.
    await openEditFrom(page, 'timeline', orig.id);
    assert.equal(await page.inputValue('#edit-desc'), 'Fictional acceptance expense', 'the form reopens with the saved values');
    await page.fill('#edit-amount', '6000'); await page.fill('#edit-desc', 'ACCEPTANCE TEST - EDITED.');
    await reviewChanges(page);
    await page.waitForSelector('#edit-confirm-btn[data-ready="1"]');
    await page.dblclick('#edit-confirm-btn');
    await closed(page);
    await page.waitForTimeout(300);
    const after = await storedTxns(context, b.dbName);
    assert.equal(after.length, 1, 'no second record');
    assert.equal(after[0].id, orig.id);
    assert.equal(after[0].amount, 6000); assert.equal(after[0].desc, 'ACCEPTANCE TEST - EDITED.');
    assert.equal(after[0].edits.length, 1, 'applied once');
    assert.deepEqual(Object.keys(after[0].edits[0].changes).sort(), ['amount', 'desc']);
    await nav(page, 'home');
    assert.equal(await acctBal(page, 'Opay'), 94000, 'the balance moved once');
    assert.equal(page.dialogs.length, dialogsBefore, 'no browser dialog is used anywhere in the edit flow');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('TEST build: Cancel, the close button, tapping outside and "no changes" all leave the record exactly as it was', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await addEntry(page, { amount: 2000, desc: 'Fictional bread', cat: 'Food', from: 'acc_opay' });
  const [orig] = await storedTxns(context, TEST.dbName);
  const bank = await acctId(page, 'Fictional Bank');
  const scribble = async () => {
    await page.fill('#edit-amount', '99999'); await page.fill('#edit-desc', 'Changed but not saved');
    await page.selectOption('#edit-cat', 'Utilities'); await page.selectOption('#edit-type', 'income');
    await page.selectOption('#edit-from', ''); await page.selectOption('#edit-to', bank);
  };
  const closers = [
    ['Cancel', () => page.click('#edit-cancel-btn')],
    ['the close button', () => page.click('#edit-close-btn')],
    ['tapping outside', () => page.mouse.click(195, 10)],
  ];
  for (const [how, close] of closers) {
    await openEditFrom(page, 'inbox', orig.id);
    await scribble();
    await close();
    await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
    assert.deepEqual(await storedTxns(context, TEST.dbName), [orig], `${how}: nothing written`);
    await nav(page, 'timeline');
    assert.match(await text(page, '#timeline-list'), /Fictional bread[\s\S]*Food[\s\S]*-₦2,000/, `${how}: the screen keeps the original`);
    assert.doesNotMatch(await text(page, '#timeline-list'), /Changed but not saved|99,999/);
  }
  // Reopening shows the saved values, not the abandoned ones.
  await openEditFrom(page, 'timeline', orig.id);
  assert.deepEqual(await form(page), { type: 'expense', typeLocked: false, amount: '2000', desc: 'Fictional bread', cat: 'Food', date: orig.date, time: orig.time, from: 'acc_opay', to: '' });
  // Saving without changing anything writes nothing and adds no history.
  const dialogs = page.dialogs.length;
  await page.click('#edit-save-btn'); await closed(page);
  assert.equal(page.dialogs.length, dialogs, 'no dialog');
  assert.equal(await page.isVisible('#edit-review'), false, 'no review: there was nothing to save');
  assert.deepEqual(await storedTxns(context, TEST.dbName), [orig]);
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 98000);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: transfers, owner withdrawals, investments, capital injections and a change of type move each account once', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  const bank = await acctId(page, 'Fictional Bank'), coop = await acctId(page, 'Fictional Coop');
  await addEntry(page, { type: 'transfer', amount: 10000, desc: 'Fictional transfer', from: 'acc_opay', to: bank });
  await addEntry(page, { type: 'owner_withdrawal', amount: 6000, desc: 'Fictional owner draw', from: bank, to: 'acc_opay' });
  await addEntry(page, { type: 'investment', amount: 20000, desc: 'Fictional deposit', from: bank, to: coop });
  await addEntry(page, { type: 'capital_injection', amount: 15000, desc: 'Fictional capital', cat: 'Other', to: bank });
  await addEntry(page, { amount: 3000, desc: 'Fictional refund (entered as expense)', from: 'acc_opay' });
  let txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 5);
  const id = d => byDesc(txs, d).id;
  await nav(page, 'home');
  // Opay 100,000 −10,000 +6,000 −3,000; Bank 500,000 +10,000 −6,000 −20,000 +15,000; Coop 80,000 +20,000.
  assert.deepEqual([await acctBal(page, 'Opay'), await acctBal(page, 'Fictional Bank'), await acctBal(page, 'Fictional Coop')], [93000, 499000, 100000]);

  // Transfer: a half transfer or the same account on both sides is refused, and nothing is written.
  await openEditFrom(page, 'timeline', id('Fictional transfer'));
  assert.deepEqual([(await form(page)).from, (await form(page)).to], ['acc_opay', bank]);
  await page.selectOption('#edit-to', '');
  assert.match(await editError(page), /Choose the To account/);
  await page.selectOption('#edit-to', 'acc_opay');
  assert.match(await editError(page), /From and To must be different accounts/);
  assert.deepEqual(byDesc(await storedTxns(context, TEST.dbName), 'Fictional transfer'), byDesc(txs, 'Fictional transfer'));
  await page.fill('#edit-amount', '12500'); await page.selectOption('#edit-to', coop);
  await saveEditForm(page);

  // Owner withdrawal, investment and capital injection amounts.
  for (const [d, amt] of [['Fictional owner draw', '7000'], ['Fictional deposit', '25000'], ['Fictional capital', '18000']]) {
    await openEditFrom(page, 'timeline', id(d));
    await page.fill('#edit-amount', amt);
    await saveEditForm(page);
  }
  // Capital is never relabelled as a loan here.
  await openEditFrom(page, 'timeline', id('Fictional capital'));
  await page.selectOption('#edit-cat', 'Loan');
  assert.match(await editError(page), /Loan money is not capital/);
  await page.click('#edit-cancel-btn');

  // Expense → income: the From account must be cleared and a To account chosen.
  await openEditFrom(page, 'inbox', id('Fictional refund (entered as expense)'));
  await page.selectOption('#edit-type', 'income');
  assert.match(await editError(page), /Income has no From account[\s\S]*Choose the To account/);
  await page.selectOption('#edit-from', ''); await page.selectOption('#edit-to', 'acc_opay');
  await saveEditForm(page);

  txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 5, 'still five records: every change was in place');
  const tr = byDesc(txs, 'Fictional transfer');
  assert.equal(tr.amount, 12500); assert.equal(tr.fromAcct, 'acc_opay'); assert.equal(tr.toAcct, coop);
  assert.equal(byDesc(txs, 'Fictional capital').fundingKind, 'capital_injection', 'still counted as capital');
  const inc = byDesc(txs, 'Fictional refund (entered as expense)');
  assert.equal(inc.type, 'income'); assert.equal(inc.fromAcct, ''); assert.equal(inc.toAcct, 'acc_opay');
  assert.deepEqual(Object.keys(inc.edits[0].changes).sort(), ['fromAcct', 'toAcct', 'type']);
  await nav(page, 'home');
  // Opay 100,000 −12,500 +7,000 +3,000; Bank 500,000 −7,000 −25,000 +18,000; Coop 80,000 +12,500 +25,000.
  assert.deepEqual([await acctBal(page, 'Opay'), await acctBal(page, 'Fictional Bank'), await acctBal(page, 'Fictional Coop')], [97500, 486000, 117500]);
  await nav(page, 'cashflow');
  assert.equal((await text(page, '#cf-op-total')).trim(), '+₦3,000', 'the refund is now income, not spending');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: a bill payment stays linked to its date, cannot exceed what is due, and the bill follows the edit', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await nav(page, 'bills'); await page.click('#bill-add-btn'); await page.waitForSelector('#bill-modal.open');
  await page.fill('#bill-name', 'Fictional shop rent'); await page.selectOption('#bill-cat', 'Business Overhead'); await page.fill('#bill-amount', '50000');
  await page.fill('#bill-first', await plusDays(page, 5)); await page.selectOption('#bill-repeat', 'monthly');
  await page.click('#bill-save-btn'); await page.waitForFunction(() => !document.getElementById('bill-modal').classList.contains('open'));
  const occ = await page.getAttribute('#bills-due [data-bill-occ]', 'data-bill-occ');
  await page.click(`[data-bill-pay="${occ}"]`); await page.waitForSelector('#bill-pay-modal.open');
  await page.fill('#bill-pay-amount', '20000'); await page.click('#bill-pay-save-btn');
  await page.waitForFunction(() => !document.getElementById('bill-pay-modal').classList.contains('open'));
  const [orig] = await storedTxns(context, TEST.dbName);
  assert.equal(orig.billOcc, occ);
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'uncovered'), '₦30,000');

  await openEditFrom(page, 'timeline', orig.id);
  const f = await form(page);
  assert.equal(f.type, 'obligation'); assert.equal(f.typeLocked, true, 'a linked bill payment keeps its type');
  assert.match(await text(page, '#edit-note'), /Fictional shop rent[\s\S]*stays linked to that date/);
  await page.fill('#edit-amount', '50001');
  assert.match(await editError(page), /more than is due on this bill date \(₦50,000 including this payment\)/);
  await page.fill('#edit-amount', '50000'); await page.fill('#edit-desc', 'Fictional shop rent (full)');
  await saveEditForm(page);

  const txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 1);
  const t = txs[0];
  assert.equal(t.id, orig.id); assert.equal(t.amount, 50000);
  for (const k of ['billId', 'billOcc', 'idemKey', 'type', 'fromAcct']) assert.equal(t[k], orig[k], `${k} unchanged`);
  await nav(page, 'director');
  assert.equal(await dirRow(page, 'uncovered'), '₦0', 'the bill date is now fully paid');
  await nav(page, 'bills');
  assert.ok(await page.$(`[data-bill-reverse="${t.id}"]`), 'it can still be reversed as a Bills-screen payment');
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 50000);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: loan-agreement, reversed and sample entries are not editable; the reason is shown and nothing changes', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  // Demo mode: sample rows have no Edit button.
  await nav(page, 'timeline');
  assert.equal(await page.$('#timeline-list [data-edit-txn]'), null);
  await liveSetup(page);
  // A loan receipt recorded through an agreement.
  await nav(page, 'loans'); await page.click('#new-agr-btn');
  await page.fill('#agr-name', 'Fictional Loan'); await page.fill('#agr-counterparty', 'Fictional Lender');
  await page.fill('#agr-principal', '150000'); await page.fill('#agr-cash', '150000'); await page.fill('#agr-count', '4');
  await page.fill('#agr-first', await plusDays(page, 20)); await page.fill('#agr-inst', '55455');
  await page.check('#agr-funds-received'); await page.selectOption('#agr-account', 'acc_opay');
  await page.waitForSelector('#agr-preview .sched');
  await page.click('#agr-save-btn'); await page.waitForSelector('#screen-agreement.active');
  // An unlinked loan receipt (quick capture) and a reversed entry.
  await page.fill('#capture-input', '40000 loan received from fictional friend'); await page.click('#capture-btn');
  let txs = [];
  for (let i = 0; i < 50 && !txs.some(t => t.type === 'loan_receipt' && !t.agreementId); i++) { await page.waitForTimeout(100); txs = await storedTxns(context, TEST.dbName); }
  const receipt = txs.find(t => t.agreementId), loose = txs.find(t => t.type === 'loan_receipt' && !t.agreementId);
  await putTxn(context, TEST.dbName, { id: 9000, amount: 1500, desc: 'Fictional reversed entry', cat: 'Food', type: 'expense', state: 'AI Categorized', date: receipt.date, time: '09:00', fromAcct: 'acc_opay', toAcct: '', voided: true, voidedAt: new Date().toISOString(), voidReason: 'test' });
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  txs = await storedTxns(context, TEST.dbName);

  await nav(page, 'timeline');
  assert.equal(await page.$(`#timeline-list [data-edit-txn="${receipt.id}"]`), null, 'no Edit on a loan-agreement entry');
  assert.equal(await page.$('#timeline-list [data-edit-txn="9000"]'), null, 'no Edit on a reversed entry');
  assert.match(await text(page, '#timeline-list'), /tap to open the loan/);
  // Asked directly (e.g. from an old link), the form refuses with the reason and nothing is written.
  await nav(page, 'timeline');
  await tapEditLink(page, receipt.id);
  assert.match(page.dialogs.at(-1), /belongs to a loan agreement[\s\S]*Correct or reverse it from the agreement in Loans/);
  await page.waitForSelector('#screen-agreement.active');
  await nav(page, 'timeline');
  await tapEditLink(page, 9000);
  assert.match(page.dialogs.at(-1), /reversed/);
  assert.equal(await page.evaluate(() => document.getElementById('edit-modal').classList.contains('open')), false);
  // The Inbox offers the loan instead of an Edit button.
  await nav(page, 'inbox');
  assert.equal(await page.$(`#inbox-list button[data-edit-txn="${receipt.id}"]`), null);
  await page.click(`#inbox-list button[data-dir-open-agr="${receipt.agreementId}"]`);
  await page.waitForSelector('#screen-agreement.active');

  // An unlinked loan receipt can be corrected, but stays a loan receipt.
  await openEditFrom(page, 'inbox', loose.id);
  const f = await form(page);
  assert.equal(f.type, 'loan_receipt'); assert.equal(f.typeLocked, true);
  assert.equal(await page.$eval('#edit-cat', s => s.disabled), true);
  await page.fill('#edit-amount', '45000');
  await saveEditForm(page);
  const after = await storedTxns(context, TEST.dbName);
  assert.equal(after.length, txs.length);
  assert.deepEqual(after.find(t => t.id === receipt.id), receipt, 'the agreement entry is untouched');
  assert.deepEqual(after.find(t => t.id === 9000), txs.find(t => t.id === 9000));
  const l2 = after.find(t => t.id === loose.id);
  assert.equal(l2.type, 'loan_receipt'); assert.equal(l2.amount, 45000); assert.equal(l2.cat, loose.cat);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('TEST build: invalid values are refused; a failed save and a record changed elsewhere both leave everything as it was', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await addEntry(page, { amount: 8000, desc: 'Fictional fuel', cat: 'Other', from: 'acc_opay' });
  const [orig] = await storedTxns(context, TEST.dbName);
  await openEditFrom(page, 'timeline', orig.id);
  for (const [field, value, msg] of [['#edit-amount', '-500', /amount above zero/], ['#edit-amount', '0', /amount above zero/], ['#edit-amount', '', /amount above zero/], ['#edit-desc', '', /Enter a description/], ['#edit-date', await plusDays(page, 1), /cannot be in the future/]]) {
    const keep = await page.inputValue(field);
    await page.fill(field, value);
    assert.match(await editError(page), msg);
    await page.fill(field, keep);
  }
  assert.deepEqual(await storedTxns(context, TEST.dbName), [orig], 'nothing written for refused values');

  // A failed write: the form stays open with the new values; storage and the screen keep the original.
  await page.fill('#edit-amount', '9000');
  await page.evaluate(() => { window.__fail.write = true; });
  assert.match(await confirmError(page), /Changes NOT saved[\s\S]*simulated write failure/);
  assert.equal(await page.inputValue('#edit-amount'), '9000');
  assert.deepEqual(await storedTxns(context, TEST.dbName), [orig]);
  assert.match(await text(page, '#timeline-list'), /Fictional fuel[\s\S]*-₦8,000/, 'History still shows the saved amount');
  // Retry: saved once.
  await page.evaluate(() => { window.__fail.write = false; });
  await saveEditForm(page);
  let txs = await storedTxns(context, TEST.dbName);
  assert.equal(txs.length, 1); assert.equal(txs[0].amount, 9000); assert.equal(txs[0].edits.length, 1);

  // Changed in another tab after the form was opened: refused, and the other change is kept.
  await openEditFrom(page, 'timeline', orig.id);
  const elsewhere = Object.assign({}, txs[0], { desc: 'Fictional fuel (other tab)' });
  await putTxn(context, TEST.dbName, elsewhere);
  await page.fill('#edit-amount', '1');
  assert.match(await confirmError(page), /Changes NOT saved[\s\S]*changed elsewhere/);
  txs = await storedTxns(context, TEST.dbName);
  assert.deepEqual(txs, [elsewhere]);
  await page.click('#edit-cancel-btn');
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 91000);
  // Moving the date before the baseline is explained first; the entry then stays in history but out of balances.
  await page.reload(); await page.waitForSelector('body[data-kf-ready="1"]');
  await openEditFrom(page, 'timeline', orig.id);
  await page.fill('#edit-date', daysAgo(90));
  assert.match(await reviewChanges(page), /before your baseline[\s\S]*will no longer change account balances/);
  await confirmReview(page); await closed(page);
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 100000);
  assert.equal((await storedTxns(context, TEST.dbName)).length, 1);
  assert.deepEqual(page.errors.filter(e => !/simulated/.test(e)), []);
  await context.close();
});

test('TEST build: importing an older backup after an edit adds no duplicate and does not undo the edit', { skip }, async () => {
  const { context, page } = await ctx();
  await openApp(page, TEST.url);
  await liveSetup(page);
  await addEntry(page, { amount: 4000, desc: 'Fictional groceries', cat: 'Food', from: 'acc_opay' });
  const [orig] = await storedTxns(context, TEST.dbName);
  await openEditFrom(page, 'timeline', orig.id);
  await page.fill('#edit-amount', '4500'); await page.fill('#edit-desc', 'Fictional groceries and soap');
  await saveEditForm(page);
  const [edited] = await storedTxns(context, TEST.dbName);
  // A current-format backup holding the pre-edit version (same id): a conflict, the edit is kept.
  const v4 = await page.evaluate(o => __kfPlanImport({ version: '4.0', transactions: [o] }).report, orig);
  assert.equal(v4.conflicts, 1); assert.equal(Object.keys(v4.added).length, 0);
  // An old v2 backup (no ids matched, signature only): the pre-edit version is recognised and skipped.
  const old = Object.assign({}, orig); delete old.id;
  const v2 = await page.evaluate(o => __kfPlanImport({ version: '2.0', transactions: [o] }).report, old);
  assert.equal(v2.skipped, 1); assert.equal(Object.keys(v2.added).length, 0);
  // Through the real Import button as well.
  await page.click('#settings-nav-btn');
  await page.setInputFiles('#import-file-input', { name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: '2.0', transactions: [old] })) });
  for (let i = 0; i < 50 && !page.dialogs.some(d => /Nothing new to import/.test(d)); i++) await page.waitForTimeout(100);
  assert.match(page.dialogs.at(-1), /Nothing new to import\. 1 record\(s\) were already here/);
  assert.deepEqual(await storedTxns(context, TEST.dbName), [edited]);
  await nav(page, 'home');
  assert.equal(await acctBal(page, 'Opay'), 95500);
  assert.deepEqual(page.errors, []);
  await context.close();
});
